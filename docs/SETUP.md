# Setup Guide

Two ways to run it: the full **production** stack with Docker Compose, or
**development** where you start the database in a container and run the two dev
servers directly (with hot reload).

The web app lives in `frontend/`, the API in `backend/`. The repo root holds
only the Docker Compose stack and shared tooling (prettier + git hooks).

## Prerequisites

- **Docker** + **Docker Compose** — runs production, and the database in dev
- **Node.js** v20.19+ (or v22.12+) — for the frontend dev server
- **Python** 3.12+ and **[uv](https://docs.astral.sh/uv/)** — for the backend dev server

## Production

```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree

cp .env.example .env
# Set SECRET_KEY and FIRST_ADMIN_PASSWORD at minimum.

docker compose up -d --build
```

Open `http://localhost:${UI_PORT}` (default `8080`) and sign in with the seeded
admin (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD`). Migrations run
automatically on first start.

Running this long-term? [OPERATIONS.md](OPERATIONS.md) covers backup &
restore, upgrades, HTTPS/reverse-proxy setup, and a step-by-step Authentik
walkthrough.

> **Password requirements** — `FIRST_ADMIN_PASSWORD` is **required** in
> `docker-compose.prod.yml` (the compose file will refuse to start if it is
> missing). All local account passwords (registration, admin create, password
> change, and password reset) must be **at least 8 characters long**.

## Development

### 1. Start the database

The `db` service is published on `127.0.0.1:5432`, so start just that one
(from the terminal, or your IDE's Docker/Services panel):

```bash
docker compose up -d db
```

### 2. Backend (hot reload)

```bash
cd backend
uv sync                 # creates .venv from uv.lock (first time only)
cp .env.example .env    # points at the db above; edit if you changed credentials
uv run uvicorn app.main:app --reload --port 8000
```

`backend/.env` is loaded automatically and real env vars override it. Migrations
are applied on startup and the seeded admin (`admin` / `admin`) is created on
first run. API docs: `http://localhost:8000/api/docs`.

> No database running? Set `DATABASE_URL=sqlite:///./dev.db` in `backend/.env`
> for a zero-setup run.

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
