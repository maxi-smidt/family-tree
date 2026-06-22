# Setup Guide

Two ways to run it: the full **production** stack with Docker Compose, or
**development** where you start the database in a container and run the two dev
servers directly (with hot reload).

The web app lives in `frontend/`, the API in `backend/`. The repo root holds
only the Docker Compose stack and shared tooling (prettier + git hooks).

## Prerequisites

- **Docker** + **Docker Compose** — runs production, and the database in dev
- **Node.js** 24 LTS recommended (minimum v20.19+ / v22.12+) — for the frontend dev server
- **Python** 3.12+ and **[uv](https://docs.astral.sh/uv/)** — for the backend dev server

## Production

The stack ships **without** a database (as is common for Unraid-style apps):
run your own PostgreSQL and point the backend at it via `POSTGRES_*` (or a full
`DATABASE_URL`) in the `.env`.

```bash
mkdir family-tree
cd family-tree

wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/docker-compose.prod.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/maxi-smidt/family-tree/main/.env.example -O .env
# Set SECRET_KEY, FIRST_ADMIN_PASSWORD and the POSTGRES_* connection values at
# minimum. Pin APP_IMAGE_TAG to a release such as 1.2.17 if you want repeatable
# upgrades/rollbacks instead of latest.

docker compose up -d
```

Open `http://localhost:${UI_PORT}` (default `8080`) and sign in with the seeded
admin (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD`). Migrations run
automatically on first start.

If you intentionally want to build from source on the server, clone the repo and
run `docker compose up -d --build` instead. Published images are preferred for
long-running deployments because release tags are easier to audit and roll back.

> **Note:** Published images (`:latest` and version tags) are pushed to GHCR when a `vX.Y.Z` release tag is created. If no release tag exists yet, use the source-build path above instead.

Running this long-term? [OPERATIONS.md](OPERATIONS.md) covers backup &
restore, upgrades, HTTPS/reverse-proxy setup, and a step-by-step Authentik
walkthrough.

> **Password requirements** — `FIRST_ADMIN_PASSWORD` is **required** in
> `docker-compose.prod.yml` (the compose file will refuse to start if it is
> missing). All local account passwords (registration, admin create, password
> change, and password reset) must be **at least 8 characters long**.

## Development

### 1. Start the database

The dev compose file bundles a throwaway Postgres published on `localhost:5432`,
so start just that one (from the terminal, or your IDE's Docker/Services panel):

```bash
docker compose -f docker-compose.dev.yml up -d db
```

### 2. Backend (hot reload)

```bash
cp .env.example .env    # repo root — the defaults point at the db above
cd backend
uv sync                 # creates .venv from uv.lock (first time only)
uv run uvicorn app.main:app --reload --port 8000
```

The repo-root `.env` is loaded automatically (the same file docker-compose
reads) and real env vars override it. Migrations are applied on startup and the
seeded admin (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` from your `.env`)
is created on first run. API docs: `http://localhost:8000/api/docs`.

### 3. Frontend (hot reload)

```bash
cd frontend
npm install             # first time only
npm run dev             # → http://localhost:1420
```

The Vite dev server proxies `/api` to `http://localhost:8000` (override with
`VITE_PROXY_TARGET`), so the SPA uses the same relative URLs as in production.

> Optional: a fully containerized hot-reload stack (db + API + Vite, one
> command) is available via `docker compose -f docker-compose.dev.yml up --build`.

## Useful commands

```bash
# Frontend (from ./frontend)
npm run build        # type-check + production build
npm run test         # frontend unit tests (Vitest)
npm run check-i18n   # validate translation parity

# Backend (from ./backend)
uv run uvicorn app.main:app --reload --port 8000
uv run alembic revision --autogenerate -m "msg"   # after model changes
```

## Authentik (optional)

To enable single sign-on, register an OAuth2/OpenID Connect provider in Authentik
with redirect URI `${FRONTEND_URL}/api/auth/oauth/authentik/callback`, then set
`AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, and `AUTHENTIK_DISCOVERY_URL`
in your environment. The "Sign in with Authentik" button appears automatically.
