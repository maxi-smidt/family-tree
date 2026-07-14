import io

from app.api.routes.export_import import BUNDLE_VERSION
from app.models import Member
from app.services import crypto_export
from tests.conftest import API, auth, make_tree, make_user, wait_for_job

# Snapshot of the top-level keys the export bundle carries, per BUNDLE_VERSION.
# If the exported key set changes you MUST bump BUNDLE_VERSION, add a
# migrate_bundle step, and record the new key set here — otherwise an older
# instance would accept a newer bundle at the (unchanged) version gate and
# silently drop the added data. This guard is what would have caught #661.
EXPECTED_BUNDLE_KEYS = {
    3: {
        "version", "app_version", "exported_at", "tree",
        "members", "relations", "relation_types", "diseases",
        "gallery_images", "gallery_links",
        "events", "event_links",
        "stories", "story_links",
        "documents", "document_files",
        "document_member_links", "event_document_links", "story_document_links",
    },
}


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
        data={"filename": "scan.txt"},
        files={"file": ("scan.txt", b"hello", "text/plain")},
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


# ---------------------------------------------------------------------------
# Bundle compatibility: schema-version guard + pre-1.7 migration (#661)
# ---------------------------------------------------------------------------

def test_bundle_schema_matches_version_snapshot(client, db):
    """Guard: the exported bundle keys must not drift without a version bump.

    A changed key set at an unchanged BUNDLE_VERSION is exactly what let a v1.6
    bundle pass the ``version > BUNDLE_VERSION`` gate and then drop its data.
    """
    owner = make_user(db, "bundle-schema-owner")
    tree = make_tree(db, owner, "Schema tree")
    headers = auth(owner)

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    assert exported.status_code == 200
    bundle = crypto_export.decrypt_bundle(exported.content, None)

    assert bundle["version"] == BUNDLE_VERSION
    assert BUNDLE_VERSION in EXPECTED_BUNDLE_KEYS, (
        "Bundle schema version changed without a snapshot. Bump BUNDLE_VERSION, "
        "add a migrate_bundle step, and record the key set in EXPECTED_BUNDLE_KEYS."
    )
    assert set(bundle.keys()) == EXPECTED_BUNDLE_KEYS[BUNDLE_VERSION], (
        "Exported bundle keys drifted from the snapshot for this BUNDLE_VERSION. "
        "If intentional, bump BUNDLE_VERSION and add a migrate_bundle step."
    )


def test_import_pre_v17_bundle_migrates_sources_to_documents(client, db):
    """A pre-1.7 (bundle v2) backup's sources/citations/evidence and story
    attachments must be migrated into Documents on import, not silently dropped
    (#661)."""
    owner = make_user(db, "legacy-bundle-owner")
    tree = make_tree(db, owner, "Legacy tree")
    headers = auth(owner)

    # Real member + story so the exported bundle carries valid member/story rows
    # we can reference from the synthesized legacy sources/attachments.
    assert client.post(
        f"{API}/trees/{tree.id}/members",
        headers=headers,
        json={"id": "m1", "firstName": "Ada", "lastName": "Lovelace"},
    ).status_code == 201
    assert client.post(
        f"{API}/trees/{tree.id}/stories",
        headers=headers,
        json={
            "id": "st1", "title": "A tale",
            "created_at": "1900", "updated_at": "1900",
        },
    ).status_code == 201

    exported = client.post(f"{API}/trees/{tree.id}/export", headers=headers, json={})
    bundle = crypto_export.decrypt_bundle(exported.content, None)
    tree_id = bundle["members"][0]["tree_id"]
    member_id = bundle["members"][0]["id"]
    story_id = bundle["stories"][0]["id"]

    # Downgrade the freshly exported v3 bundle to a v1.6-shaped v2 bundle: drop
    # the Documents keys and add the legacy source/citation/evidence/attachment
    # keys a pre-1.7 export carried.
    legacy = dict(bundle)
    legacy["version"] = 2
    for key in (
        "documents", "document_files", "document_member_links",
        "event_document_links", "story_document_links",
    ):
        legacy.pop(key, None)
    legacy["sources"] = [
        {
            "id": "src1", "tree_id": tree_id, "title": "Old Source",
            "author": "A. Historian", "publication_info": "Vol 3",
            "repository": "Archives", "source_date": "1900", "notes": "ledger",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
        }
    ]
    legacy["source_evidence"] = [
        {
            "id": "ev1", "tree_id": tree_id, "source_id": "src1", "kind": "file",
            "filename": "scan.txt", "url": "data:text/plain;base64,aGVsbG8=",
            "mime_type": "text/plain", "size": 5,
            "created_at": "2024-01-01T00:00:00Z",
        }
    ]
    legacy["citations"] = [
        {
            "id": "cit1", "tree_id": tree_id, "source_id": "src1",
            "member_id": member_id, "fact_type": "birth", "page": "42",
            "detail": "line 3", "created_at": "2024-01-01T00:00:00Z",
        }
    ]
    legacy["story_attachments"] = [
        {
            "id": "att1", "tree_id": tree_id, "story_id": story_id,
            "filename": "attach.txt", "url": "data:text/plain;base64,d29ybGQ=",
            "mime_type": "text/plain", "size": 5,
            "created_at": "2024-03-01T00:00:00Z",
        }
    ]

    blob = crypto_export.encrypt_bundle(legacy, None)
    imported = client.post(
        f"{API}/trees/import",
        headers=headers,
        files={
            "file": ("legacy.treedb", io.BytesIO(blob), "application/octet-stream")
        },
    )
    assert imported.status_code == 202, imported.text
    new_tree_id = wait_for_job(client, headers, imported.json()["job_id"])

    docs = client.get(f"{API}/trees/{new_tree_id}/documents", headers=headers).json()
    assert len(docs) == 2, docs
    by_title = {d["title"]: d for d in docs}
    assert set(by_title) == {"Old Source", "attach.txt"}

    source_doc = by_title["Old Source"]
    assert source_doc["document_date"] == "1900"
    assert "Author: A. Historian" in source_doc["description"]
    assert "Ada Lovelace — birth, page 42: line 3" in source_doc["description"]
    assert len(source_doc["member_ids"]) == 1
    assert len(source_doc["files"]) == 1
    assert source_doc["files"][0]["kind"] == "file"

    attach_doc = by_title["attach.txt"]
    assert len(attach_doc["story_ids"]) == 1
    assert len(attach_doc["files"]) == 1
    assert attach_doc["files"][0]["kind"] == "file"
