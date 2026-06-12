from app.models import (
    Event,
    EventMemberLink,
    GalleryImage,
    GalleryMemberLink,
    MemberDisease,
    Relation,
    Story,
    StoryMemberLink,
)
from tests.conftest import API, add_member, auth, make_tree, make_user


def _ids(response):
    return [item["id"] for item in response.json()]


def test_members_preserve_default_full_list_and_support_limit_offset(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    for member_id in ["m0", "m1", "m2"]:
        add_member(db, tree, member_id, firstName=member_id)

    default = client.get(f"{API}/trees/{tree.id}/members", headers=auth(user))
    assert default.status_code == 200
    assert _ids(default) == ["m0", "m1", "m2"]

    page = client.get(
        f"{API}/trees/{tree.id}/members",
        headers=auth(user),
        params={"limit": 1, "offset": 1},
    )
    assert page.status_code == 200
    assert _ids(page) == ["m1"]


def test_family_collection_endpoints_support_pagination(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0")
    add_member(db, tree, "m1")
    add_member(db, tree, "m2")
    db.add_all(
        [
            Relation(
                tree_id=tree.id,
                from_member_id="m0",
                to_member_id="m1",
                relation_type="parent",
            ),
            Relation(
                tree_id=tree.id,
                from_member_id="m1",
                to_member_id="m2",
                relation_type="parent",
            ),
            MemberDisease(
                id="d0",
                tree_id=tree.id,
                member_id="m0",
                name="A",
                carrier_status="affected",
            ),
            MemberDisease(
                id="d1",
                tree_id=tree.id,
                member_id="m1",
                name="B",
                carrier_status="carrier",
            ),
        ]
    )
    db.commit()

    relations = client.get(
        f"{API}/trees/{tree.id}/relations",
        headers=auth(user),
        params={"limit": 1, "offset": 1},
    )
    assert relations.status_code == 200
    assert relations.json()[0]["from_member_id"] == "m1"

    diseases = client.get(
        f"{API}/trees/{tree.id}/diseases",
        headers=auth(user),
        params={"limit": 1, "offset": 1},
    )
    assert diseases.status_code == 200
    assert _ids(diseases) == ["d1"]


def test_content_collection_endpoints_support_pagination(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m0")
    add_member(db, tree, "m1")
    db.add_all(
        [
            GalleryImage(id="g0", tree_id=tree.id, title="A", uploadedAt="2024-01-01"),
            GalleryImage(id="g1", tree_id=tree.id, title="B", uploadedAt="2024-01-02"),
            GalleryMemberLink(gallery_image_id="g0", member_id="m0"),
            GalleryMemberLink(gallery_image_id="g1", member_id="m1"),
            Event(
                id="e0", tree_id=tree.id, event_type="birth", date="1900", created_at="1"
            ),
            Event(
                id="e1", tree_id=tree.id, event_type="death", date="2000", created_at="2"
            ),
            EventMemberLink(event_id="e0", member_id="m0"),
            EventMemberLink(event_id="e1", member_id="m1"),
            Story(
                id="s0",
                tree_id=tree.id,
                title="A",
                created_at="1",
                updated_at="1",
            ),
            Story(
                id="s1",
                tree_id=tree.id,
                title="B",
                created_at="2",
                updated_at="2",
            ),
            StoryMemberLink(story_id="s0", member_id="m0"),
            StoryMemberLink(story_id="s1", member_id="m1"),
        ]
    )
    db.commit()

    params = {"limit": 1, "offset": 1}
    headers = auth(user)
    assert _ids(
        client.get(
            f"{API}/trees/{tree.id}/gallery/images", headers=headers, params=params
        )
    ) == ["g1"]
    assert client.get(
        f"{API}/trees/{tree.id}/gallery/links", headers=headers, params=params
    ).json() == [{"gallery_image_id": "g1", "member_id": "m1"}]
    assert _ids(
        client.get(f"{API}/trees/{tree.id}/events", headers=headers, params=params)
    ) == ["e1"]
    assert client.get(
        f"{API}/trees/{tree.id}/events/links", headers=headers, params=params
    ).json() == [{"event_id": "e1", "member_id": "m1"}]
    assert _ids(
        client.get(f"{API}/trees/{tree.id}/stories", headers=headers, params=params)
    ) == ["s1"]
    assert client.get(
        f"{API}/trees/{tree.id}/stories/links", headers=headers, params=params
    ).json() == [{"story_id": "s1", "member_id": "m1"}]


def test_pagination_rejects_invalid_limit(client, db):
    user = make_user(db, "alice")
    tree = make_tree(db, user)

    response = client.get(
        f"{API}/trees/{tree.id}/members",
        headers=auth(user),
        params={"limit": 0},
    )
    assert response.status_code == 422
