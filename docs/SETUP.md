# Setup Guide

This guide helps you set up the Family Tree web application for development.

## Prerequisites

- **Node.js** v20.19+ (or v22.12+) — for the frontend
- **Python** 3.12+ and **[uv](https://docs.astral.sh/uv/)** — for the backend
- **PostgreSQL** 14+ — or just use Docker
- **Docker** + **Docker Compose** — recommended for running the full stack

> The web app lives in `frontend/`, the API in `backend/`. The repo root holds
> only the Docker Compose stack and shared tooling (prettier + git hooks).

## Option A — Run everything with Docker (recommended)

```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree

cp .env.example .env
# Set SECRET_KEY and FIRST_ADMIN_PASSWORD at minimum.

docker compose up -d --build
```

Open `http://localhost:${UI_PORT}` (default `8080`) and sign in with the seeded
admin account (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD`).

## Option B — Hot-reload dev with Docker (one command)

The simplest dev setup — Postgres, the API (with `uvicorn --reload`), and the
Vite dev server (with HMR), all wired together:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Open **http://localhost:1420**. Backend code changes reload automatically and
frontend edits hot-reload in the browser. The seeded admin is `admin` / `admin`.
Postgres (`5432`) and the API (`8000`) are published too, so you can connect to
them directly.

> macOS/Windows note: HMR uses polling inside Docker (`VITE_USE_POLLING`), which
> can be CPU-heavy. If you prefer native file watching, use Option C below (run
> the frontend on the host).

## Option C — Hot-reload dev on the host

Run Postgres (via Docker is easiest), then the backend and frontend dev servers.

### 1. Database

```bash
docker run -d --name ft-db \
  -e POSTGRES_USER=familytree -e POSTGRES_PASSWORD=familytree -e POSTGRES_DB=familytree \
  -p 5432:5432 postgres:18-alpine
```

### 2. Backend

```bash
cd backend
uv sync                       # creates .venv from uv.lock

export SECRET_KEY=dev-secret
export DATABASE_URL=postgresql+psycopg2://familytree:familytree@localhost:5432/familytree
export DATA_PATH=./.data APP_DATA_PATH=./.appdata
export CORS_ORIGINS=http://localhost:1420
export FRONTEND_URL=http://localhost:1420

uv run uvicorn app.main:app --reload --port 8000
```

Migrations are applied automatically on startup, and the seeded admin
(`admin` / `admin` by default) is created on first start.
API docs: `http://localhost:8000/api/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # serves on http://localhost:1420
```

The Vite dev server proxies `/api` to `http://localhost:8000` (override with
`VITE_PROXY_TARGET`), so the SPA uses the same relative URLs as in production.

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
