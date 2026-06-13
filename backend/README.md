# Family Tree — Backend

FastAPI service providing the REST API, authentication, and media handling for
the Family Tree web application.

## Stack

- **FastAPI** + **Uvicorn**
- **SQLAlchemy 2.0** (sync) on **PostgreSQL**, with **Alembic** migrations
- **uv** for dependency management (`pyproject.toml` + `uv.lock`)
- **PyJWT** + **bcrypt** for local authentication
- **Authlib** for Authentik (OIDC) single sign-on
- **cryptography** for encrypted tree exports
- **Pillow** for image normalization

## Layout

```
pyproject.toml / uv.lock   dependencies (managed by uv)
alembic.ini / alembic/     database migrations
app/
  core/        config, security (JWT/passwords), logging
  db/          engine/session, declarative base, bootstrap (migrate + seed)
  models/      SQLAlchemy ORM models
  schemas/     Pydantic request/response models (mirror the frontend contracts)
  services/    media storage, Authentik client, encrypted export, tree merge
  api/
    deps.py    auth + tree-authorization dependencies
    routes/    auth, oauth, users, settings, trees, members, gallery,
               events, stories, export/import
    router.py  aggregate router
  main.py      app factory, middleware, media mount, lifespan
```

## Running locally (without Docker)

```bash
cd backend
uv sync                       # creates .venv from uv.lock

export SECRET_KEY=dev-secret
export DATABASE_URL=postgresql+psycopg2://familytree:familytree@localhost:5432/familytree
export DATA_PATH=./.data APP_DATA_PATH=./.appdata

uv run uvicorn app.main:app --reload --port 8000
```

Instead of exporting variables you can configure everything in the repo-root
`.env` (see [`../.env.example`](../.env.example)) — it is loaded automatically
and real environment variables override it.

Interactive API docs are then available at `http://localhost:8000/api/docs`.

## Database migrations (Alembic)

Migrations live in `alembic/versions/`. On startup the service runs
`alembic upgrade head` automatically (then seeds the admin + default settings),
so a fresh database is provisioned without manual steps.

To change the schema:

```bash
# 1. edit the models in app/models/
# 2. generate a migration
uv run alembic revision --autogenerate -m "describe change"
# 3. review the generated file, then apply
uv run alembic upgrade head
```

## Notes

- All data lives unencrypted in PostgreSQL; only **exports** are encrypted.
- Uploaded media is written to `DATA_PATH/media/<tree_id>/<uuid>.<ext>` and
  served from `/api/media/...` (UUID filenames keep the URLs unguessable).
- Authentik OIDC is enabled automatically when `AUTHENTIK_CLIENT_ID`,
  `AUTHENTIK_CLIENT_SECRET`, and `AUTHENTIK_DISCOVERY_URL` are all set.
