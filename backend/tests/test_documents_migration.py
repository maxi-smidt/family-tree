"""Data-migration tests for the v1.7.0 release migration (blocker #662).

The Alembic migration ``v1_7_0_release`` must *migrate* the legacy
Sources/Citations/Evidence + story-attachment rows into the Documents model —
not drop them — and it must validate the result before removing the old tables.

The suite exercises the migration's portable Core copy/verify helpers directly
against a populated legacy schema on SQLite (the same engine the rest of the
backend tests use; CI has no PostgreSQL service). The helpers contain the
data-mapping logic that risks losing data, so testing them directly is what
guards the acceptance criteria.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v1_7_0_release.py"
    )
    spec = importlib.util.spec_from_file_location("v1_7_0_release_under_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


migration = _load_migration_module()


def _build_schema() -> sa.MetaData:
    """A hermetic schema with just the tables the migration reads and writes.

    The legacy tables no longer exist in the ORM metadata, and the new tables are
    declared here too so the test controls the exact shape it asserts against.
    """
    meta = sa.MetaData()
    sa.Table(
        "members", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("first_name", sa.String(255)),
        sa.Column("last_name", sa.String(255)),
    )
    sa.Table(
        "sources", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("title", sa.String(255)),
        sa.Column("author", sa.String(255)),
        sa.Column("publication_info", sa.Text),
        sa.Column("repository", sa.String(255)),
        sa.Column("source_date", sa.String(40)),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.String(40)),
        sa.Column("updated_at", sa.String(40)),
    )
    sa.Table(
        "source_evidence", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("source_id", sa.String(36)),
        sa.Column("kind", sa.String(10)),
        sa.Column("filename", sa.String(255)),
        sa.Column("url", sa.Text),
        sa.Column("mime_type", sa.String(100)),
        sa.Column("size", sa.Integer),
        sa.Column("created_at", sa.String(40)),
    )
    sa.Table(
        "citations", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("source_id", sa.String(36)),
        sa.Column("member_id", sa.String(36)),
        sa.Column("fact_type", sa.String(40)),
        sa.Column("page", sa.String(255)),
        sa.Column("detail", sa.Text),
        sa.Column("created_at", sa.String(40)),
    )
    sa.Table(
        "story_attachments", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("story_id", sa.String(36)),
        sa.Column("filename", sa.String(255)),
        sa.Column("url", sa.Text),
        sa.Column("mime_type", sa.String(100)),
        sa.Column("size", sa.Integer),
        sa.Column("created_at", sa.String(40)),
    )
    sa.Table(
        "documents", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("title", sa.String(255)),
        sa.Column("document_date", sa.String(40)),
        sa.Column("description", sa.Text),
        sa.Column("created_at", sa.String(40)),
        sa.Column("updated_at", sa.String(40)),
    )
    sa.Table(
        "document_files", meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tree_id", sa.String(36)),
        sa.Column("document_id", sa.String(36)),
        sa.Column("kind", sa.String(10)),
        sa.Column("filename", sa.String(255)),
        sa.Column("url", sa.Text),
        sa.Column("mime_type", sa.String(100)),
        sa.Column("size", sa.Integer),
        sa.Column("created_at", sa.String(40)),
    )
    sa.Table(
        "document_member_link", meta,
        sa.Column("document_id", sa.String(36), primary_key=True),
        sa.Column("member_id", sa.String(36), primary_key=True),
    )
    sa.Table(
        "story_document_link", meta,
        sa.Column("story_id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), primary_key=True),
    )
    return meta


@pytest.fixture()
def engine(tmp_path):
    eng = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}", future=True)
    _build_schema().create_all(eng)
    yield eng
    eng.dispose()


def _seed_populated_tree(conn, meta_reflect: sa.MetaData) -> None:
    m = meta_reflect.tables
    conn.execute(
        m["members"].insert(),
        [
            {"id": "m1", "first_name": "Ada", "last_name": "Lovelace"},
            {"id": "m2", "first_name": "Alan", "last_name": "Turing"},
        ],
    )
    conn.execute(
        m["sources"].insert(),
        [
            {
                "id": "s1", "tree_id": "t1", "title": "Census 1900",
                "author": "A. Historian", "publication_info": "Vol 3",
                "repository": "National Archives", "source_date": "1900",
                "notes": "Handwritten ledger", "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-02-01T00:00:00Z",
            },
            {
                "id": "s2", "tree_id": "t1", "title": "Parish Register",
                "author": None, "publication_info": None, "repository": None,
                "source_date": None, "notes": None,
                "created_at": "2024-01-03T00:00:00Z",
                "updated_at": "2024-01-03T00:00:00Z",
            },
        ],
    )
    conn.execute(
        m["source_evidence"].insert(),
        [
            {
                "id": "e1", "tree_id": "t1", "source_id": "s1", "kind": "file",
                "filename": "scan.jpg", "url": "/api/media/t1/abc123.jpg",
                "mime_type": "image/jpeg", "size": 1234,
                "created_at": "2024-01-01T00:00:00Z",
            },
            {
                "id": "e2", "tree_id": "t1", "source_id": "s1", "kind": "link",
                "filename": "Ancestry record", "url": "https://example.com/rec",
                "mime_type": None, "size": None,
                "created_at": "2024-01-02T00:00:00Z",
            },
        ],
    )
    conn.execute(
        m["citations"].insert(),
        [
            {
                "id": "c1", "tree_id": "t1", "source_id": "s1", "member_id": "m1",
                "fact_type": "birth", "page": "42", "detail": "line 3",
                "created_at": "2024-01-01T00:00:00Z",
            },
            {
                "id": "c2", "tree_id": "t1", "source_id": "s1", "member_id": "m2",
                "fact_type": "death", "page": None, "detail": None,
                "created_at": "2024-01-01T00:00:00Z",
            },
            # Second citation for the same (source, member): must collapse to one
            # document→member link, not two.
            {
                "id": "c3", "tree_id": "t1", "source_id": "s1", "member_id": "m1",
                "fact_type": "marriage", "page": "7", "detail": None,
                "created_at": "2024-01-01T00:00:00Z",
            },
        ],
    )
    conn.execute(
        m["story_attachments"].insert(),
        [
            {
                "id": "a1", "tree_id": "t1", "story_id": "st1",
                "filename": "family-photo.png", "url": "/api/media/t1/xyz789.png",
                "mime_type": "image/png", "size": 999,
                "created_at": "2024-03-01T00:00:00Z",
            },
        ],
    )


def _reflect(engine) -> sa.MetaData:
    meta = sa.MetaData()
    meta.reflect(bind=engine)
    return meta


def test_migration_maps_all_legacy_rows(engine):
    meta = _reflect(engine)
    with engine.begin() as conn:
        _seed_populated_tree(conn, meta)
        migration.migrate_content_to_documents(conn)
        migration.verify_migration(conn)  # must not raise

    docs = _reflect(engine).tables
    with engine.connect() as conn:
        documents = conn.execute(sa.select(docs["documents"])).mappings().all()
        files = conn.execute(sa.select(docs["document_files"])).mappings().all()
        member_links = {
            (r.document_id, r.member_id)
            for r in conn.execute(sa.select(docs["document_member_link"]))
        }
        story_links = {
            (r.story_id, r.document_id)
            for r in conn.execute(sa.select(docs["story_document_link"]))
        }

    # Row counts: 2 sources + 1 attachment => 3 documents; 2 evidence + 1
    # attachment => 3 files; (s1,m1)+(s1,m2) distinct => 2 member links.
    assert len(documents) == 3
    assert len(files) == 3
    assert len(member_links) == 2
    assert len(story_links) == 1

    by_id = {d["id"]: d for d in documents}

    # Source ids are preserved, with metadata folded into the description.
    assert "s1" in by_id and "s2" in by_id
    s1 = by_id["s1"]
    assert s1["title"] == "Census 1900"
    assert s1["document_date"] == "1900"
    assert s1["created_at"] == "2024-01-01T00:00:00Z"
    assert s1["updated_at"] == "2024-02-01T00:00:00Z"
    desc = s1["description"]
    assert "Handwritten ledger" in desc
    assert "Author: A. Historian" in desc
    assert "Publication: Vol 3" in desc
    assert "Repository: National Archives" in desc
    assert "Citations:" in desc
    # Citation detail (member name, fact, page, detail) is preserved verbatim.
    assert "Ada Lovelace — birth, page 42: line 3" in desc
    assert "Alan Turing — death" in desc
    assert "Ada Lovelace — marriage, page 7" in desc
    # A source with no extra metadata and no citations yields no description.
    assert by_id["s2"]["description"] is None

    files_by_id = {f["id"]: f for f in files}
    # Evidence ids, urls (i.e. the on-disk bytes), mime and size are preserved.
    assert files_by_id["e1"]["document_id"] == "s1"
    assert files_by_id["e1"]["url"] == "/api/media/t1/abc123.jpg"
    assert files_by_id["e1"]["mime_type"] == "image/jpeg"
    assert files_by_id["e1"]["size"] == 1234
    assert files_by_id["e1"]["kind"] == "file"
    assert files_by_id["e2"]["kind"] == "link"
    assert files_by_id["e2"]["url"] == "https://example.com/rec"

    assert member_links == {("s1", "m1"), ("s1", "m2")}

    # The story attachment becomes a fresh one-file document linked to its story.
    attachment_file = files_by_id["a1"]
    assert attachment_file["kind"] == "file"
    assert attachment_file["url"] == "/api/media/t1/xyz789.png"
    assert attachment_file["size"] == 999
    attachment_doc_id = attachment_file["document_id"]
    assert by_id[attachment_doc_id]["title"] == "family-photo.png"
    assert by_id[attachment_doc_id]["created_at"] == "2024-03-01T00:00:00Z"
    assert story_links == {("st1", attachment_doc_id)}


def test_migration_on_empty_legacy_schema_is_a_noop(engine):
    with engine.begin() as conn:
        migration.migrate_content_to_documents(conn)
        migration.verify_migration(conn)  # must not raise on an empty tree

    docs = _reflect(engine).tables
    with engine.connect() as conn:
        assert conn.execute(
            sa.select(sa.func.count()).select_from(docs["documents"])
        ).scalar_one() == 0


def test_verify_fails_when_a_document_is_missing(engine):
    """If the mapping is incomplete, verification must raise so the migration
    rolls back and the legacy tables are never dropped."""
    meta = _reflect(engine)
    with engine.begin() as conn:
        _seed_populated_tree(conn, meta)
        migration.migrate_content_to_documents(conn)

    docs = _reflect(engine).tables
    with engine.begin() as conn:
        # Simulate a lost row (e.g. a bug in the copy step).
        conn.execute(docs["documents"].delete().where(docs["documents"].c.id == "s2"))

    with engine.connect() as conn:
        with pytest.raises(RuntimeError, match="validation failed"):
            migration.verify_migration(conn)
