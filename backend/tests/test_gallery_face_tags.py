"""Gallery face-region links (issue #728)."""

from app.models import GalleryImage, GalleryMemberLink
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def test_gallery_links_replace_whole_image_links_with_normalized_regions(client, db):
    owner = make_user(db, "face-tag-owner")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")
    add_member(db, tree, "m2", first_name="Grace", last_name="Hopper")
    db.add(GalleryImage(id="img1", workspace_id=tree.id, title="Group photo"))
    db.add(GalleryMemberLink(gallery_image_id="img1", member_id="m1"))
    db.commit()

    before = client.get(f"{API}/workspaces/{tree.id}/gallery/links", headers=auth(owner))
    assert before.status_code == 200
    assert before.json() == [
        {
            "gallery_image_id": "img1",
            "member_id": "m1",
            "x": None,
            "y": None,
            "w": None,
            "h": None,
        }
    ]

    updated = client.put(
        f"{API}/workspaces/{tree.id}/gallery/images/img1/links",
        headers=auth(owner),
        json={
            "links": [
                {"member_id": "m1", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
                {"member_id": "m2", "x": 0.5, "y": 0.1, "w": 0.2, "h": 0.25},
            ]
        },
    )
    assert updated.status_code == 204, updated.text

    links = client.get(
        f"{API}/workspaces/{tree.id}/gallery/links", headers=auth(owner)
    ).json()
    assert links == [
        {
            "gallery_image_id": "img1",
            "member_id": "m1",
            "x": 0.1,
            "y": 0.2,
            "w": 0.3,
            "h": 0.4,
        },
        {
            "gallery_image_id": "img1",
            "member_id": "m2",
            "x": 0.5,
            "y": 0.1,
            "w": 0.2,
            "h": 0.25,
        },
    ]


def test_gallery_face_tag_regions_must_be_complete_and_fit_the_image(client, db):
    owner = make_user(db, "invalid-face-tag-owner")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    db.add(GalleryImage(id="img1", workspace_id=tree.id, title="Photo"))
    db.commit()

    incomplete = client.put(
        f"{API}/workspaces/{tree.id}/gallery/images/img1/links",
        headers=auth(owner),
        json={"links": [{"member_id": "m1", "x": 0.1, "y": 0.2}]},
    )
    assert incomplete.status_code == 422

    out_of_bounds = client.put(
        f"{API}/workspaces/{tree.id}/gallery/images/img1/links",
        headers=auth(owner),
        json={"links": [{"member_id": "m1", "x": 0.8, "y": 0.2, "w": 0.3, "h": 0.4}]},
    )
    assert out_of_bounds.status_code == 422


def test_gallery_face_tag_writes_require_editor_or_owner(client, db):
    owner = make_user(db, "face-tag-write-owner")
    viewer = make_user(db, "face-tag-viewer")
    tree = make_tree(db, owner)
    add_member(db, tree, "m1")
    db.add(GalleryImage(id="img1", workspace_id=tree.id, title="Photo"))
    db.add(
        GalleryMemberLink(
            gallery_image_id="img1", member_id="m1", x=0.1, y=0.2, w=0.3, h=0.4
        )
    )
    share(db, tree, viewer, "viewer")
    db.commit()

    read = client.get(f"{API}/workspaces/{tree.id}/gallery/links", headers=auth(viewer))
    assert read.status_code == 200
    assert read.json()[0]["x"] == 0.1

    write = client.put(
        f"{API}/workspaces/{tree.id}/gallery/images/img1/links",
        headers=auth(viewer),
        json={"links": []},
    )
    assert write.status_code == 403
