"""Evidence for person fields: documents cited for names, dates and birthplace."""

import pytest

from app.core.config import settings
from app.db.base import utcnow_iso
from app.models import (
    ActivityLog,
    ContentScope,
    Document,
    DocumentFile,
    DocumentMemberLink,
    MemberFieldCitation,
    Section,
    SectionMember,
    WorkspaceMembership,
    WorkspaceSectionGrant,
)
from app.services import crypto_export
from app.services.documents.citations import plain_text
from app.services.workspaces.merge import merge_trees
from tests.conftest import API, add_member, auth, make_tree, make_user, wait_for_job


@pytest.fixture()
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PATH", tmp_path)
    return settings.media_root


TEXT = "# Taufbuch\n\nist **am zwölften März**\nachtzehnhundertneunzig geboren"


def _setup(client, db):
    """A person and a document with one scanned file that has a text."""
    user = make_user(db, "alice")
    tree = make_tree(db, user)
    add_member(db, tree, "m1", first_name="Johann", last_name="Weber")
    staged = client.post(
        f"{API}/workspaces/{tree.id}/documents/uploads",
        headers=auth(user),
        data={"filename": "taufbuch.png"},
        files={"file": ("taufbuch.png", b"\x89PNG", "image/png")},
    )
    assert staged.status_code == 201, staged.text
    saved = client.put(
        f"{API}/workspaces/{tree.id}/documents/doc-1",
        headers=auth(user),
        json={
            "title": "Taufbuch",
            "member_ids": [],
            "attached_upload_ids": [staged.json()["id"]],
        },
    )
    assert saved.status_code == 200, saved.text
    file_id = saved.json()["files"][0]["id"]
    text = client.put(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}/text",
        headers=auth(user),
        json={"markdown": TEXT},
    )
    assert text.status_code == 200, text.text
    return user, tree, file_id


def _url(tree, suffix=""):
    return f"{API}/workspaces/{tree.id}/citations{suffix}"


def _cite(client, user, tree, file_id, **overrides):
    body = {
        "member_id": "m1",
        "field": "date_of_birth",
        "document_id": "doc-1",
        "document_file_id": file_id,
        "page": 1,
        "quote": "am zwölften März achtzehnhundertneunzig",
        "quote_prefix": "ist ",
        "quote_suffix": " geboren",
        **overrides,
    }
    return client.post(_url(tree), headers=auth(user), json=body)


def test_cite_a_passage_and_list_it(client, db, media_root):
    user, tree, file_id = _setup(client, db)

    created = _cite(client, user, tree, file_id)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["field"] == "date_of_birth"
    assert body["page"] == 1
    assert body["created_by"] == user.id
    # Emphasis and the line break in the Markdown don't hide the quote.
    assert body["quote_found"] is True

    listed = client.get(_url(tree), headers=auth(user)).json()
    assert [c["id"] for c in listed] == [body["id"]]
    by_member = client.get(_url(tree, "?member_id=m2"), headers=auth(user)).json()
    assert by_member == []


def test_citing_links_the_document_to_the_person(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    assert db.get(DocumentMemberLink, ("doc-1", "m1")) is None

    assert _cite(client, user, tree, file_id).status_code == 201

    db.expire_all()
    assert db.get(DocumentMemberLink, ("doc-1", "m1")) is not None


def test_whole_document_citation_has_nothing_to_check(client, db, media_root):
    user, tree, file_id = _setup(client, db)

    created = _cite(
        client,
        user,
        tree,
        file_id,
        document_file_id=None,
        quote=None,
        page=None,
        note=" 1890 ",
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["document_file_id"] is None
    assert body["quote_found"] is None
    assert body["note"] == "1890"


def test_a_quote_needs_a_file_of_the_cited_document(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    assert _cite(client, user, tree, file_id, document_file_id=None).status_code == 422
    assert (
        _cite(client, user, tree, file_id, document_file_id="no-such-file").status_code
        == 404
    )
    assert _cite(client, user, tree, file_id, field="hometown").status_code == 422


def test_quote_not_found_after_the_text_changes(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]

    response = client.put(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}/text",
        headers=auth(user),
        json={"markdown": "Ganz anderer Text"},
    )
    assert response.status_code == 200, response.text

    listed = client.get(_url(tree), headers=auth(user)).json()
    assert listed[0]["id"] == citation_id
    assert listed[0]["quote_found"] is False


def test_update_and_delete(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]

    updated = client.patch(
        _url(tree, f"/{citation_id}"),
        headers=auth(user),
        json={"document_file_id": file_id, "quote": "geboren", "note": "Taufe"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["quote"] == "geboren"
    assert body["page"] is None
    assert body["note"] == "Taufe"
    assert body["quote_found"] is True

    deleted = client.delete(_url(tree, f"/{citation_id}"), headers=auth(user))
    assert deleted.status_code == 204
    assert client.get(_url(tree), headers=auth(user)).json() == []
    assert (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, target_type="member", target_id="m1")
        .count()
        == 3
    )


def test_viewer_reads_but_cannot_cite(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]
    viewer = make_user(db, "viewer")
    db.add(WorkspaceMembership(workspace_id=tree.id, user_id=viewer.id, role="viewer"))
    db.commit()

    listed = client.get(_url(tree), headers=auth(viewer))
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()] == [citation_id]
    assert _cite(client, viewer, tree, file_id).status_code == 403
    assert (
        client.delete(_url(tree, f"/{citation_id}"), headers=auth(viewer)).status_code
        == 403
    )


def test_hidden_documents_area_hides_citations(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    _cite(client, user, tree, file_id)
    guest = make_user(db, "guest")
    db.add(
        WorkspaceMembership(
            workspace_id=tree.id,
            user_id=guest.id,
            role="editor",
            restrictions=["sources"],
        )
    )
    db.commit()

    assert client.get(_url(tree), headers=auth(guest)).status_code == 404


def test_section_share_sees_only_citations_it_can_reach(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    add_member(db, tree, "m2", first_name="Josef")
    section = Section(workspace_id=tree.id, name="Weber line")
    other = Section(workspace_id=tree.id, name="Hofer line")
    db.add_all([section, other])
    db.flush()
    db.add(SectionMember(section_id=section.id, member_id="m1"))
    now = utcnow_iso()
    db.add(
        Document(
            id="doc-2",
            workspace_id=tree.id,
            title="Hofer",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()
    scope = db.get(ContentScope, ("document", "doc-2"))
    if scope is None:
        db.add(
            ContentScope(
                content_type="document",
                content_id="doc-2",
                workspace_id=tree.id,
                section_id=other.id,
            )
        )
    else:
        scope.section_id = other.id
    db.commit()
    reachable = _cite(client, user, tree, file_id).json()["id"]
    # The person is outside the shared section.
    _cite(client, user, tree, file_id, member_id="m2", document_file_id=None, quote=None)
    # The document belongs to a section that isn't shared.
    _cite(
        client,
        user,
        tree,
        file_id,
        document_id="doc-2",
        document_file_id=None,
        quote=None,
    )

    bob = make_user(db, "bob")
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id, section_id=section.id, user_id=bob.id, role="viewer"
        )
    )
    db.commit()

    listed = client.get(_url(tree), headers=auth(bob))
    assert listed.status_code == 200, listed.text
    assert [c["id"] for c in listed.json()] == [reachable]


def test_deleting_the_file_keeps_the_citation_on_the_document(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]

    response = client.delete(
        f"{API}/workspaces/{tree.id}/documents/doc-1/files/{file_id}", headers=auth(user)
    )
    assert response.status_code == 204
    db.expire_all()
    citation = db.get(MemberFieldCitation, citation_id)
    assert citation is not None
    assert citation.document_file_id is None

    entry = (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, action="delete", target_type="document_file")
        .one()
    )
    undone = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry.id}/undo", headers=auth(user)
    )
    assert undone.status_code == 200, undone.text
    db.expire_all()
    assert db.get(MemberFieldCitation, citation_id).document_file_id == file_id


def test_undo_document_delete_restores_citations(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]
    client.delete(f"{API}/workspaces/{tree.id}/documents/doc-1", headers=auth(user))
    db.expire_all()
    assert db.get(MemberFieldCitation, citation_id) is None

    entry = (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, action="delete", target_type="document")
        .one()
    )
    undone = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry.id}/undo", headers=auth(user)
    )
    assert undone.status_code == 200, undone.text
    db.expire_all()
    restored = db.get(MemberFieldCitation, citation_id)
    assert restored is not None
    assert restored.document_file_id == file_id


def test_undo_member_delete_restores_citations(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    citation_id = _cite(client, user, tree, file_id).json()["id"]
    response = client.delete(f"{API}/workspaces/{tree.id}/members/m1", headers=auth(user))
    assert response.status_code == 204, response.text
    db.expire_all()
    assert db.get(MemberFieldCitation, citation_id) is None

    entry = (
        db.query(ActivityLog)
        .filter_by(workspace_id=tree.id, action="delete", target_type="member")
        .one()
    )
    undone = client.post(
        f"{API}/workspaces/{tree.id}/activity/{entry.id}/undo", headers=auth(user)
    )
    assert undone.status_code == 200, undone.text
    db.expire_all()
    assert db.get(MemberFieldCitation, citation_id) is not None


def test_member_merge_moves_citations_to_the_kept_person(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    add_member(db, tree, "m2", first_name="Johann", last_name="Weber")
    citation_id = _cite(client, user, tree, file_id, member_id="m2").json()["id"]

    merged = client.post(
        f"{API}/workspaces/{tree.id}/members/merge",
        headers=auth(user),
        json={"keep_id": "m1", "remove_id": "m2", "fields": {}},
    )
    assert merged.status_code == 200, merged.text
    db.expire_all()
    assert db.get(MemberFieldCitation, citation_id).member_id == "m1"


def test_export_import_round_trips_citations(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    _cite(client, user, tree, file_id)

    exported = client.post(
        f"{API}/workspaces/{tree.id}/export", headers=auth(user), json={}
    )
    assert exported.status_code == 200
    bundle = crypto_export.decrypt_bundle(exported.content, None)
    assert [c["field"] for c in bundle["member_field_citations"]] == ["date_of_birth"]

    started = client.post(
        f"{API}/workspaces/import",
        headers=auth(user),
        files={"file": ("tree.treedb", exported.content, "application/octet-stream")},
    )
    assert started.status_code in (200, 202), started.text
    new_tree_id = wait_for_job(client, auth(user), started.json()["job_id"])

    citations = client.get(
        f"{API}/workspaces/{new_tree_id}/citations", headers=auth(user)
    ).json()
    assert len(citations) == 1
    citation = citations[0]
    members = client.get(
        f"{API}/workspaces/{new_tree_id}/members", headers=auth(user)
    ).json()
    docs = client.get(
        f"{API}/workspaces/{new_tree_id}/documents", headers=auth(user)
    ).json()
    assert citation["member_id"] == members[0]["id"]
    assert citation["document_id"] == docs[0]["id"]
    assert citation["document_file_id"] == docs[0]["files"][0]["id"]
    assert citation["quote"] == "am zwölften März achtzehnhundertneunzig"
    assert citation["quote_found"] is True
    assert citation["created_by"] is None


def test_merge_copies_citations(client, db, media_root):
    user, source, file_id = _setup(client, db)
    _cite(client, user, source, file_id)

    merged = merge_trees(db, user, "Copy", source.id, None)

    rows = db.query(MemberFieldCitation).filter_by(workspace_id=merged.id).all()
    assert len(rows) == 1
    copied = rows[0]
    assert copied.document_id != "doc-1"
    assert db.get(Document, copied.document_id).workspace_id == merged.id
    assert db.get(DocumentFile, copied.document_file_id).workspace_id == merged.id


def test_plain_text_ignores_markdown_and_spacing():
    assert plain_text("**Johann**  _Georg_\n<!-- page 2 -->Weber") == (
        "johann georg weber"
    )
    assert plain_text("[Linz](https://example.com) | Hofgasse") == "linz hofgasse"


def test_coverage_counts_filled_facts_and_lost_quotes(client, db, media_root):
    user, tree, file_id = _setup(client, db)
    add_member(db, tree, "m2", first_name="Maria", last_name="Hofer")
    assert _cite(client, user, tree, file_id, field="first_name").status_code == 201
    _cite(client, user, tree, file_id, field="last_name", quote="nicht im Text")

    body = client.get(_url(tree, "/coverage"), headers=auth(user)).json()

    # Both people have only a first and last name; m1's two are cited.
    assert body["facts_cited"] == 2
    assert body["facts_total"] == 4
    missing = {entry["member_id"]: entry["fields"] for entry in body["missing"]}
    assert "first_name" in missing["m2"]
    assert "m1" not in missing
    assert body["missing"][0]["name"] == "Maria Hofer"
    assert [c["field"] for c in body["quotes_not_found"]] == ["last_name"]


def test_plain_text_stays_fast_on_unclosed_marks():
    # Many unclosed comment, tag and link marks must not take quadratic time.
    for text in ("<!--" * 50_000, "<" * 100_000, "[\\" * 50_000, "[](" * 50_000):
        assert isinstance(plain_text(text), str)
    assert (
        plain_text("[Taufbuch](x.png) <b>Linz</b> <!-- open") == "taufbuch linz <!-- open"
    )
