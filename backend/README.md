# Family Tree — Backend

FastAPI service providing the REST API, authentication, and media handling for
the Family Tree web application.

## Stack

- **FastAPI** + **Uvicorn**
- **SQLAlchemy 2.0** (sync) on **PostgreSQL**
- **PyJWT** + **bcrypt** for local authentication
- **Authlib** for Authentik (OIDC) single sign-on
- **cryptography** for encrypted tree exports
- **Pillow** for image normalization

## Layout

```
app/
  core/        config, security (JWT/passwords), constants
  db/          engine/session, declarative base, bootstrap (create_all + seed)
  models/      SQLAlchemy ORM models
  schemas/     Pydantic request/response models (mirror the frontend contracts)
  services/    media storage, Authentik client, encrypted export, settings
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
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export SECRET_KEY=dev-secret
export DATABASE_URL=postgresql+psycopg2://familytree:familytree@localhost:5432/familytree
export DATA_PATH=./.data APP_DATA_PATH=./.appdata

uvicorn app.main:app --reload --port 8000
```

Interactive API docs are then available at `http://localhost:8000/api/docs`.

## Database schema

On startup the service creates any missing tables from the ORM metadata
(`Base.metadata.create_all`) and seeds the initial admin account plus default
settings. This keeps the schema in lock-step with the models; Alembic can be
layered on for versioned migrations as the schema evolves.

## Notes

- All data lives unencrypted in PostgreSQL; only **exports** are encrypted.
- Uploaded media is written to `DATA_PATH/media/<tree_id>/<uuid>.<ext>` and
  served from `/api/media/...` (UUID filenames keep the URLs unguessable).
- Authentik OIDC is enabled automatically when `AUTHENTIK_CLIENT_ID`,
  `AUTHENTIK_CLIENT_SECRET`, and `AUTHENTIK_DISCOVERY_URL` are all set.
