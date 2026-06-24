"""Regression test: production engine is sized from Settings.

create_engine is lazy — no real DB connection is needed — so this runs
offline just fine.
"""

from app.core.config import settings
from app.db.session import engine


def test_engine_pool_sized_from_settings():
    pool = engine.pool
    assert pool.size() == settings.DB_POOL_SIZE
    assert pool._max_overflow == settings.DB_MAX_OVERFLOW
