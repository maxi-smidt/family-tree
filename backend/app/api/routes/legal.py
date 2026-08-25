"""Legal documents (Terms / Privacy / Impressum) and acceptance tracking.

``GET /legal/public`` is intentionally unauthenticated — the Impressum and
Privacy Policy must be reachable before login and from the anonymous public
tree viewer. It is locale-aware (``?locale=de|en``, default ``de``), falling
back to German when the requested locale's body is empty. ``POST
/legal/accept`` records a durable audit row (username, version, locale,
content hashes, IP, user-agent) and flips the per-user fast-lookup flag used
by the blocking gate (see ``app.api.deps.get_writable_workspace`` and
``user_has_accepted_legal``) — re-acceptance is triggered only by a
``legal_version`` change, never by locale. ``GET /legal/versions[/...]``
exposes the immutable snapshot history (see ``LegalDocumentVersion``) to
admins so a past acceptance can always be tied back to the exact text, in the
exact language, the user agreed to.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.request_ip import client_ip
from app.db.base import utcnow_iso
from app.db.session import get_db
from app.models import LegalAcceptance, LegalDocumentVersion, User
from app.schemas.legal import (
    LegalAcceptanceStatus,
    LegalDocumentVersionDetail,
    LegalDocumentVersionSummary,
    LegalPublicDocuments,
)
from app.services.system.legal_defaults import LEGAL_DEFAULT_LOCALE, LEGAL_LOCALES
from app.services.system.settings_service import (
    DEFAULT_LEGAL_VERSION,
    content_hash,
    get_legal_body,
    get_setting,
    snapshot_current_legal_versions,
    user_has_accepted_legal,
)
from app.services.unit_of_work import UnitOfWork

router = APIRouter(prefix="/legal", tags=["legal"])


def _normalize_locale(locale: str | None) -> str:
    """Validate a client-supplied legal locale, defaulting to German."""
    if locale and locale in LEGAL_LOCALES:
        return locale
    return LEGAL_DEFAULT_LOCALE


@router.get("/public", response_model=LegalPublicDocuments)
def get_public_legal_documents(locale: str | None = None, db: Session = Depends(get_db)):
    resolved_locale = _normalize_locale(locale)
    return LegalPublicDocuments(
        terms_body=get_legal_body(db, "terms", resolved_locale),
        privacy_body=get_legal_body(db, "privacy", resolved_locale),
        imprint_body=get_legal_body(db, "imprint", resolved_locale),
        version=get_setting(db, "legal_version", "1") or "1",
        locale=resolved_locale,
    )


@router.post("/accept", response_model=LegalAcceptanceStatus)
def accept_legal(
    request: Request,
    locale: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Always read the current version server-side — never trust a
    # client-supplied version, which would let a stale acceptance count.
    current_version = (
        get_setting(db, "legal_version", DEFAULT_LEGAL_VERSION) or DEFAULT_LEGAL_VERSION
    )
    resolved_locale = _normalize_locale(locale)
    terms_body = get_legal_body(db, "terms", resolved_locale)
    privacy_body = get_legal_body(db, "privacy", resolved_locale)

    # Ensure the text being accepted right now is immutably snapshotted, so
    # the hashes recorded below always resolve to a stored version row even
    # if the admin edited the body without bumping legal_version first.
    with UnitOfWork(db):
        snapshot_current_legal_versions(db)

        db.add(
            LegalAcceptance(
                user_id=user.id,
                username=user.username,
                version=current_version,
                locale=resolved_locale,
                accepted_at=utcnow_iso(),
                ip_address=client_ip(request),
                user_agent=request.headers.get("user-agent"),
                terms_hash=content_hash(terms_body) if terms_body else None,
                privacy_hash=content_hash(privacy_body) if privacy_body else None,
            )
        )

    # The newly inserted acceptance row is the source of truth for the gate.
    return LegalAcceptanceStatus(
        accepted=user_has_accepted_legal(db, user),
        version=current_version,
    )


@router.get(
    "/versions",
    response_model=list[LegalDocumentVersionSummary],
    dependencies=[Depends(require_admin)],
)
def list_legal_versions(db: Session = Depends(get_db)):
    """Admin-only: the full immutable snapshot history, newest first."""
    rows = db.scalars(
        select(LegalDocumentVersion).order_by(LegalDocumentVersion.published_at.desc())
    ).all()
    return rows


@router.get(
    "/versions/{version_id}",
    response_model=LegalDocumentVersionDetail,
    dependencies=[Depends(require_admin)],
)
def get_legal_version(version_id: str, db: Session = Depends(get_db)):
    """Admin-only: the full body of a single historical snapshot."""
    row = db.get(LegalDocumentVersion, version_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return row
