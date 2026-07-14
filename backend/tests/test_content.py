import pytest

from app.core.config import settings
from tests.conftest import API, add_member, auth, make_tree, make_user

_DOC_BYTES = b"hello"


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


def _setup(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="A")
    add_member(db, tree, "m2", first_name="B")
    return user, tree


def test_create_event_with_member_ids_links_in_one_request(client, db):
    user, tree = _setup(client, db)
    res = client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(user),
        json={
            "id": "e1",
            "event_type": "marriage",
            "date": "2000-01-01",
            "created_at": "2000-01-01T00:00:00Z",
            "member_ids": ["m1", "m2"],
        },
    )
    assert res.status_code == 201

    links = client.get(f"{API}/trees/{tree.id}/events/links", headers=auth(user)).json()
    assert {link["member_id"] for link in links} == {"m1", "m2"}


def test_set_event_links_replaces_existing(client, db):
    user, tree = _setup(client, db)
    client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(user),
        json={
            "id": "e1",
            "event_type": "birth",
            "date": "2000",
            "created_at": "2000",
            "member_ids": ["m1"],
        },
    )
    res = client.put(
        f"{API}/trees/{tree.id}/events/e1/links",
        headers=auth(user),
        json={"member_ids": ["m2"]},
    )
    assert res.status_code == 204

    links = client.get(f"{API}/trees/{tree.id}/events/links", headers=auth(user)).json()
    assert {link["member_id"] for link in links} == {"m2"}


def test_links_ignore_members_from_other_trees(client, db):
    user, tree = _setup(client, db)
    other_tree = make_tree(db, user, "Other")
    add_member(db, other_tree, "foreign")

    client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(user),
        json={
            "id": "s1",
            "title": "Tale",
            "content": "...",
            "created_at": "2000",
            "updated_at": "2000",
            "member_ids": ["m1", "foreign"],
        },
    )
    links = client.get(
        f"{API}/trees/{tree.id}/stories/links", headers=auth(user)
    ).json()
    # "foreign" belongs to another tree and must be dropped.
    assert {link["member_id"] for link in links} == {"m1"}


def test_create_story_with_member_ids(client, db):
    user, tree = _setup(client, db)
    res = client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(user),
        json={
            "id": "s1",
            "title": "Tale",
            "content": "Once upon a time",
            "date": "1901-06",
            "created_at": "2000",
            "updated_at": "2000",
            "member_ids": ["m1", "m2"],
        },
    )
    assert res.status_code == 201
    assert res.json()["date"] == "1901-06"
    links = client.get(
        f"{API}/trees/{tree.id}/stories/links", headers=auth(user)
    ).json()
    assert {link["member_id"] for link in links} == {"m1", "m2"}


# ---------------------------------------------------------------------------
# Documents (formerly Sources/Citations/Evidence)
# ---------------------------------------------------------------------------


def test_create_document_with_member_ids(client, db):
    user, tree = _setup(client, db)
    res = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={
            "title": "Census 1900",
            "description": "A note",
            "document_date": "1900",
            "member_ids": ["m1", "m2"],
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["title"] == "Census 1900"
    assert body["description"] == "A note"
    assert body["document_date"] == "1900"
    assert body["files"] == []
    assert set(body["member_ids"]) == {"m1", "m2"}
    assert body["event_ids"] == []
    assert body["story_ids"] == []
    assert "id" in body and "created_at" in body and "updated_at" in body


def test_list_documents(client, db):
    user, tree = _setup(client, db)
    client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc A"},
    )
    client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc B"},
    )
    res = client.get(f"{API}/trees/{tree.id}/documents", headers=auth(user))
    assert res.status_code == 200
    titles = {d["title"] for d in res.json()}
    assert titles == {"Doc A", "Doc B"}


def test_update_document(client, db):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Old title"},
    ).json()

    res = client.patch(
        f"{API}/trees/{tree.id}/documents/{created['id']}",
        headers=auth(user),
        json={"title": "New title", "description": "desc", "document_date": "2001"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "New title"
    assert body["description"] == "desc"
    assert body["document_date"] == "2001"
    assert body["updated_at"] != created["updated_at"]


def test_document_members_ignore_members_from_other_trees(client, db):
    user, tree = _setup(client, db)
    other_tree = make_tree(db, user, "Other")
    add_member(db, other_tree, "foreign")

    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc", "member_ids": ["m1", "foreign"]},
    ).json()
    assert created["member_ids"] == ["m1"]


def test_set_document_members_replaces_existing(client, db):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc", "member_ids": ["m1"]},
    ).json()

    res = client.put(
        f"{API}/trees/{tree.id}/documents/{created['id']}/members",
        headers=auth(user),
        json={"member_ids": ["m2"]},
    )
    assert res.status_code == 204

    doc = client.get(f"{API}/trees/{tree.id}/documents", headers=auth(user)).json()[0]
    assert doc["member_ids"] == ["m2"]


def test_document_file_upload_rename_delete(client, db, media_root):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()
    document_id = created["id"]

    upload = client.post(
        f"{API}/trees/{tree.id}/documents/{document_id}/files",
        headers=auth(user),
        data={"filename": "scan.txt"},
        files={"file": ("scan.txt", _DOC_BYTES, "text/plain")},
    )
    assert upload.status_code == 201, upload.text
    file_body = upload.json()
    assert file_body["kind"] == "file"
    assert file_body["filename"] == "scan.txt"
    assert file_body["url"].startswith("/api/media/")

    rel_path = file_body["url"][len("/api/media/"):]
    assert (media_root / rel_path).exists()

    rename = client.patch(
        f"{API}/trees/{tree.id}/documents/{document_id}/files/{file_body['id']}",
        headers=auth(user),
        json={"filename": "renamed.txt"},
    )
    assert rename.status_code == 200
    assert rename.json()["filename"] == "renamed.txt"

    delete = client.delete(
        f"{API}/trees/{tree.id}/documents/{document_id}/files/{file_body['id']}",
        headers=auth(user),
    )
    assert delete.status_code == 204
    assert not (media_root / rel_path).exists()

    doc = client.get(f"{API}/trees/{tree.id}/documents", headers=auth(user)).json()[0]
    assert doc["files"] == []


def test_document_file_upload_rejects_bad_checksum(client, db, media_root):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()

    upload = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/files",
        headers=auth(user),
        data={"filename": "scan.txt", "checksum": "0" * 64},
        files={"file": ("scan.txt", _DOC_BYTES, "text/plain")},
    )

    assert upload.status_code == 400
    assert upload.json()["detail"] == "Upload checksum does not match file data"
    tree_dir = media_root / tree.id
    assert not tree_dir.exists() or not list(tree_dir.iterdir())


def test_document_link_create(client, db):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()

    res = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/links",
        headers=auth(user),
        json={"url": "https://example.com/record", "filename": "External record"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["kind"] == "link"
    assert body["url"] == "https://example.com/record"
    assert body["filename"] == "External record"


def test_document_link_rejects_internal_media_url(client, db):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()

    res = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/links",
        headers=auth(user),
        json={"url": "/api/media/sneaky.txt"},
    )
    assert res.status_code == 400


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,unsafe",
        "file:///etc/passwd",
        "//example.com/path",
        "/api/media/tree/file.txt",
        "https://user:password@example.com/path",
        "https://example.com/line\nbreak",
        "https://example.com\\@evil.example/path",
    ],
)
def test_document_link_rejects_unsafe_url_schemes(client, db, url):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()

    response = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/links",
        headers=auth(user),
        json={"url": url},
    )
    assert response.status_code in {400, 422}


def test_delete_document_removes_files_from_disk(client, db, media_root):
    user, tree = _setup(client, db)
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(user),
        json={"title": "Doc"},
    ).json()
    upload = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/files",
        headers=auth(user),
        data={"filename": "scan.txt"},
        files={"file": ("scan.txt", _DOC_BYTES, "text/plain")},
    ).json()
    rel_path = upload["url"][len("/api/media/"):]
    assert (media_root / rel_path).exists()

    res = client.delete(
        f"{API}/trees/{tree.id}/documents/{created['id']}", headers=auth(user)
    )
    assert res.status_code == 204
    assert not (media_root / rel_path).exists()

    docs = client.get(f"{API}/trees/{tree.id}/documents", headers=auth(user)).json()
    assert docs == []


def test_create_document_tree_quota_exceeded(client, db):
    owner = make_user(db, "doc-quota-owner")
    owner.tree_quota_bytes = 1
    db.commit()
    tree = make_tree(db, owner, "SmallTree")

    res = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(owner),
        json={"title": "Doc"},
    )
    assert res.status_code == 413
    assert res.json()["detail"] == "quota_exceeded_tree"


def test_document_file_upload_media_quota_exceeded(client, db, media_root):
    owner = make_user(db, "doc-media-quota-owner")
    tree = make_tree(db, owner, "Tree")
    created = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=auth(owner),
        json={"title": "Doc"},
    ).json()

    owner.media_quota_bytes = 1
    db.commit()

    res = client.post(
        f"{API}/trees/{tree.id}/documents/{created['id']}/files",
        headers=auth(owner),
        data={"filename": "scan.txt"},
        files={"file": ("scan.txt", _DOC_BYTES, "text/plain")},
    )
    assert res.status_code == 413
    assert res.json()["detail"] == "quota_exceeded_media"


# ---------------------------------------------------------------------------
# Event / story <-> document links
# ---------------------------------------------------------------------------


def test_set_event_documents_replaces_existing(client, db):
    user, tree = _setup(client, db)
    client.post(
        f"{API}/trees/{tree.id}/events",
        headers=auth(user),
        json={
            "id": "e1", "event_type": "birth", "date": "2000", "created_at": "2000",
        },
    )
    doc_a = client.post(
        f"{API}/trees/{tree.id}/documents", headers=auth(user), json={"title": "A"},
    ).json()
    doc_b = client.post(
        f"{API}/trees/{tree.id}/documents", headers=auth(user), json={"title": "B"},
    ).json()

    res = client.put(
        f"{API}/trees/{tree.id}/events/e1/documents",
        headers=auth(user),
        json={"document_ids": [doc_a["id"], doc_b["id"]]},
    )
    assert res.status_code == 204

    events = client.get(f"{API}/trees/{tree.id}/events", headers=auth(user)).json()
    assert set(events[0]["document_ids"]) == {doc_a["id"], doc_b["id"]}

    # Replace with just one document.
    res = client.put(
        f"{API}/trees/{tree.id}/events/e1/documents",
        headers=auth(user),
        json={"document_ids": [doc_a["id"]]},
    )
    assert res.status_code == 204
    events = client.get(f"{API}/trees/{tree.id}/events", headers=auth(user)).json()
    assert events[0]["document_ids"] == [doc_a["id"]]


def test_set_story_documents_replaces_existing(client, db):
    user, tree = _setup(client, db)
    client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=auth(user),
        json={
            "id": "s1", "title": "Tale", "created_at": "2000", "updated_at": "2000",
        },
    )
    doc_a = client.post(
        f"{API}/trees/{tree.id}/documents", headers=auth(user), json={"title": "A"},
    ).json()
    doc_b = client.post(
        f"{API}/trees/{tree.id}/documents", headers=auth(user), json={"title": "B"},
    ).json()

    res = client.put(
        f"{API}/trees/{tree.id}/stories/s1/documents",
        headers=auth(user),
        json={"document_ids": [doc_a["id"], doc_b["id"]]},
    )
    assert res.status_code == 204

    stories = client.get(f"{API}/trees/{tree.id}/stories", headers=auth(user)).json()
    assert set(stories[0]["document_ids"]) == {doc_a["id"], doc_b["id"]}

    res = client.put(
        f"{API}/trees/{tree.id}/stories/s1/documents",
        headers=auth(user),
        json={"document_ids": [doc_b["id"]]},
    )
    assert res.status_code == 204
    stories = client.get(f"{API}/trees/{tree.id}/stories", headers=auth(user)).json()
    assert stories[0]["document_ids"] == [doc_b["id"]]
