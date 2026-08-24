"""Pytest fixtures.

Tests run against a throwaway in-memory SQLite database (one per test) with the
production ``get_db`` dependency overridden, so no Postgres or Alembic run is
needed. The ORM models are storage-agnostic, so this exercises the real routes,
schemas and authorization logic.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.api.exception_handlers import install_domain_error_handler
from app.api.router import api_router
from app.core.config import settings
from app.core.rate_limit import login_rate_limiter, public_unlock_rate_limiter
from app.core.security import create_access_token, hash_password
from app.db.base import Base, utcnow_iso
from app.db.init_db import DEFAULT_RELATION_TYPES
from app.db.session import get_db
from app.models import (
    Friendship,
    LegalAcceptance,
    Member,
    RelationType,
    User,
    Workspace,
    WorkspaceMembership,
)
from app.services.system.settings_service import DEFAULT_LEGAL_VERSION, get_setting

# The dev .env uses a short key; patch before any JWT operation so
# PyJWT's InsecureKeyLengthWarning (RFC 7518 §3.2, 32-byte minimum) is silent.
settings.SECRET_KEY = "test-only-secret-key-at-least-32-bytes-long-for-hs256"  # noqa: S105


@pytest.fixture()
def session_factory():
    # StaticPool hands every connection (this fixture, the client, and
    # background-job sessions) the *same* underlying in-memory database, so it
    # behaves like a single shared on-disk DB without the per-test fsync cost.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    # Mirror init_db: the instance-wide relation type registry is seeded before
    # the app serves any request.
    with factory() as session:
        for rt in DEFAULT_RELATION_TYPES:
            session.add(RelationType(id=rt))
        session.commit()
    yield factory
    engine.dispose()


@pytest.fixture()
def db(session_factory) -> Session:
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def patch_background_session(session_factory, monkeypatch):
    """Background tasks create their own SessionLocal; redirect to the test DB."""
    import app.api.routes.workspace_jobs as _tree_jobs_routes
    import app.services.interchange.bundles.tree_bundle_import as _bundle_import
    import app.services.interchange.gedcom.tree_gedcom_import as _gedcom_import
    import app.services.system.job_service as _job_svc

    monkeypatch.setattr(_job_svc, "SessionLocal", session_factory)
    monkeypatch.setattr(_bundle_import, "SessionLocal", session_factory)
    monkeypatch.setattr(_gedcom_import, "SessionLocal", session_factory)
    monkeypatch.setattr(_tree_jobs_routes, "SessionLocal", session_factory)


@pytest.fixture()
def client(session_factory) -> TestClient:
    app = FastAPI()
    app.include_router(api_router, prefix=settings.API_PREFIX)
    install_domain_error_handler(app)

    def override_get_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    login_rate_limiter.clear()
    public_unlock_rate_limiter.clear()
    return TestClient(app)


@pytest.fixture()
def owner(db) -> User:
    return make_user(db, "owner")


@pytest.fixture()
def tree(db, owner) -> Workspace:
    return make_tree(db, owner)


@pytest.fixture()
def headers(owner) -> dict[str, str]:
    return auth(owner)


# --- Helpers ---------------------------------------------------------------
API = settings.API_PREFIX


def make_user(
    db: Session,
    username: str = "alice",
    *,
    password: str | None = "secret",
    is_admin: bool = False,
    is_active: bool = True,
    legal_accepted: bool = True,
) -> User:
    """Create a test user.

    ``legal_accepted`` defaults to True (inserting an acceptance row for the
    current ``legal_version``) so the legal acceptance gate added in #519
    doesn't force every existing write-path test to accept first. Pass
    ``legal_accepted=False`` for tests that specifically exercise the gate.
    """
    user = User(
        username=username,
        email=f"{username}@example.com",
        full_name=username.title(),
        hashed_password=hash_password(password) if password else None,
        is_admin=is_admin,
        is_active=is_active,
        auth_provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if legal_accepted:
        db.add(
            LegalAcceptance(
                user_id=user.id,
                username=user.username,
                version=get_setting(db, "legal_version", DEFAULT_LEGAL_VERSION)
                or DEFAULT_LEGAL_VERSION,
                locale="de",
                accepted_at=utcnow_iso(),
            )
        )
        db.commit()
    return user


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def make_tree(
    db: Session, owner: User, name: str = "Workspace", workspace_id: str | None = None
) -> Workspace:
    kw = {"id": workspace_id} if workspace_id else {}
    tree = Workspace(name=name, owner_id=owner.id, **kw)
    db.add(tree)
    db.commit()
    db.refresh(tree)
    return tree


def share(db: Session, tree: Workspace, user: User, role: str = "editor") -> None:
    db.add(WorkspaceMembership(workspace_id=tree.id, user_id=user.id, role=role))
    db.commit()


def add_member(db: Session, tree: Workspace, member_id: str, **kw) -> Member:
    member = Member(id=member_id, workspace_id=tree.id, **kw)
    db.add(member)
    db.commit()
    return member


def befriend(db: Session, a: User, b: User, status: str = "accepted") -> Friendship:
    friendship = Friendship(requester_id=a.id, addressee_id=b.id, status=status)
    db.add(friendship)
    db.commit()
    return friendship


def wait_for_job(client: TestClient, headers: dict, job_id: str) -> str:
    """Resolve a background job to its result_workspace_id.

    TestClient runs background tasks synchronously, so by the time a 202
    response is received the job is already complete.
    """
    resp = client.get(f"{API}/jobs/{job_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "done", (
        f"Job {job_id} status={data['status']} error={data.get('error')}"
    )
    return data["result_workspace_id"]
