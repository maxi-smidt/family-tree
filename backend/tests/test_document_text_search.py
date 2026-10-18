"""Searching documents by title, description and file text (#1122)."""

import importlib.util
from pathlib import Path

import pytest

from app.core.rate_limit import search_rate_limiter
from app.db.base import utcnow_iso
from app.models import (
    ContentScope,
    ContentType,
    Document,
    DocumentFile,
    DocumentFileText,
    Section,
    WorkspaceMembership,
    WorkspaceSectionGrant,
)
from app.services.documents import text_search
from app.services.documents.text_search import (
    fold,
    match_field,
    parse_query,
    plain_text,
    words_of,
)
from tests.conftest import API, auth, make_tree, make_user


def _add_document(db, tree, doc_id, title, *, description=None, texts=()):
    now = utcnow_iso()
    db.add(
        Document(
            id=doc_id,
            workspace_id=tree.id,
            title=title,
            description=description,
            created_at=now,
            updated_at=now,
        )
    )
    db.flush()
    for index, markdown in enumerate(texts):
        file_id = f"{doc_id}-f{index}"
        db.add(
            DocumentFile(
                id=file_id,
                workspace_id=tree.id,
                document_id=doc_id,
                kind="file",
                filename=f"scan-{index}.png",
                url=f"/api/media/{tree.id}/{file_id}.png",
                created_at=now,
            )
        )
        db.flush()
        db.add(
            DocumentFileText(
                document_file_id=file_id,
                workspace_id=tree.id,
                markdown=markdown,
                source="manual",
                created_at=now,
                updated_at=now,
            )
        )
    db.commit()


def _search(client, user, tree, q, **params):
    response = client.get(
        f"{API}/workspaces/{tree.id}/documents/search",
        headers=auth(user),
        params={"q": q, **params},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _setup(db):
    owner = make_user(db, "alice")
    tree = make_tree(db, owner)
    return owner, tree


# --- Matching rules ----------------------------------------------------------


def test_fold_handles_umlauts_and_accents():
    assert fold("Müller") == fold("Mueller") == "mueller"
    assert fold("Straße") == "strasse"
    assert fold("Šťastný Łódź Ærø") == "stastny lodz aero"


def test_fold_matches_the_migration():
    path = Path(__file__).parents[1] / "alembic/versions/v2_2_0_document_text_search.py"
    spec = importlib.util.spec_from_file_location("search_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.FOLD_REPLACEMENTS == text_search.FOLD_REPLACEMENTS
    assert migration.FOLD_FROM == text_search.FOLD_FROM
    assert migration.FOLD_TO == text_search.FOLD_TO


def test_parse_query_keeps_phrases_and_drops_single_letters():
    query = parse_query('"Johann Georg" Weber a zu')
    assert [t.tokens for t in query.terms] == [("johann", "georg"), ("weber",), ("zu",)]


def _match(q, value, window=text_search.PROXIMITY_WINDOW):
    return match_field(parse_query(q), words_of(value), fuzzy=False, window=window)


def test_words_match_from_their_start_only():
    assert _match("tauf", "Das Taufbuch der Pfarre") is not None
    assert _match("buch", "Das Taufbuch der Pfarre") is None


def test_two_letter_words_must_match_whole():
    assert _match("zu", "Bauer zu Hofstetten") is not None
    assert _match("zu", "zum Beispiel") is None


def test_several_words_must_be_close_together():
    filler = " ".join(["und"] * 40)
    assert _match("johann weber", f"Johann Huber {filler} Maria Weber") is None
    near = _match("weber johann", "Johann Georg Weber, Bauer")
    assert near is not None and near.span == 3


def test_quoted_phrase_needs_the_words_side_by_side():
    assert _match('"johann weber"', "Johann Georg Weber") is None
    assert _match('"johann weber"', "Pate: Johann Weber, Bauer").adjacent


def test_match_count_counts_separate_passages():
    value = "Weber Anna. Weber Johann. Weber Maria."
    assert _match("weber", value).count == 3


def test_plain_text_strips_markdown_and_tracks_pages():
    plain = plain_text(
        "# Taufbuch\n\n**Johann** [Weber](https://x.test)\n"
        "<!-- page 2 -->\n| Name | Ort |\n|---|---|\n| Maria | Hofer |"
    )
    assert plain.text == "Taufbuch Johann Weber Name Ort Maria Hofer"
    assert plain.page_at(plain.text.index("Johann")) is None
    assert plain_text("Getauft: **Johann Weber**, Bauer").text == (
        "Getauft: Johann Weber, Bauer"
    )
    assert plain.page_at(plain.text.index("Maria")) == 2


# --- Endpoint ----------------------------------------------------------------


def test_finds_text_with_snippet_page_and_highlights(client, db):
    owner, tree = _setup(db)
    _add_document(
        db,
        tree,
        "doc-1",
        "Kirchenbuch",
        texts=[
            "Seite eins.\n\n<!-- page 2 -->\n"
            "Getauft wurde **Johann Müller**, Sohn des Bauern."
        ],
    )
    body = _search(client, owner, tree, "mueller")
    assert body["total"] == 1
    hit = body["items"][0]
    assert hit["field"] == "text"
    assert hit["file_id"] == "doc-1-f0"
    assert hit["page"] == 2
    start, end = hit["highlights"][0]
    assert hit["snippet"][start:end] == "Müller"
    assert "**" not in hit["snippet"]
    assert hit["matched_words"] == ["mueller"]


def test_title_and_description_match(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "Taufschein Anna")
    _add_document(db, tree, "doc-2", "Brief", description="Über die Taufe in Graz")
    body = _search(client, owner, tree, "tauf")
    assert [h["field"] for h in body["items"]] == ["title", "description"]


def test_scattered_words_in_a_long_text_do_not_match(client, db):
    owner, tree = _setup(db)
    filler = " ".join(f"Wort{i}" for i in range(200))
    _add_document(
        db, tree, "doc-1", "Register", texts=[f"Johann Huber. {filler}. Maria Weber."]
    )
    _add_document(db, tree, "doc-2", "Brief", texts=["Pate war Johann Weber aus Graz."])
    body = _search(client, owner, tree, "Johann Weber")
    assert [h["document_id"] for h in body["items"]] == ["doc-2"]


def test_one_document_contributes_at_most_three_files(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "Register", texts=[f"Weber {i}" for i in range(6)])
    _add_document(db, tree, "doc-2", "Brief", texts=["Weber"])
    body = _search(client, owner, tree, "weber")
    per_doc = [h["document_id"] for h in body["items"]]
    assert per_doc.count("doc-1") == 3
    assert "doc-2" in per_doc


def test_similar_spellings_only_when_nothing_matches_exactly(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "Brief", texts=["Der Taufbuchauszug liegt bei."])
    body = _search(client, owner, tree, "Taufbuchauszgu")
    assert body["fuzzy"] is True
    assert body["items"][0]["matched_words"] == ["taufbuchauszug"]

    _add_document(db, tree, "doc-2", "Taufbuchauszgu")
    body = _search(client, owner, tree, "Taufbuchauszgu")
    assert body["fuzzy"] is False
    assert [h["document_id"] for h in body["items"]] == ["doc-2"]


def test_short_words_are_never_matched_fuzzily(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "Brief", texts=["Maier und Mayer"])
    assert _search(client, owner, tree, "Meir")["items"] == []


def test_query_without_usable_words_returns_nothing(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "A b c", texts=["a b c"])
    body = _search(client, owner, tree, "a")
    assert body == {
        "items": [],
        "total": 0,
        "truncated": False,
        "fuzzy": False,
        "terms": [],
    }


# --- Permissions -------------------------------------------------------------


def test_hidden_documents_area_cannot_search(client, db):
    owner, tree = _setup(db)
    _add_document(db, tree, "doc-1", "Brief", texts=["Weber"])
    guest = make_user(db, "guest")
    db.add(
        WorkspaceMembership(
            workspace_id=tree.id,
            user_id=guest.id,
            role="viewer",
            restrictions=["sources"],
        )
    )
    db.commit()
    response = client.get(
        f"{API}/workspaces/{tree.id}/documents/search",
        headers=auth(guest),
        params={"q": "weber"},
    )
    assert response.status_code in (403, 404)


def test_section_scoped_share_only_finds_its_sections(client, db):
    owner, tree = _setup(db)
    mine = Section(workspace_id=tree.id, name="Hofer line")
    other = Section(workspace_id=tree.id, name="Weber line")
    db.add_all([mine, other])
    db.commit()
    _add_document(db, tree, "doc-in", "Brief A", texts=["Johann Weber"])
    _add_document(db, tree, "doc-out", "Brief B", texts=["Johann Weber"])
    # Documents created here are workspace-wide; scope them to a section.
    for doc_id, section in (("doc-in", mine), ("doc-out", other)):
        db.get(ContentScope, (ContentType.DOCUMENT, doc_id)).section_id = section.id
    guest = make_user(db, "guest")
    db.add(
        WorkspaceSectionGrant(
            workspace_id=tree.id, section_id=mine.id, user_id=guest.id, role="viewer"
        )
    )
    db.commit()

    body = _search(client, guest, tree, "weber")
    assert [h["document_id"] for h in body["items"]] == ["doc-in"]
    assert body["total"] == 1
    assert len(_search(client, owner, tree, "weber")["items"]) == 2


def test_search_is_rate_limited(client, db, monkeypatch):
    owner, tree = _setup(db)
    monkeypatch.setattr(search_rate_limiter, "max_attempts", 2, raising=False)
    statuses = [
        client.get(
            f"{API}/workspaces/{tree.id}/documents/search",
            headers=auth(owner),
            params={"q": "weber"},
        ).status_code
        for _ in range(3)
    ]
    assert statuses[-1] == 429


@pytest.mark.parametrize("q", ["", "x" * 201])
def test_query_length_is_validated(client, db, q):
    owner, tree = _setup(db)
    response = client.get(
        f"{API}/workspaces/{tree.id}/documents/search",
        headers=auth(owner),
        params={"q": q},
    )
    assert response.status_code == 422
