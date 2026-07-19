"""Unknown-face tags that create research tasks (issue #736)."""

from app.models import GalleryImage, GalleryMemberLink, GalleryUnknownFace, MemberTask
from tests.conftest import API, add_member, auth, make_tree, make_user, share


def _setup(client, db, owner_name="unknown-face-owner"):
    owner = make_user(db, owner_name)
    tree = make_tree(db, owner)
    db.add(GalleryImage(id="img1", tree_id=tree.id, title="Reunion photo"))
    db.commit()
    return owner, tree


def _create_face(client, owner, tree, image_id="img1", **overrides):
    payload = {
        "id": "face1",
        "x": 0.1,
        "y": 0.2,
        "w": 0.3,
        "h": 0.4,
        "created_at": "2026-01-01T00:00:00Z",
        **overrides,
    }
    return client.post(
        f"{API}/trees/{tree.id}/gallery/images/{image_id}/unknown-faces",
        headers=auth(owner),
        json=payload,
    )


def test_create_unknown_face_creates_exactly_one_open_task(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["id"] == "face1"
    assert body["gallery_image_id"] == "img1"
    assert body["task_id"] is not None

    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(owner)).json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == body["task_id"]
    assert tasks[0]["done"] is False
    assert tasks[0]["member_ids"] == []
    assert 'Reunion photo' in tasks[0]["title"]


def test_create_unknown_face_task_title_and_notes_passthrough(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(
        client, owner, tree,
        task_title="Wer ist das?", task_notes="Aufgenommen 1950",
    )
    assert res.status_code == 201
    task_id = res.json()["task_id"]
    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(owner)).json()
    task = next(t for t in tasks if t["id"] == task_id)
    assert task["title"] == "Wer ist das?"
    assert task["notes"] == "Aufgenommen 1950"


def test_create_unknown_face_falls_back_to_english_title(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]
    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(owner)).json()
    task = next(t for t in tasks if t["id"] == task_id)
    assert task["title"] == 'Identify unknown person in "Reunion photo"'
    assert task["notes"] is None


def test_create_unknown_face_region_validation(client, db):
    owner, tree = _setup(client, db)

    incomplete = client.post(
        f"{API}/trees/{tree.id}/gallery/images/img1/unknown-faces",
        headers=auth(owner),
        json={"id": "face1", "x": 0.1, "y": 0.2, "created_at": "2026-01-01"},
    )
    assert incomplete.status_code == 422

    out_of_bounds = _create_face(client, owner, tree, x=0.8, y=0.2, w=0.3, h=0.4)
    assert out_of_bounds.status_code == 422

    zero_size = _create_face(client, owner, tree, w=0)
    assert zero_size.status_code == 422


def test_update_unknown_face_region_creates_no_additional_task(client, db):
    owner, tree = _setup(client, db)
    _create_face(client, owner, tree)

    res = client.patch(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1",
        headers=auth(owner),
        json={"x": 0.15, "y": 0.25, "w": 0.35, "h": 0.45},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["x"] == 0.15
    assert body["y"] == 0.25

    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(owner)).json()
    assert len(tasks) == 1


def test_resolve_unknown_face_creates_member_link_and_completes_task(client, db):
    owner, tree = _setup(client, db)
    add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]

    resolve = client.post(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1/resolve",
        headers=auth(owner),
        json={"member_id": "m1"},
    )
    assert resolve.status_code == 204, resolve.text

    links = client.get(
        f"{API}/trees/{tree.id}/gallery/links", headers=auth(owner)
    ).json()
    assert links == [
        {
            "gallery_image_id": "img1", "member_id": "m1",
            "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4,
        }
    ]

    faces = db.query(GalleryUnknownFace).all()
    assert faces == []

    tasks = client.get(f"{API}/trees/{tree.id}/tasks", headers=auth(owner)).json()
    task = next(t for t in tasks if t["id"] == task_id)
    assert task["done"] is True
    assert task["done_at"] is not None


def test_resolve_unknown_face_overwrites_existing_whole_image_link(client, db):
    owner, tree = _setup(client, db)
    add_member(db, tree, "m1", first_name="Ada", last_name="Lovelace")
    db.add(GalleryMemberLink(gallery_image_id="img1", member_id="m1"))
    db.commit()
    _create_face(client, owner, tree)

    resolve = client.post(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1/resolve",
        headers=auth(owner),
        json={"member_id": "m1"},
    )
    assert resolve.status_code == 204, resolve.text

    links = client.get(f"{API}/trees/{tree.id}/gallery/links", headers=auth(owner)).json()
    assert len(links) == 1
    assert links[0]["member_id"] == "m1"
    assert links[0]["x"] == 0.1
    assert links[0]["y"] == 0.2
    assert links[0]["w"] == 0.3
    assert links[0]["h"] == 0.4


def test_resolve_unknown_face_404_for_unknown_member(client, db):
    owner, tree = _setup(client, db)
    _create_face(client, owner, tree)
    resolve = client.post(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1/resolve",
        headers=auth(owner),
        json={"member_id": "nope"},
    )
    assert resolve.status_code == 404


def test_delete_unknown_face_removes_open_task(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]

    delete = client.delete(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1", headers=auth(owner)
    )
    assert delete.status_code == 204

    assert db.query(GalleryUnknownFace).all() == []
    assert db.get(MemberTask, task_id) is None


def test_delete_unknown_face_keeps_done_task(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]

    done = client.patch(
        f"{API}/trees/{tree.id}/tasks/{task_id}",
        headers=auth(owner),
        json={"title": "x", "notes": None, "done": True, "done_at": "2026-02-01"},
    )
    assert done.status_code == 200

    delete = client.delete(
        f"{API}/trees/{tree.id}/gallery/unknown-faces/face1", headers=auth(owner)
    )
    assert delete.status_code == 204

    assert db.query(GalleryUnknownFace).all() == []
    assert db.get(MemberTask, task_id) is not None


def test_completing_task_via_tasks_route_leaves_face_intact(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]

    done = client.patch(
        f"{API}/trees/{tree.id}/tasks/{task_id}",
        headers=auth(owner),
        json={"title": "x", "notes": None, "done": True, "done_at": "2026-02-01"},
    )
    assert done.status_code == 200

    face = db.get(GalleryUnknownFace, "face1")
    assert face is not None
    assert face.task_id == task_id


def test_deleting_task_via_tasks_route_nulls_face_task_id(client, db):
    owner, tree = _setup(client, db)
    res = _create_face(client, owner, tree)
    task_id = res.json()["task_id"]

    delete_task = client.delete(
        f"{API}/trees/{tree.id}/tasks/{task_id}", headers=auth(owner)
    )
    assert delete_task.status_code == 204

    db.expire_all()
    face = db.get(GalleryUnknownFace, "face1")
    assert face is not None
    assert face.task_id is None


def test_unknown_face_writes_require_editor_or_owner(client, db):
    owner, tree = _setup(client, db)
    viewer = make_user(db, "unknown-face-viewer")
    share(db, tree, viewer, "viewer")
    _create_face(client, owner, tree)

    assert (
        client.post(
            f"{API}/trees/{tree.id}/gallery/images/img1/unknown-faces",
            headers=auth(viewer),
            json={
                "id": "face2", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1,
                "created_at": "2026-01-01",
            },
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{API}/trees/{tree.id}/gallery/unknown-faces/face1",
            headers=auth(viewer),
            json={"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{API}/trees/{tree.id}/gallery/unknown-faces/face1/resolve",
            headers=auth(viewer),
            json={"member_id": "m1"},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"{API}/trees/{tree.id}/gallery/unknown-faces/face1",
            headers=auth(viewer),
        ).status_code
        == 403
    )


def test_research_tasks_flag_off_rejects_create_but_get_still_works(client, db):
    admin = make_user(db, "unknown-face-admin", is_admin=True)
    owner, tree = _setup(client, db, "unknown-face-flag-owner")
    _create_face(client, owner, tree)

    off = client.patch(
        f"{API}/admin/features/research_tasks",
        headers=auth(admin),
        json={"state": "off"},
    )
    assert off.status_code == 200

    # Existing tags stay visible.
    listed = client.get(
        f"{API}/trees/{tree.id}/gallery/unknown-faces", headers=auth(owner)
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    rejected = _create_face(client, owner, tree, id="face2")
    assert rejected.status_code == 404


def test_unknown_face_for_image_in_another_tree_is_404(client, db):
    owner, tree = _setup(client, db)
    other_owner = make_user(db, "unknown-face-other-owner")
    other_tree = make_tree(db, other_owner, "Other")
    _create_face(client, owner, tree)

    res = client.patch(
        f"{API}/trees/{other_tree.id}/gallery/unknown-faces/face1",
        headers=auth(other_owner),
        json={"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1},
    )
    assert res.status_code == 404
