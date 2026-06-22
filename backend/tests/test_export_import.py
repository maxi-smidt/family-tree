import io

from app.api.routes.export_import import BUNDLE_VERSION
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

    exported = client.get(f"{API}/trees/{tree.id}/export", headers=headers)
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

    exported = client.get(f"{API}/trees/{tree.id}/export", headers=headers)
    assert exported.status_code == 200

    bundle = crypto_export.decrypt_bundle(exported.content, None)
    assert bundle["version"] == BUNDLE_VERSION
    assert "app_version" in bundle
    assert bundle["app_version"]  # non-empty ("dev" in tests)
    assert "exported_at" in bundle
    assert bundle["exported_at"]


def test_inspect_returns_provenance(client, db):
    owner = make_user(db, "provenance-inspect-owner")
    tree = make_tree(db, owner, "Inspect provenance")
    headers = auth(owner)

    exported = client.get(f"{API}/trees/{tree.id}/export", headers=headers)
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
        "story_attachments": [],
        "sources": [],
        "source_evidence": [],
        "citations": [],
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
