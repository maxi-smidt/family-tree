"""v1.7.0 release schema.

Includes Documents, public-tree password and token invalidation support, the
administrator audit trail, story dates, and the document-file media index.

Revision ID: v1_7_0_release
Revises: v1_5_0_linked_tree_geocode
Create Date: 2026-07-07 12:00:00.000000

"""
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1_7_0_release'
down_revision: Union[str, None] = 'v1_5_0_linked_tree_geocode'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Data migration: preserve Sources / Citations / Evidence + story attachments
# ---------------------------------------------------------------------------
# The old genealogy content is *migrated* into the Documents model, not dropped.
# The copy step below uses lightweight, portable Core table handles (no ORM
# models, which drift over time) so it runs identically on PostgreSQL and on the
# SQLite databases the test-suite uses. See ``tests/test_documents_migration.py``.
#
# Mapping:
#   sources           -> documents            (ids preserved; author / publication
#                                               / repository / notes folded into the
#                                               document description)
#   source_evidence   -> document_files       (ids, url/bytes, mime, size preserved)
#   citations         -> document_member_link  (the people a source cited become the
#                                               people a document mentions; the
#                                               fact/page/detail is folded into the
#                                               document description)
#   story_attachments -> documents + document_files + story_document_link
#                                              (each attachment becomes a one-file
#                                               document linked to its story)

_sources = sa.table(
    "sources",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("title"),
    sa.column("author"),
    sa.column("publication_info"),
    sa.column("repository"),
    sa.column("source_date"),
    sa.column("notes"),
    sa.column("created_at"),
    sa.column("updated_at"),
)

_source_evidence = sa.table(
    "source_evidence",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("source_id"),
    sa.column("kind"),
    sa.column("filename"),
    sa.column("url"),
    sa.column("mime_type"),
    sa.column("size"),
    sa.column("created_at"),
)

_citations = sa.table(
    "citations",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("source_id"),
    sa.column("member_id"),
    sa.column("fact_type"),
    sa.column("page"),
    sa.column("detail"),
    sa.column("created_at"),
)

_story_attachments = sa.table(
    "story_attachments",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("story_id"),
    sa.column("filename"),
    sa.column("url"),
    sa.column("mime_type"),
    sa.column("size"),
    sa.column("created_at"),
)

_members = sa.table(
    "members",
    sa.column("id"),
    sa.column("first_name"),
    sa.column("last_name"),
)

_documents = sa.table(
    "documents",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("title"),
    sa.column("document_date"),
    sa.column("description"),
    sa.column("created_at"),
    sa.column("updated_at"),
)

_document_files = sa.table(
    "document_files",
    sa.column("id"),
    sa.column("tree_id"),
    sa.column("document_id"),
    sa.column("kind"),
    sa.column("filename"),
    sa.column("url"),
    sa.column("mime_type"),
    sa.column("size"),
    sa.column("created_at"),
)

_document_member_link = sa.table(
    "document_member_link",
    sa.column("document_id"),
    sa.column("member_id"),
)

_story_document_link = sa.table(
    "story_document_link",
    sa.column("story_id"),
    sa.column("document_id"),
)


def _compose_source_description(source, citation_lines: list[str]) -> str | None:
    """Fold a source's extra metadata + its citations into a document description.

    The Documents model keeps only ``title`` / ``document_date`` / ``description``,
    so the old source's author, publication info, repository, free-text notes and
    per-fact citation details (fact type, page, detail, and who was cited) are
    preserved as human-readable text rather than being lost.
    """
    parts: list[str] = []
    notes = (source.notes or "").strip() if source.notes else ""
    if notes:
        parts.append(notes)

    meta: list[str] = []
    if source.author:
        meta.append(f"Author: {source.author}")
    if source.publication_info:
        meta.append(f"Publication: {source.publication_info}")
    if source.repository:
        meta.append(f"Repository: {source.repository}")
    if meta:
        parts.append("\n".join(meta))

    if citation_lines:
        parts.append("Citations:\n" + "\n".join(citation_lines))

    return "\n\n".join(parts) or None


def _citation_line(member_name: str, fact_type, page, detail) -> str:
    line = f"- {member_name} — {fact_type}"
    if page:
        line += f", page {page}"
    if detail:
        line += f": {detail}"
    return line


def migrate_content_to_documents(bind) -> None:
    """Copy the legacy source/citation/attachment rows into the Documents model.

    Idempotent-free by design: it runs exactly once, against freshly created and
    still-empty ``documents`` / ``document_files`` / link tables, inside the
    migration's transaction.
    """
    member_names: dict[str, str] = {}
    for row in bind.execute(
        sa.select(_members.c.id, _members.c.first_name, _members.c.last_name)
    ):
        name = " ".join(p for p in (row.first_name, row.last_name) if p).strip()
        member_names[row.id] = name or row.id

    # Group citations by source: fold the detail into the description and collect
    # the (source, member) pairs that become document→member links (deduplicated,
    # since one source could cite the same person for several facts).
    citation_lines: dict[str, list[str]] = {}
    member_pairs: dict[tuple[str, str], None] = {}
    for c in bind.execute(sa.select(_citations)):
        name = member_names.get(c.member_id, c.member_id)
        citation_lines.setdefault(c.source_id, []).append(
            _citation_line(name, c.fact_type, c.page, c.detail)
        )
        member_pairs.setdefault((c.source_id, c.member_id), None)

    # sources -> documents (ids preserved)
    document_rows = [
        {
            "id": s.id,
            "tree_id": s.tree_id,
            "title": s.title,
            "document_date": s.source_date,
            "description": _compose_source_description(s, citation_lines.get(s.id, [])),
            "created_at": s.created_at,
            "updated_at": s.updated_at,
        }
        for s in bind.execute(sa.select(_sources))
    ]
    if document_rows:
        bind.execute(_documents.insert(), document_rows)

    # source_evidence -> document_files (ids / url / mime / size preserved)
    evidence_rows = [
        {
            "id": e.id,
            "tree_id": e.tree_id,
            "document_id": e.source_id,
            "kind": e.kind,
            "filename": e.filename,
            "url": e.url,
            "mime_type": e.mime_type,
            "size": e.size,
            "created_at": e.created_at,
        }
        for e in bind.execute(sa.select(_source_evidence))
    ]
    if evidence_rows:
        bind.execute(_document_files.insert(), evidence_rows)

    # citations -> document_member_link (deduplicated)
    link_rows = [
        {"document_id": source_id, "member_id": member_id}
        for (source_id, member_id) in member_pairs
    ]
    if link_rows:
        bind.execute(_document_member_link.insert(), link_rows)

    # story_attachments -> a one-file document linked to the story
    attachment_docs: list[dict] = []
    attachment_files: list[dict] = []
    attachment_links: list[dict] = []
    for a in bind.execute(sa.select(_story_attachments)):
        new_document_id = str(uuid4())
        attachment_docs.append(
            {
                "id": new_document_id,
                "tree_id": a.tree_id,
                "title": a.filename,
                "document_date": None,
                "description": None,
                "created_at": a.created_at,
                "updated_at": a.created_at,
            }
        )
        attachment_files.append(
            {
                "id": a.id,
                "tree_id": a.tree_id,
                "document_id": new_document_id,
                "kind": "file",
                "filename": a.filename,
                "url": a.url,
                "mime_type": a.mime_type,
                "size": a.size,
                "created_at": a.created_at,
            }
        )
        attachment_links.append(
            {"story_id": a.story_id, "document_id": new_document_id}
        )
    if attachment_docs:
        bind.execute(_documents.insert(), attachment_docs)
    if attachment_files:
        bind.execute(_document_files.insert(), attachment_files)
    if attachment_links:
        bind.execute(_story_document_link.insert(), attachment_links)


def _count(bind, selectable) -> int:
    return bind.execute(
        sa.select(sa.func.count()).select_from(selectable)
    ).scalar_one()


def verify_migration(bind) -> None:
    """Fail (rolling the migration back) unless every legacy row was carried over.

    Guarantees the old tables are only dropped once the mapping is provably
    complete, so a partial or buggy migration can never silently lose data.
    """
    n_sources = _count(bind, _sources)
    n_evidence = _count(bind, _source_evidence)
    n_attachments = _count(bind, _story_attachments)
    n_citation_pairs = _count(
        bind,
        sa.select(_citations.c.source_id, _citations.c.member_id)
        .distinct()
        .subquery(),
    )

    n_documents = _count(bind, _documents)
    n_files = _count(bind, _document_files)
    n_member_links = _count(bind, _document_member_link)
    n_story_links = _count(bind, _story_document_link)

    problems: list[str] = []
    if n_documents != n_sources + n_attachments:
        problems.append(
            f"documents={n_documents} != sources({n_sources})"
            f"+story_attachments({n_attachments})"
        )
    if n_files != n_evidence + n_attachments:
        problems.append(
            f"document_files={n_files} != source_evidence({n_evidence})"
            f"+story_attachments({n_attachments})"
        )
    if n_member_links != n_citation_pairs:
        problems.append(
            f"document_member_link={n_member_links} != "
            f"distinct citation (source,member) pairs({n_citation_pairs})"
        )
    if n_story_links != n_attachments:
        problems.append(
            f"story_document_link={n_story_links} != "
            f"story_attachments({n_attachments})"
        )
    if problems:
        raise RuntimeError(
            "v1.7.0 Documents migration validation failed; aborting so the "
            "legacy tables are kept intact: " + "; ".join(problems)
        )


def upgrade() -> None:
    # --- New tables -----------------------------------------------------------
    op.create_table(
        'documents',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('document_date', sa.String(length=40), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.Column('updated_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_documents_tree_id'), 'documents', ['tree_id'], unique=False
    )

    op.create_table(
        'document_files',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_document_files_document_id'), 'document_files', ['document_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_document_files_tree_id'), 'document_files', ['tree_id'], unique=False
    )

    op.create_table(
        'document_member_link',
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['members.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('document_id', 'member_id'),
    )

    op.create_table(
        'event_document_link',
        sa.Column('event_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('event_id', 'document_id'),
    )

    op.create_table(
        'story_document_link',
        sa.Column('story_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['story_id'], ['stories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('story_id', 'document_id'),
    )

    # --- Migrate the legacy content into the new Documents model ---------------
    # Preserve, don't drop: sources/citations/evidence and story attachments are
    # copied into documents / document_files / link tables, then validated. If
    # anything is missing we raise, and Alembic's per-migration transaction rolls
    # the whole thing back — the legacy tables are left untouched.
    bind = op.get_bind()
    migrate_content_to_documents(bind)
    verify_migration(bind)

    # --- Drop the superseded tables --------------------------------------------
    # Safe now: verify_migration() above proved every legacy row was carried over.
    op.drop_table('story_attachments')

    # FK-safe order: citations and source_evidence reference sources.
    op.drop_index(op.f('ix_citations_tree_id'), table_name='citations')
    op.drop_index(op.f('ix_citations_source_id'), table_name='citations')
    op.drop_index(op.f('ix_citations_member_id'), table_name='citations')
    op.drop_table('citations')

    op.drop_index(op.f('ix_source_evidence_tree_id'), table_name='source_evidence')
    op.drop_index(op.f('ix_source_evidence_source_id'), table_name='source_evidence')
    op.drop_table('source_evidence')

    op.drop_index(op.f('ix_sources_tree_id'), table_name='sources')
    op.drop_table('sources')

    # --- Remaining v1.7 schema changes --------------------------------------
    op.add_column(
        'trees', sa.Column('public_password_hash', sa.String(length=255), nullable=True)
    )
    op.create_table(
        'admin_audit_log',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('actor_id', sa.String(length=36), nullable=True),
        sa.Column('actor_username', sa.String(length=255), nullable=True),
        sa.Column('action', sa.String(length=20), nullable=False),
        sa.Column('subject_type', sa.String(length=40), nullable=False),
        sa.Column('subject_id', sa.String(length=255), nullable=True),
        sa.Column('subject_label', sa.String(length=255), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admin_audit_log_actor_id', 'admin_audit_log', ['actor_id'])
    op.create_index(
        'ix_admin_audit_log_subject_type', 'admin_audit_log', ['subject_type']
    )
    op.create_index(
        'ix_admin_audit_log_created_at', 'admin_audit_log', ['created_at']
    )
    op.add_column(
        'trees',
        sa.Column(
            'public_access_version',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
    )
    op.add_column('stories', sa.Column('date', sa.String(length=40), nullable=True))
    op.create_index(
        'ix_document_files_tree_id_url',
        'document_files',
        ['tree_id', 'url'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_document_files_tree_id_url', table_name='document_files')
    op.drop_column('stories', 'date')
    op.drop_column('trees', 'public_access_version')
    op.drop_index('ix_admin_audit_log_created_at', table_name='admin_audit_log')
    op.drop_index('ix_admin_audit_log_subject_type', table_name='admin_audit_log')
    op.drop_index('ix_admin_audit_log_actor_id', table_name='admin_audit_log')
    op.drop_table('admin_audit_log')
    op.drop_column('trees', 'public_password_hash')

    # No data restoration — this simply recreates the old, empty tables.
    op.create_table(
        'sources',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('author', sa.String(length=255), nullable=True),
        sa.Column('publication_info', sa.Text(), nullable=True),
        sa.Column('repository', sa.String(length=255), nullable=True),
        sa.Column('source_date', sa.String(length=40), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.Column('updated_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_sources_tree_id'), 'sources', ['tree_id'], unique=False)

    op.create_table(
        'source_evidence',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('source_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_source_evidence_source_id'), 'source_evidence', ['source_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_source_evidence_tree_id'), 'source_evidence', ['tree_id'],
        unique=False,
    )

    op.create_table(
        'citations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('source_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.Column('fact_type', sa.String(length=40), nullable=False),
        sa.Column('page', sa.String(length=255), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['member_id'], ['members.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_id'], ['sources.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_citations_member_id'), 'citations', ['member_id'], unique=False
    )
    op.create_index(
        op.f('ix_citations_source_id'), 'citations', ['source_id'], unique=False
    )
    op.create_index(
        op.f('ix_citations_tree_id'), 'citations', ['tree_id'], unique=False
    )

    op.create_table(
        'story_attachments',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('story_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['story_id'], ['stories.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_story_attachments_story_id'), 'story_attachments', ['story_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_story_attachments_tree_id'), 'story_attachments', ['tree_id'],
        unique=False,
    )

    op.drop_table('story_document_link')
    op.drop_table('event_document_link')
    op.drop_table('document_member_link')

    op.drop_index(op.f('ix_document_files_tree_id'), table_name='document_files')
    op.drop_index(op.f('ix_document_files_document_id'), table_name='document_files')
    op.drop_table('document_files')

    op.drop_index(op.f('ix_documents_tree_id'), table_name='documents')
    op.drop_table('documents')
