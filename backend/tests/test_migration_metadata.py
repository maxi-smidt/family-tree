"""Shared metadata checks for every revision in the supported upgrade chain."""

from pathlib import Path

import pytest
from alembic.script import ScriptDirectory

ALEMBIC_DIR = Path(__file__).resolve().parents[1] / "alembic"


@pytest.mark.parametrize(
    "script",
    list(ScriptDirectory(str(ALEMBIC_DIR)).walk_revisions()),
    ids=lambda script: script.revision,
)
def test_revision_id_fits_the_alembic_version_column(script):
    assert len(script.revision) <= 32
