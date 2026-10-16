"""Regression coverage for the section-permission bypasses found in #1035."""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.exceptions import AccessDeniedError
from app.core.security import create_public_tree_token
from app.models import (
    ActivityLog,
    Document,
    DocumentFile,
    Event,
    GalleryImage,
    Member,
    Section,
    SectionMember,
    User,
    WorkspaceSectionGrant,
)
from app.services.provenance import bind_origin_section
from app.services.workspaces.merge import merge_trees
from app.services.workspaces.public_links import create_section_public_link
from tests.conftest import API, add_member, auth, make_user, share


@pytest.fixture()
def scoped(db, tree):
    user = make_user(db, "scoped-editor")
    shared = Section(workspace_id=tree.id, name="Shared")
    private = Section(workspace_id=tree.id, name="Private")
    db.add_all([shared, private])
    db.commit()
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id, section_id=shared.id, user_id=user.id, role="editor"
        )
    )
    add_member(db, tree, "shared-member", first_name="Shared")
    add_member(db, tree, "private-member", first_name="Private")
    db.add_all(
        [
            SectionMember(section_id=shared.id, member_id="shared-member"),
            SectionMember(section_id=private.id, member_id="private-member"),
        ]
    )
    db.commit()
    return user, shared, private


@pytest.mark.parametrize("role", ["viewer", "editor"])
@pytest.mark.parametrize("kind", ["native", "gedcom"])
def test_scoped_grant_cannot_export_whole_workspace(client, db, tree, scoped, role, kind):
    user, _, _ = scoped
    grant = db.scalar(select(WorkspaceSectionGrant))
    grant.role = role
    db.commit()
    visible = client.get(f"{API}/workspaces/{tree.id}/members", headers=auth(user))
    assert {row["id"] for row in visible.json()} == {"shared-member"}

    url = f"{API}/workspaces/{tree.id}"
    if kind == "native":
        response = client.post(f"{url}/export", headers=auth(user), json={})
    else:
        response = client.get(f"{url}/export-gedcom", headers=auth(user))
    assert response.status_code == 403


@pytest.mark.parametrize("action", ["merge/preview", "merge"])
def test_scoped_grant_cannot_copy_workspace(client, tree, scoped, action):
    user, _, _ = scoped
    response = client.post(
        f"{API}/workspaces/{action}",
        headers=auth(user),
        json={"name": "Unauthorized copy", "source_a": tree.id},
    )
    assert response.status_code == 403


def test_copy_worker_rechecks_scoped_access(db, tree, scoped):
    user, _, _ = scoped
    with pytest.raises(AccessDeniedError):
        merge_trees(db, user, "Unauthorized copy", tree.id, None)


def _media(db, tree, section, kind, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    filename = f"{kind}-{section.id}.png"
    directory = settings.media_root / tree.id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / filename).write_bytes(b"protected media bytes")
    url = f"{API}/media/{tree.id}/{filename}"
    bind_origin_section(db, section.id)
    if kind == "member":
        member_id = "shared-member" if section.name == "Shared" else "private-member"
        db.get(Member, member_id).image_data = url
    elif kind == "gallery":
        db.add(GalleryImage(id=str(uuid4()), workspace_id=tree.id, image_data=url))
    else:
        document = Document(
            id=str(uuid4()),
            workspace_id=tree.id,
            title="Document",
            created_at="2026-01-01",
            updated_at="2026-01-01",
        )
        db.add(document)
        db.flush()
        db.add(
            DocumentFile(
                id=str(uuid4()),
                workspace_id=tree.id,
                document_id=document.id,
                kind="file",
                filename=filename,
                url=url,
                created_at="2026-01-01",
            )
        )
    db.commit()
    return url


@pytest.mark.parametrize("kind", ["member", "gallery", "document"])
@pytest.mark.parametrize("public", [False, True])
@pytest.mark.parametrize("download", [False, True])
def test_media_follows_record_visibility(
    client, db, tree, scoped, tmp_path, monkeypatch, kind, public, download
):
    user, shared, private = scoped
    shared_url = _media(db, tree, shared, kind, tmp_path, monkeypatch)
    private_url = _media(db, tree, private, kind, tmp_path, monkeypatch)
    headers = auth(user)
    if public:
        link = create_section_public_link(db, workspace_id=tree.id, section_id=shared.id)
        db.commit()
        headers = {
            "X-Public-Workspace-Token": create_public_tree_token(
                tree.id, link.access_version, link.id
            )
        }
    params = {"download": str(download).lower()}
    allowed = client.get(shared_url, headers=headers, params=params)
    assert allowed.status_code == 200, allowed.text
    assert allowed.content == b"protected media bytes"
    denied = client.get(private_url, headers=headers, params=params)
    assert denied.status_code == 404


@pytest.mark.parametrize("kind,domain", [("gallery", "gallery"), ("document", "sources")])
def test_media_honors_domain_restrictions(
    client, db, tree, scoped, tmp_path, monkeypatch, kind, domain
):
    user, shared, _ = scoped
    url = _media(db, tree, shared, kind, tmp_path, monkeypatch)
    grant = db.scalar(select(WorkspaceSectionGrant))
    grant.restrictions = [domain]
    db.commit()
    assert client.get(url, headers=auth(user)).status_code == 404


@pytest.mark.parametrize("create", [False, True])
def test_scoped_editor_cannot_reuse_hidden_photo_url(
    client, db, tree, scoped, tmp_path, monkeypatch, create
):
    user, _, private = scoped
    url = _media(db, tree, private, "member", tmp_path, monkeypatch)
    base = f"{API}/workspaces/{tree.id}/members"
    if create:
        response = client.post(
            base, headers=auth(user), json={"id": "new", "imageData": url}
        )
    else:
        response = client.patch(
            f"{base}/shared-member", headers=auth(user), json={"imageData": url}
        )
    assert response.status_code == 404
    db.expire_all()
    assert db.get(Member, "shared-member").image_data is None
    assert db.get(Member, "new") is None


def test_section_membership_cannot_grant_access_to_hidden_member(
    client, db, tree, scoped
):
    user, shared, _ = scoped
    member_url = f"{API}/workspaces/{tree.id}/members/private-member"
    assert client.get(member_url, headers=auth(user)).status_code == 404
    response = client.put(
        f"{API}/workspaces/{tree.id}/sections/{shared.id}/members",
        headers=auth(user),
        json={"member_ids": ["private-member"]},
    )
    assert response.status_code == 404
    assert client.get(member_url, headers=auth(user)).status_code == 404
    assert (
        client.patch(
            member_url, headers=auth(user), json={"firstName": "Changed"}
        ).status_code
        == 404
    )
    db.expire_all()
    assert db.get(SectionMember, (shared.id, "shared-member")) is not None
    assert db.get(SectionMember, (shared.id, "private-member")) is None


def test_scoped_editor_can_create_and_manage_visible_members(client, tree, scoped):
    user, shared, _ = scoped
    base = f"{API}/workspaces/{tree.id}"
    created = client.post(f"{base}/members", headers=auth(user), json={"id": "new"})
    assert created.status_code == 201, created.text
    assert client.get(f"{base}/members/new", headers=auth(user)).status_code == 200
    response = client.put(
        f"{base}/sections/{shared.id}/members",
        headers=auth(user),
        json={"member_ids": ["shared-member", "new"]},
    )
    assert response.status_code == 204, response.text


def test_scoped_editor_cannot_read_whole_workspace_history(client, tree, scoped):
    user, _, _ = scoped
    assert (
        client.get(f"{API}/workspaces/{tree.id}/activity", headers=auth(user)).status_code
        == 403
    )


@pytest.mark.parametrize("workspace_viewer", [False, True])
def test_scoped_editor_cannot_undo_another_sections_delete(
    client, db, owner, tree, scoped, workspace_viewer
):
    user, _, private = scoped
    if workspace_viewer:
        share(db, tree, user, role="viewer")
    base = f"{API}/workspaces/{tree.id}"
    created = client.post(
        f"{base}/events",
        params={"origin_section_id": private.id},
        headers=auth(owner),
        json={
            "id": "private-event",
            "event_type": "birth",
            "date": "2000",
            "created_at": "2000",
        },
    )
    assert created.status_code == 201, created.text
    assert (
        client.delete(f"{base}/events/private-event", headers=auth(owner)).status_code
        == 204
    )
    entry = db.scalar(
        select(ActivityLog).where(
            ActivityLog.action == "delete", ActivityLog.target_id == "private-event"
        )
    )
    response = client.post(f"{base}/activity/{entry.id}/undo", headers=auth(user))
    assert response.status_code == 403, response.text
    db.expire_all()
    assert db.get(Event, "private-event") is None


def test_scoped_statistics_never_reads_or_overwrites_workspace_cache(
    client, db, tree, scoped, monkeypatch
):
    import app.db.redis as redis_module
    from tests.test_stats_cache import FakeRedis

    user, _, _ = scoped
    db.get(Member, "private-member").first_name = "PrivateName"
    db.commit()
    cache = FakeRedis()
    monkeypatch.setattr(redis_module, "get_redis", lambda: cache)
    url = f"{API}/workspaces/{tree.id}/statistics"
    assert (
        client.get(url, headers=auth(db.get(User, tree.owner_id))).json()["total_members"]
        == 2
    )
    reads, writes = len(cache.get_calls), len(cache.set_calls)
    result = client.get(url, headers=auth(user))
    assert result.status_code == 200
    assert result.json()["total_members"] == 1
    assert "PrivateName" not in result.text
    assert (len(cache.get_calls), len(cache.set_calls)) == (reads, writes)


def test_quality_report_and_dismissals_respect_member_visibility(
    client, db, tree, scoped
):
    from app.services.workspaces.quality_checks import issue_id_for

    user, _, _ = scoped
    for member_id in ("shared-member", "private-member"):
        member = db.get(Member, member_id)
        member.date_of_birth = "2000"
        member.date_of_death = "1900"
    db.commit()
    url = f"{API}/workspaces/{tree.id}/quality-report"
    result = client.get(url, headers=auth(user))
    assert result.status_code == 200
    assert result.json()["total_members"] == 1
    assert "private-member" not in result.text
    hidden_issue = issue_id_for("birth_after_death", ["private-member"])
    hidden_url = f"{url}/issues/{hidden_issue}/dismiss"
    assert client.post(hidden_url, headers=auth(user)).status_code == 404
    owner = db.get(User, tree.owner_id)
    assert client.post(hidden_url, headers=auth(owner)).status_code == 204
    assert client.delete(hidden_url, headers=auth(user)).status_code == 404
    visible_issue = issue_id_for("birth_after_death", ["shared-member"])
    visible_url = f"{url}/issues/{visible_issue}/dismiss"
    assert client.post(visible_url, headers=auth(user)).status_code == 204
    assert client.delete(visible_url, headers=auth(user)).status_code == 204


@pytest.mark.parametrize("role", ["viewer", "editor"])
@pytest.mark.parametrize("direction", ["direct_family", "partnership"])
def test_scoped_readers_cannot_preview_workspace_branches(
    client, db, tree, scoped, role, direction
):
    user, _, _ = scoped
    grant = db.scalar(select(WorkspaceSectionGrant))
    grant.role = role
    db.commit()
    result = client.get(
        f"{API}/workspaces/{tree.id}/sections/preview",
        headers=auth(user),
        params={"root_member_id": "shared-member", "direction": direction},
    )
    assert result.status_code == 403


def test_scoped_editor_cannot_create_sections_or_list_private_scope_metadata(
    client, db, tree, scoped
):
    user, _, private = scoped
    base = f"{API}/workspaces/{tree.id}"
    assert client.get(base + "/content-scopes", headers=auth(user)).status_code == 403
    result = client.post(
        base + "/sections",
        headers=auth(user),
        json={"name": "Unauthorized", "root_member_id": "private-member"},
    )
    assert result.status_code == 403
    assert db.scalar(select(Section).where(Section.name == "Unauthorized")) is None
    assert client.get(base, headers=auth(user)).json()["can_create_sections"] is False
    assert (
        client.get(base, headers=auth(db.get(User, tree.owner_id))).json()[
            "can_create_sections"
        ]
        is True
    )
