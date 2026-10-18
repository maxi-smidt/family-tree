"""v2.2.0 document text search

Indexes document file texts for search (#1122):

* ``ft_fold(text)``: lower-cases and folds umlauts (``ä`` -> ``ae``) and
  accents. Mirrors ``app.services.documents.text_search.fold``; a test keeps
  the two in step. No ``unaccent`` extension is needed, so the function is
  truly immutable and works on any Postgres.
* ``document_file_texts.search_vector``: a generated ``tsvector`` of the
  folded Markdown (``simple`` config, no stemming, since texts are in many
  languages), with a GIN index.
* A trigram GIN index on the folded Markdown for the similar-spelling
  fallback (``pg_trgm`` is already required since v2.0.0's member search).

The column and indexes are database-only (the ORM never reads or writes
them); ``alembic/env.py`` keeps autogenerate from dropping them.

Revision ID: v2_2_0_document_text_search
Revises: v2_2_0_document_file_texts
Create Date: 2026-10-18 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "v2_2_0_document_text_search"
down_revision: Union[str, None] = "v2_2_0_document_file_texts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FOLD_REPLACEMENTS = (
    ("ä", "ae"),
    ("ö", "oe"),
    ("ü", "ue"),
    ("ß", "ss"),
    ("æ", "ae"),
    ("œ", "oe"),
)
FOLD_FROM = "àáâãåāăąèéêëēĕėęěìíîïĩīĭįòóôõøōŏőùúûũūŭůűųýÿçćĉċčñńňśšźżžďđťłľĺŕř"
FOLD_TO = "aaaaaaaaeeeeeeeeeiiiiiiiioooooooouuuuuuuuuyycccccnnnsszzzddtlllrr"

#: Above roughly this size a transcript can overflow Postgres' 1 MB tsvector
#: limit; such a text is indexed from its first part only.
VECTOR_FALLBACK_CHARS = 300_000


def _fold_sql() -> str:
    expression = "lower(value)"
    for source, target in FOLD_REPLACEMENTS:
        expression = f"replace({expression}, '{source}', '{target}')"
    return f"translate({expression}, '{FOLD_FROM}', '{FOLD_TO}')"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION ft_fold(value text) RETURNS text
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        AS $$ SELECT {_fold_sql()} $$
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION ft_document_vector(value text) RETURNS tsvector
        LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
        AS $$
        BEGIN
            RETURN to_tsvector('simple'::regconfig, ft_fold(value));
        EXCEPTION WHEN program_limit_exceeded THEN
            RETURN to_tsvector(
                'simple'::regconfig, ft_fold(left(value, {VECTOR_FALLBACK_CHARS}))
            );
        END
        $$
        """
    )
    op.execute(
        """
        ALTER TABLE document_file_texts
        ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (ft_document_vector(markdown)) STORED
        """
    )
    op.execute(
        "CREATE INDEX ix_document_file_texts_search_vector "
        "ON document_file_texts USING gin (search_vector)"
    )
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_document_file_texts_search_trgm "
        "ON document_file_texts USING gin (ft_fold(markdown) gin_trgm_ops)"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_document_file_texts_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_document_file_texts_search_vector")
    op.execute("ALTER TABLE document_file_texts DROP COLUMN IF EXISTS search_vector")
    op.execute("DROP FUNCTION IF EXISTS ft_document_vector(text)")
    op.execute("DROP FUNCTION IF EXISTS ft_fold(text)")
