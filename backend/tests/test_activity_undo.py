"""Tests for undoing a single delete activity entry (issue #762)."""

import base64
import json

from sqlalchemy import select

from app.models.activity import ActivityLog
from app.models.content import (
    Document,
    DocumentFile,
    DocumentMemberLink,
    Event,
    EventDocumentLink,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    MemberTask,
    MemberTaskLink,
    Story,
    StoryMemberLink,
)
from app.models.family import Member, MemberDisease, Relation
from app.services import feature_service
from tests.conftest import API, add_member, auth, make_tree, make_user, share

# Minimal 1x1 PNG streamed as a multipart gallery upload.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _activity_rows(db, tree_id):
    return db.scalars(select(ActivityLog).where(ActivityLog.tree_id == tree_id)).all()


def _last_delete_entry(db, tree_id, target_type: str | None = None) -> ActivityLog:
    rows = [r for r in _activity_rows(db, tree_id) if r.action == "delete"]
    if target_type is not None:
        rows = [r for r in rows if r.target_type == target_type]
    assert rows, "expected at least one delete row"
    return rows[-1]


def _write_media_file(
    settings, tree_id: str, filename: str, content: bytes = b"data"
) -> str:
    from app.services.storage import MEDIA_URL_PREFIX

    tree_dir = settings.media_root / tree_id
    tree_dir.mkdir(parents=True, exist_ok=True)
    (tree_dir / filename).write_bytes(content)
    return f"{MEDIA_URL_PREFIX}/{tree_id}/{filename}"


def _undo(client, tree_id, entry_id, user):
    return client.post(
        f"{API}/trees/{tree_id}/activity/{entry_id}/undo", headers=auth(user)
    )


# ---------------------------------------------------------------------------
# Member: full cascade + bridge
# ---------------------------------------------------------------------------


def test_undo_member_delete_restores_full_cascade(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    member = add_member(
        db,
        tree,
        "m1",
        first_name="Ada",
        last_name="Doe",
        date_of_birth="1815-12-10",
        birthplace="London",
    )
    add_member(db, tree, "m2", first_name="Bob")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id="m1",
            to_member_id="m2",
            relation_type="parent",
        )
    )
    db.add(
        MemberDisease(
            id="d1",
            tree_id=tree.id,
            member_id="m1",
            name="Anemia",
            carrier_status="affected",
        )
    )
    db.add(
        MemberTask(id="task1", tree_id=tree.id, title="Find birth record", created_at="t")
    )
    db.add(MemberTaskLink(task_id="task1", member_id="m1"))
    db.add(
        Event(id="e1", tree_id=tree.id, event_type="birth", date="1815", created_at="t")
    )
    db.add(EventMemberLink(event_id="e1", member_id="m1"))
    db.add(
        Story(id="s1", tree_id=tree.id, title="A Story", created_at="t", updated_at="t")
    )
    db.add(StoryMemberLink(story_id="s1", member_id="m1"))
    db.add(GalleryImage(id="g1", tree_id=tree.id, title="Photo"))
    db.add(
        GalleryMemberLink(
            gallery_image_id="g1", member_id="m1", x=0.1, y=0.2, w=0.3, h=0.4
        )
    )
    db.add(
        Document(id="doc1", tree_id=tree.id, title="Deed", created_at="t", updated_at="t")
    )
    db.add(DocumentMemberLink(document_id="doc1", member_id="m1"))
    db.commit()
    del member

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert body["target_type"] == "member"
    assert body["restored"]["member"] == "m1"
    assert body["restored"]["relations"] == 1
    assert body["restored"]["diseases"] == 1
    assert body["restored"]["task_links"] == 1
    assert body["restored"]["event_links"] == 1
    assert body["restored"]["story_links"] == 1
    assert body["restored"]["gallery_links"] == 1
    assert body["restored"]["document_links"] == 1
    assert body["skipped"] == []

    restored = db.get(Member, "m1")
    assert restored is not None
    assert restored.first_name == "Ada"
    assert restored.date_of_birth == "1815-12-10"
    assert restored.date_of_birth_sort is not None
    assert db.get(Relation, (tree.id, "m1", "m2", "parent")) is not None
    assert db.get(MemberDisease, "d1") is not None
    assert db.get(MemberTaskLink, ("task1", "m1")) is not None
    assert db.get(EventMemberLink, ("e1", "m1")) is not None
    assert db.get(StoryMemberLink, ("s1", "m1")) is not None
    link = db.get(GalleryMemberLink, ("g1", "m1"))
    assert link is not None and link.x == 0.1 and link.h == 0.4
    assert db.get(DocumentMemberLink, ("doc1", "m1")) is not None

    # The undo itself is logged as a new create row referencing the entry.
    undo_row = db.get(ActivityLog, body["undo_entry_id"])
    assert undo_row.action == "create"
    assert undo_row.target_type == "member"
    details = json.loads(undo_row.details)
    assert details["undo_of"] == entry.id


def test_undo_bridge_member_delete_relinks_counterpart(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    other = make_tree(db, owner, name="Linked")
    add_member(db, tree, "m1", first_name="Ada")
    add_member(db, other, "c1", first_name="Ada")
    db.get(Member, "m1").linked_tree_id = other.id
    db.get(Member, "m1").linked_member_id = "c1"
    db.get(Member, "c1").linked_tree_id = tree.id
    db.get(Member, "c1").linked_member_id = "m1"
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    assert res.json()["skipped"] == []

    m1 = db.get(Member, "m1")
    c1 = db.get(Member, "c1")
    assert m1.linked_tree_id == other.id
    assert m1.linked_member_id == "c1"
    assert c1.linked_tree_id == tree.id
    assert c1.linked_member_id == "m1"


def test_undo_bridge_member_delete_skips_gone_counterpart(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    other = make_tree(db, owner, name="Linked")
    add_member(db, tree, "m1", first_name="Ada")
    add_member(db, other, "c1", first_name="Ada")
    db.get(Member, "m1").linked_tree_id = other.id
    db.get(Member, "m1").linked_member_id = "c1"
    db.get(Member, "c1").linked_tree_id = tree.id
    db.get(Member, "c1").linked_member_id = "m1"
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    # The bridge counterpart is gone by the time we undo.
    res = client.delete(f"{API}/trees/{other.id}/members/c1", headers=auth(owner))
    assert res.status_code == 204

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert db.get(Member, "m1") is not None
    assert any(s["table"] == "members" for s in body["skipped"])


# ---------------------------------------------------------------------------
# Partial restore: a stale relation endpoint is skipped, not fatal
# ---------------------------------------------------------------------------


def test_undo_member_delete_skips_relation_to_deleted_member(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    add_member(db, tree, "m2", first_name="Bob")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id="m1",
            to_member_id="m2",
            relation_type="parent",
        )
    )
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    # m2 disappears before the undo is attempted.
    res = client.delete(f"{API}/trees/{tree.id}/members/m2", headers=auth(owner))
    assert res.status_code == 204

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert db.get(Member, "m1") is not None
    assert "relations" not in body["restored"]
    assert body["skipped"] == [
        {"table": "relations", "reason": "member m2 no longer exists"}
    ]


# ---------------------------------------------------------------------------
# Bare relation / disease
# ---------------------------------------------------------------------------


def test_undo_relation_delete(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id="m1",
            to_member_id="m2",
            relation_type="parent",
        )
    )
    db.commit()

    res = client.delete(
        f"{API}/trees/{tree.id}/relations",
        params={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "parent"},
        headers=auth(owner),
    )
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "relation")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    assert res.json()["restored"] == {"relation": 1}
    assert db.get(Relation, (tree.id, "m1", "m2", "parent")) is not None


def test_undo_relation_delete_conflicts_when_endpoint_gone(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    db.add(
        Relation(
            tree_id=tree.id,
            from_member_id="m1",
            to_member_id="m2",
            relation_type="parent",
        )
    )
    db.commit()

    res = client.delete(
        f"{API}/trees/{tree.id}/relations",
        params={"from_member_id": "m1", "to_member_id": "m2", "relation_type": "parent"},
        headers=auth(owner),
    )
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "relation")

    res = client.delete(f"{API}/trees/{tree.id}/members/m2", headers=auth(owner))
    assert res.status_code == 204

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 409


def test_undo_disease_delete(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    db.add(
        MemberDisease(
            id="d1",
            tree_id=tree.id,
            member_id="m1",
            name="Anemia",
            carrier_status="carrier",
        )
    )
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/diseases/d1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "disease")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    assert res.json()["restored"] == {"disease": "d1"}
    assert db.get(MemberDisease, "d1") is not None


# ---------------------------------------------------------------------------
# Event / story
# ---------------------------------------------------------------------------


def test_undo_event_delete(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    db.add(
        Event(id="e1", tree_id=tree.id, event_type="birth", date="1900", created_at="t")
    )
    db.add(EventMemberLink(event_id="e1", member_id="m1"))
    db.add(
        Document(id="doc1", tree_id=tree.id, title="Deed", created_at="t", updated_at="t")
    )
    db.add(EventDocumentLink(event_id="e1", document_id="doc1"))
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/events/e1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "event")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert body["restored"]["event"] == "e1"
    assert body["restored"]["member_links"] == 1
    assert body["restored"]["document_links"] == 1
    assert db.get(Event, "e1") is not None
    assert db.get(EventMemberLink, ("e1", "m1")) is not None
    assert db.get(EventDocumentLink, ("e1", "doc1")) is not None


def test_undo_story_delete(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    db.add(
        Story(id="s1", tree_id=tree.id, title="A Story", created_at="t", updated_at="t")
    )
    db.add(StoryMemberLink(story_id="s1", member_id="m1"))
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/stories/s1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "story")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    assert res.json()["restored"]["story"] == "s1"
    assert db.get(Story, "s1") is not None
    assert db.get(StoryMemberLink, ("s1", "m1")) is not None


# ---------------------------------------------------------------------------
# Gallery image / document — media un-trash
# ---------------------------------------------------------------------------


def test_undo_gallery_image_delete_untrashes_media(client, db, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")

    created = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        headers=auth(owner),
        data={"id": "img1", "title": "A Photo", "uploaded_at": "2000-01-01T00:00:00Z"},
        files={"image": ("a.png", _PNG_BYTES, "image/png")},
    )
    assert created.status_code == 201
    image_url = created.json()["imageData"]
    stored_path = settings.media_root / tree.id / image_url.rsplit("/", 1)[-1]

    res = client.put(
        f"{API}/trees/{tree.id}/gallery/images/img1/links",
        headers=auth(owner),
        json={"member_ids": ["m1"]},
    )
    assert res.status_code == 204

    res = client.delete(f"{API}/trees/{tree.id}/gallery/images/img1", headers=auth(owner))
    assert res.status_code == 204
    assert not stored_path.is_file()
    entry = _last_delete_entry(db, tree.id, "gallery_image")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert body["restored"]["gallery_image"] == "img1"
    assert body["restored"]["member_links"] == 1
    assert body["skipped"] == []
    assert db.get(GalleryImage, "img1") is not None
    assert db.get(GalleryMemberLink, ("img1", "m1")) is not None
    assert stored_path.is_file()


def test_undo_gallery_image_delete_degrades_when_media_purged(
    client, db, tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    created = client.post(
        f"{API}/trees/{tree.id}/gallery/images",
        headers=auth(owner),
        data={"id": "img1", "title": "A Photo", "uploaded_at": "2000-01-01T00:00:00Z"},
        files={"image": ("a.png", _PNG_BYTES, "image/png")},
    )
    assert created.status_code == 201
    image_url = created.json()["imageData"]

    res = client.delete(f"{API}/trees/{tree.id}/gallery/images/img1", headers=auth(owner))
    assert res.status_code == 204
    trashed_path = settings.media_root / tree.id / ".trash" / image_url.rsplit("/", 1)[-1]
    assert trashed_path.is_file()
    trashed_path.unlink()  # simulate purge_expired_media_trash having already run

    entry = _last_delete_entry(db, tree.id, "gallery_image")
    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert db.get(GalleryImage, "img1") is not None
    assert any(s["table"] == "media" for s in body["skipped"])


def test_undo_document_delete_untrashes_files(client, db, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    url = _write_media_file(settings, tree.id, "file1.pdf")

    db.add(
        Document(id="doc1", tree_id=tree.id, title="Deed", created_at="t", updated_at="t")
    )
    db.add(
        DocumentFile(
            id="f1",
            tree_id=tree.id,
            document_id="doc1",
            kind="file",
            filename="file1.pdf",
            url=url,
            mime_type="application/pdf",
            size=4,
            created_at="t",
        )
    )
    db.add(DocumentMemberLink(document_id="doc1", member_id="m1"))
    db.commit()

    res = client.delete(f"{API}/trees/{tree.id}/documents/doc1", headers=auth(owner))
    assert res.status_code == 204
    stored_path = settings.media_root / tree.id / "file1.pdf"
    assert not stored_path.is_file()
    entry = _last_delete_entry(db, tree.id, "document")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    body = res.json()
    assert body["restored"]["document"] == "doc1"
    assert body["restored"]["files"] == 1
    assert body["restored"]["member_links"] == 1
    assert body["skipped"] == []
    assert db.get(Document, "doc1") is not None
    assert db.get(DocumentFile, "f1") is not None
    assert stored_path.is_file()


def test_undo_document_file_delete_untrashes_media(client, db, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    url = _write_media_file(settings, tree.id, "file1.pdf")

    db.add(
        Document(id="doc1", tree_id=tree.id, title="Deed", created_at="t", updated_at="t")
    )
    db.add(
        DocumentFile(
            id="f1",
            tree_id=tree.id,
            document_id="doc1",
            kind="file",
            filename="file1.pdf",
            url=url,
            mime_type="application/pdf",
            size=4,
            created_at="t",
        )
    )
    db.commit()

    res = client.delete(
        f"{API}/trees/{tree.id}/documents/doc1/files/f1", headers=auth(owner)
    )
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "document_file")

    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
    assert res.json()["restored"] == {"document_file": "f1"}
    assert db.get(DocumentFile, "f1") is not None
    assert (settings.media_root / tree.id / "file1.pdf").is_file()


# ---------------------------------------------------------------------------
# Conflicts, dispatch guards, permissions
# ---------------------------------------------------------------------------


def test_undo_twice_conflicts(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    assert _undo(client, tree.id, entry.id, owner).status_code == 200
    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 409


def test_undo_rejects_non_delete_action(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")

    res = client.patch(
        f"{API}/trees/{tree.id}/members/m1",
        headers=auth(owner),
        json={"firstName": "Beatrice"},
    )
    assert res.status_code == 200
    rows = [r for r in _activity_rows(db, tree.id) if r.action == "update"]
    assert len(rows) == 1

    res = _undo(client, tree.id, rows[0].id, owner)
    assert res.status_code == 422


def test_undo_rejects_unsupported_snapshot_version(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    row = ActivityLog(
        tree_id=tree.id,
        actor_id=owner.id,
        actor_username=owner.username,
        action="delete",
        target_type="member",
        target_id="m1",
        target_label="Ada",
        details=json.dumps({"snapshot": {"version": 99, "member": {"id": "m1"}}}),
    )
    db.add(row)
    db.commit()

    res = _undo(client, tree.id, row.id, owner)
    assert res.status_code == 422


def test_undo_rejects_missing_snapshot(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    row = ActivityLog(
        tree_id=tree.id,
        actor_id=owner.id,
        actor_username=owner.username,
        action="delete",
        target_type="member",
        target_id="m1",
        target_label="Ada",
        details=None,
    )
    db.add(row)
    db.commit()

    res = _undo(client, tree.id, row.id, owner)
    assert res.status_code == 422


def test_undo_not_found(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)

    res = _undo(client, tree.id, "nonexistent", owner)
    assert res.status_code == 404


def test_undo_cross_tree_entry_not_found(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    other = make_tree(db, owner, name="Other")
    add_member(db, tree, "m1", first_name="Ada")

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    res = _undo(client, other.id, entry.id, owner)
    assert res.status_code == 404


def test_viewer_cannot_undo(client, db):
    owner = make_user(db, "alice")
    viewer = make_user(db, "bob")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")
    share(db, tree, viewer, role="viewer")

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    res = _undo(client, tree.id, entry.id, viewer)
    assert res.status_code == 403


def test_undo_disabled_by_own_feature_flag(client, db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    feature_service.set_state(db, "activity_undo", "off")
    db.commit()
    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 404


def test_undo_works_when_activity_log_view_flag_is_off(client, db):
    """Undo and the read-only log view are gated by independent flags."""
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada")

    res = client.delete(f"{API}/trees/{tree.id}/members/m1", headers=auth(owner))
    assert res.status_code == 204
    entry = _last_delete_entry(db, tree.id, "member")

    feature_service.set_state(db, "activity_log", "off")
    db.commit()

    assert (
        client.get(f"{API}/trees/{tree.id}/activity", headers=auth(owner)).status_code
        == 404
    )
    res = _undo(client, tree.id, entry.id, owner)
    assert res.status_code == 200
