"""Alembic environment, wired to the application's settings and ORM metadata."""

import logging
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401  (register all models on Base.metadata)
from app.core.config import settings
from app.db.base import Base

config = context.config

if config.config_file_name is not None and not logging.getLogger().handlers:
    # Only configure logging when run via the alembic CLI. In-process at app
    # startup the application has already set up its handlers (console + file
    # under APP_DATA_PATH/logs) and fileConfig would replace them.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Source of truth for both the URL and the schema.
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_uri)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.sqlalchemy_database_uri,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
