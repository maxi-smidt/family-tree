# AGENTS.md

Shared instructions for AI coding agents — **OpenAI Codex**, **Claude Code**,
**GitHub Copilot** (coding agent), **Google Antigravity**, Cursor, and others —
working in this repository. This is the **single source of truth**; the
tool-specific files ([`CLAUDE.md`](CLAUDE.md) and
[`.github/copilot-instructions.md`](.github/copilot-instructions.md)) point here.

> Deep architecture & conventions live in **[docs/AGENTS.md](docs/AGENTS.md)**.
> This file is the operational quick-start plus the rules CI enforces.

## What this is

Family Tree — a self-hostable web app for building and exploring family history
through an interactive visual tree. A React SPA talks to a FastAPI backend backed
by PostgreSQL, wired together with Docker Compose. Local JWT accounts plus
optional Authentik (OIDC). Each tree is **owned** by a user and can be **shared**
as `viewer` or `editor`.

## Repository map

```
frontend/   React + TypeScript + Vite SPA — Shadcn UI + Tailwind, React Flow, Zustand (own Dockerfile + nginx.conf)
backend/    FastAPI service — SQLAlchemy 2.0 + Alembic, managed with uv (own Dockerfile)
docs/       AGENTS.md (architecture), COPILOT.md, SETUP.md, SECURITY.md, I18N_GUIDE.md
.github/    CI workflows + Copilot instructions
docker-compose*.yml, .env.example   the deployment stack
package.json (root)   repo-level tooling ONLY — prettier + husky (this is NOT the app)
```

The app **version** lives in **`frontend/package.json`** (mirrored to
`frontend/constants.json` by the bump script). The root `package.json` is just
tooling and has no app version.

## How the pieces interact

```
Browser (React SPA)
  │  JWT in the Authorization header; calls relative /api/... URLs
  ▼
nginx (frontend container)  — serves the SPA, proxies /api → backend
  ▼
FastAPI (backend container) — filesystem at DATA_PATH/media (photos & gallery images)
  ▼
PostgreSQL
```

Frontend data flow — **never bypass it:**

```
UI Component → Zustand store action → DatabaseService (HTTP client)
            → FastAPI router (/api) → SQLAlchemy model → PostgreSQL
```

- Components only **read** store state and **call** store actions. Never call
  `DatabaseService` or `fetch` directly from a component.
- `DatabaseService` (`frontend/src/services/DatabaseService.ts`, a thin client
  over `frontend/src/services/api.ts`) — each method takes a `treeId` and returns
  the `*DB` row shapes the stores map. **Keep backend Pydantic response field
  names aligned with the frontend `*DB` types** — that contract is what keeps the
  layers decoupled.
- Per-domain Zustand stores in `frontend/src/hooks/`: `useDatabaseStore` (active
  tree + metadata), `useMemberStore`, `useGalleryStore`, `useEventStore`,
  `useStoryStore`, `useAuthStore`.
- Backend authorization: reads use `Depends(get_readable_tree)`, writes use
  `Depends(get_writable_tree)`, admin routes use `Depends(require_admin)`. **Every
  content query is scoped by `tree_id`.** Never build raw SQL — go through
  SQLAlchemy models in `backend/app/models/`.
- Schema is versioned with **Alembic**; `alembic upgrade head` runs automatically
  on backend startup, then the admin user + default settings are seeded.

## Golden rules — CI enforces these; a PR fails without them

1. **Bump the version on EVERY PR to `main`.** Run `npm run bump:patch` (or
   `bump:minor` / `bump:major`) in `frontend/`. The
   [check-version](.github/workflows/check-version.yml) workflow compares
   `frontend/package.json` against `main` and **fails the PR if the version is
   unchanged**, and only accepts a clean transition (`x.y.z → x.y.(z+1)`,
   `→ x.(y+1).0`, or `→ (x+1).0.0`).
2. **All user-facing text goes through i18next** and must exist in every locale
   under `frontend/src/i18n/locales/`. Run `npm run check-i18n` (from
   `frontend/`); the [check-i18n](.github/workflows/check-i18n.yml) workflow gates
   it. Keys are hierarchical: `<feature>.<component>.<element>` (see
   [docs/I18N_GUIDE.md](docs/I18N_GUIDE.md)).
3. **Both apps must build & test green.** The
   [CI](.github/workflows/check-build.yml) workflow runs the frontend build +
   Vitest and the backend ruff + compile + pytest. Match it locally before
   pushing (commands below).

## Toolchain

- **Node.js 22** (CI pins `22`; dev floor is v20.19+ / v22.12+) — frontend uses
  **npm**.
- **Python 3.12** + **[uv](https://docs.astral.sh/uv/)** — backend uses **uv**,
  not pip/poetry.
- Don't rely on system defaults; they are usually too old.

## Commands

### Setup (development)

```bash
docker compose up -d db                 # Postgres on 127.0.0.1:5432
cd backend  && uv sync                  # creates .venv from uv.lock
cd frontend && npm install
```

> Zero-database option: set `DATABASE_URL=sqlite:///./dev.db` in `backend/.env`.

### Run (hot reload)

```bash
cd backend  && uv run uvicorn app.main:app --reload --port 8000   # API docs at /api/docs
cd frontend && npm run dev                                        # http://localhost:1420 (proxies /api → :8000)
```

### Match CI before pushing

```bash
# Frontend (from ./frontend)
npm run build            # tsc type-check + vite build
npx vitest run           # one-shot unit tests (note: `npm test` is watch mode)
npm run check-i18n       # translation parity

# Backend (from ./backend)
uv run ruff check
uv run python -m compileall -q app alembic && uv run python -c "import app.main"
uv run pytest
```

### Database migration (after editing `backend/app/models/`)

```bash
cd backend
uv run alembic revision --autogenerate -m "describe change"   # review the generated file
uv run alembic upgrade head
```

### Version bump (required on every PR)

```bash
cd frontend && npm run bump:patch        # or bump:minor / bump:major
```

## Conventions (short form)

- TypeScript **strict**; no `any` (use `unknown`). Interfaces for object shapes.
  Prettier owns all formatting (auto-runs on commit via husky).
- Components: PascalCase files; hooks `useX`; tests co-located as `*.test.ts`.
- Tree layout is computed in `frontend/src/utils/layoutUtils.ts` (dagre) — never
  set node positions manually; recompute the full layout.
- Full conventions, file organization, and task recipes:
  **[docs/AGENTS.md](docs/AGENTS.md)** and **[docs/COPILOT.md](docs/COPILOT.md)**.
  Security / export-encryption model: **[docs/SECURITY.md](docs/SECURITY.md)**.

## PR checklist

- [ ] Version bumped in `frontend/package.json` (`npm run bump:*`)
- [ ] `npm run build` + `npx vitest run` pass (frontend)
- [ ] `uv run ruff check` + `uv run pytest` pass (backend)
- [ ] `npm run check-i18n` passes; new strings translated in **all** locales
- [ ] Schema changes have an Alembic migration
