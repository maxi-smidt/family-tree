import io

from tests.conftest import API, auth, make_tree, make_user


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
    assert imported.status_code == 201, imported.text

    members = client.get(
        f"{API}/trees/{imported.json()['id']}/members", headers=headers
    ).json()
    assert len(members) == 1
    assert members[0]["middleNames"] == "Maria Theresia"
    assert members[0]["baptismalName"] == "Maria"
