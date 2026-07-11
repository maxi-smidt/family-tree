import io

from app.api.routes.export_import import BUNDLE_VERSION
from app.models import Member
from app.services import crypto_export
from tests.conftest import API, auth, make_tree, make_user, wait_for_job


def test_native_export_import_preserves_member_name_details(client, db):
    owner = make_user(db, "native-export-owner")
    tree = make_tree(db, owner, "Name details")
    headers = auth(owner)

    created = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={
            "id": "member-1",
            "firstName": "Anna",
            "middleNames": "Maria Theresia",
            "baptismalName": "Maria",
            "lastName": "Schmidt",
            "gender": "f",
        },
    )
    assert created.status_code == 201

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": (
                "name-details.treedb",
                io.BytesIO(exported.content),
                "application/octet-stream",
            )
        },
    )
    assert imported.status_code == 202, imported.text
    tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    members = client.get(
        f"{API}/trees/{tree_id}/members", headers=headers
    ).json()
    assert len(members) == 1
    assert members[0]["middleNames"] == "Maria Theresia"
    assert members[0]["baptismalName"] == "Maria"


def test_export_bundle_includes_provenance(client, db):
    owner = make_user(db, "provenance-export-owner")
    tree = make_tree(db, owner, "Provenance tree")
    headers = auth(owner)

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    bundle = crypto_export.decrypt_bundle(exported.content, None)
    assert bundle["version"] == BUNDLE_VERSION
    assert "app_version" in bundle
    assert bundle["app_version"]  # non-empty ("dev" in tests)
    assert "exported_at" in bundle
    assert bundle["exported_at"]


def test_native_export_password_is_sent_in_post_body(client, db):
    owner = make_user(db, "password-export-owner")
    tree = make_tree(db, owner, "Password export")
    headers = auth(owner)

    assert client.get(
        f"{API}/trees/{tree.id}/export?password=leaked", headers=headers
    ).status_code == 405

    exported = client.post(
        f"{API}/trees/{tree.id}/export",
        headers=headers,
        json={"password": "body-only-password"},
    )
    assert exported.status_code == 200
    assert exported.headers["Cache-Control"] == "no-store"
    bundle = crypto_export.decrypt_bundle(exported.content, "body-only-password")
    assert bundle["tree"]["name"] == "Password export"


def test_inspect_returns_provenance(client, db):
    owner = make_user(db, "provenance-inspect-owner")
    tree = make_tree(db, owner, "Inspect provenance")
    headers = auth(owner)

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    result = client.post(
        f"{API}/trees/import/inspect",
        headers=headers,
        files={
            "file": (
                "test.treedb",
                io.BytesIO(exported.content),
                "application/octet-stream",
            )
        },
    )
    assert result.status_code == 200
    data = result.json()
    assert data["password_required"] is False
    assert data["app_version"] is not None
    assert data["exported_at"] is not None
    assert data["bundle_version"] == BUNDLE_VERSION
    assert data["name"] == "Inspect provenance"


def test_import_rejects_future_bundle_version(client, db):
    owner = make_user(db, "future-bundle-owner")
    headers = auth(owner)

    future_bundle = {
        "version": BUNDLE_VERSION + 1,
        "app_version": "99.0.0",
        "exported_at": "2099-01-01T00:00:00",
        "tree": {"name": "Future", "created_at": "2099-01-01T00:00:00"},
        "members": [],
        "relations": [],
        "relation_types": [],
        "diseases": [],
        "gallery_images": [],
        "gallery_links": [],
        "events": [],
        "event_links": [],
        "stories": [],
        "story_links": [],
        "documents": [],
        "document_files": [],
        "document_member_links": [],
        "event_document_links": [],
        "story_document_links": [],
    }
    blob = crypto_export.encrypt_bundle(future_bundle, None)

    resp = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={"file": ("future.treedb", io.BytesIO(blob), "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "newer version" in resp.json()["detail"]

    resp2 = client.post(
        f"{API}/trees/import/inspect",
        headers=headers,
        files={"file": ("future.treedb", io.BytesIO(blob), "application/octet-stream")},
    )
    assert resp2.status_code == 400
    assert "newer version" in resp2.json()["detail"]


# ---------------------------------------------------------------------------
# Bulk-insert sort-key tests (#433)
# ---------------------------------------------------------------------------

def test_import_preserves_date_of_birth_sort(client, db):
    """Bundle import via bulk inserts must populate date_of_birth_sort correctly."""
    owner = make_user(db, "sort-key-owner")
    tree = make_tree(db, owner, "Sort Key Tree")
    headers = auth(owner)

    # Create a member with a known birth date.
    resp = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={
            "id": "sort-member-1",
            "firstName": "Karl",
            "lastName": "Sortson",
            "gender": "m",
            "dateOfBirth": "1950-06-15",
        },
    )
    assert resp.status_code == 201

    # Export and re-import.
    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": (
                "sort-key.treedb",
                io.BytesIO(exported.content),
                "application/octet-stream",
            )
        },
    )
    assert imported.status_code == 202, imported.text
    new_tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    # Query the DB directly to check the sort column.
    from sqlalchemy import select as sa_select
    member_row = db.scalars(
        sa_select(Member).where(Member.tree_id == new_tree_id)
    ).first()
    assert member_row is not None
    assert member_row.date_of_birth_sort == "1950-06-15"


def test_import_old_bundle_without_sort_keys_recomputes_them(client, db):
    """Older bundles without date_*_sort must have sort keys recomputed on import."""
    owner = make_user(db, "old-bundle-owner")
    tree = make_tree(db, owner, "Old Bundle Tree")
    headers = auth(owner)

    resp = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={
            "id": "old-member-1",
            "firstName": "Hans",
            "lastName": "Oldenburg",
            "gender": "m",
            "dateOfBirth": "1880-03-20",
        },
    )
    assert resp.status_code == 201

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    # Simulate an older bundle by stripping the sort keys from the member dicts.
    bundle = crypto_export.decrypt_bundle(exported.content, None)
    for m in bundle["members"]:
        m.pop("date_of_birth_sort", None)
        m.pop("date_of_death_sort", None)
    old_blob = crypto_export.encrypt_bundle(bundle, None)

    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": (
                "old-bundle.treedb",
                io.BytesIO(old_blob),
                "application/octet-stream",
            )
        },
    )
    assert imported.status_code == 202, imported.text
    new_tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    from sqlalchemy import select as sa_select
    member_row = db.scalars(
        sa_select(Member).where(Member.tree_id == new_tree_id)
    ).first()
    assert member_row is not None
    # Sort key must be recomputed even though the bundle didn't include it.
    assert member_row.date_of_birth_sort == "1880-03-20"


def test_document_round_trip_preserves_files_and_links(client, db):
    """Export → import must reproduce a document, its files, the people it
    mentions, and its event/story links (documents #594)."""
    owner = make_user(db, "doc-round-trip-owner")
    tree = make_tree(db, owner, "Doc Tree")
    headers = auth(owner)

    member_resp = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={"id": "m1", "firstName": "Ada", "lastName": "Lovelace"},
    )
    assert member_resp.status_code == 201

    event_resp = client.post(
        f"{API}/trees/{tree.id}/events",
        headers=headers,
        json={
            "id": "e1", "event_type": "birth", "date": "1900",
            "created_at": "1900-01-01T00:00:00Z",
        },
    )
    assert event_resp.status_code == 201

    story_resp = client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=headers,
        json={"id": "s1", "title": "Tale", "created_at": "1900", "updated_at": "1900"},
    )
    assert story_resp.status_code == 201

    doc_resp = client.post(
        f"{API}/trees/{tree.id}/documents",
        headers=headers,
        json={"title": "Census 1900", "description": "notes", "member_ids": ["m1"]},
    )
    assert doc_resp.status_code == 201, doc_resp.text
    document_id = doc_resp.json()["id"]

    file_resp = client.post(
        f"{API}/trees/{tree.id}/documents/{document_id}/files",
        headers=headers,
        json={"filename": "scan.txt", "data": "data:text/plain;base64,aGVsbG8="},
    )
    assert file_resp.status_code == 201, file_resp.text

    link_resp = client.post(
        f"{API}/trees/{tree.id}/documents/{document_id}/links",
        headers=headers,
        json={"url": "https://example.com/record", "filename": "External record"},
    )
    assert link_resp.status_code == 201, link_resp.text

    assert client.put(
        f"{API}/trees/{tree.id}/events/e1/documents",
        headers=headers,
        json={"document_ids": [document_id]},
    ).status_code == 204

    assert client.put(
        f"{API}/trees/{tree.id}/stories/s1/documents",
        headers=headers,
        json={"document_ids": [document_id]},
    ).status_code == 204

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": (
                "doc-round-trip.treedb",
                io.BytesIO(exported.content),
                "application/octet-stream",
            )
        },
    )
    assert imported.status_code == 202, imported.text
    new_tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    docs = client.get(f"{API}/trees/{new_tree_id}/documents", headers=headers).json()
    assert len(docs) == 1
    doc = docs[0]
    assert doc["title"] == "Census 1900"
    assert doc["description"] == "notes"
    assert len(doc["files"]) == 2
    assert {f["kind"] for f in doc["files"]} == {"file", "link"}
    assert len(doc["member_ids"]) == 1
    assert len(doc["event_ids"]) == 1
    assert len(doc["story_ids"]) == 1

    events = client.get(f"{API}/trees/{new_tree_id}/events", headers=headers).json()
    assert events[0]["document_ids"] == [doc["id"]]

    stories = client.get(f"{API}/trees/{new_tree_id}/stories", headers=headers).json()
    assert stories[0]["document_ids"] == [doc["id"]]


def test_import_relations_bulk_path(client, db):
    """Relations must be imported correctly via the bulk-insert path."""
    owner = make_user(db, "bulk-rel-owner")
    tree = make_tree(db, owner, "Bulk Relations Tree")
    headers = auth(owner)

    parent_resp = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={
            "id": "bulk-parent",
            "firstName": "Parent",
            "lastName": "Bulk",
            "gender": "f",
        },
    )
    assert parent_resp.status_code == 201

    child_resp = client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={
            "id": "bulk-child",
            "firstName": "Child",
            "lastName": "Bulk",
            "gender": "m",
        },
    )
    assert child_resp.status_code == 201

    rel_resp = client.post(
        f"{API}/trees/{tree.id}/relations",
        headers=headers,
        json={
            "from_member_id": "bulk-child",
            "to_member_id": "bulk-parent",
            "relation_type": "parent",
        },
    )
    assert rel_resp.status_code == 201

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200

    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": (
                "bulk-rel.treedb",
                io.BytesIO(exported.content),
                "application/octet-stream",
            )
        },
    )
    assert imported.status_code == 202, imported.text
    new_tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    relations_resp = client.get(
        f"{API}/trees/{new_tree_id}/relations", headers=headers
    )
    assert relations_resp.status_code == 200
    parent_rels = [
        r for r in relations_resp.json() if r["relation_type"] == "parent"
    ]
    assert len(parent_rels) == 1
