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
e2e/        Playwright end-to-end tests (standalone npm workspace)
docs/       AGENTS.md (architecture), COPILOT.md, SETUP.md, SECURITY.md, I18N_GUIDE.md
.github/    CI workflows + Copilot instructions
docker-compose*.yml, .env.example   the deployment stack
docker-compose.e2e.yml              ephemeral stack for E2E tests (adds Postgres)
package.json (root)   repo-level tooling ONLY — prettier + husky (this is NOT the app)
```

Release versions are cut from Git tags (`vX.Y.Z`). `frontend/package.json`
holds the release metadata used by the bump script; runtime app containers get
their displayed version/revision from Docker build metadata. The root
`package.json` is just tooling and has no app version.

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
UI Component → Zustand store action → TreeService (HTTP client)
            → FastAPI router (/api) → SQLAlchemy model → PostgreSQL
```

- Components only **read** store state and **call** store actions. Never call
  `TreeService` or `fetch` directly from a component.
- `TreeService` (`frontend/src/services/TreeService.ts`, a thin client
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

1. **Do not bump the app version on ordinary PRs.** Release preparation is the
   exception: run `npm run bump:patch` (or `bump:minor` / `bump:major`) in
   `frontend/`, merge that release commit, then create a matching `vX.Y.Z` tag.
   CI verifies that release tags match `frontend/package.json` and the lockfile.
2. **All user-facing text goes through i18next** and must exist in every locale
   under `frontend/src/i18n/locales/`. Run `npm run check-i18n` (from
   `frontend/`); the [CI](.github/workflows/check-build.yml) workflow gates it.
   Keys are hierarchical: `<feature>.<component>.<element>` (see
   [docs/I18N_GUIDE.md](docs/I18N_GUIDE.md)).
3. **Both apps must build & test green.** The
   [CI](.github/workflows/check-build.yml) workflow runs the frontend build +
   Vitest and the backend ruff + compile + pytest. Match it locally before
   pushing (commands below).

## Toolchain

- **Node.js 24** (CI pins `24`; dev floor is v20.19+ / v22.12+) — frontend uses
  **npm**.
- **Python 3.12** + **[uv](https://docs.astral.sh/uv/)** — backend uses **uv**,
  not pip/poetry.
- Don't rely on system defaults; they are usually too old.

## Commands

### Setup (development)

```bash
docker compose -f docker-compose.dev.yml up -d db   # dev Postgres on localhost:5432
cd backend  && uv sync                              # creates .venv from uv.lock
cd frontend && npm install
```

> Configuration lives in a single repo-root `.env` (copy from `.env.example`);
> both docker-compose and a host-run dev backend read it.

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
uv run pytest          # add -n auto to match CI's parallel run (pytest-xdist)
```

### End-to-end tests (Playwright)

```bash
# 1. Start the full test stack (Postgres + backend + frontend, built from source)
docker compose -f docker-compose.e2e.yml up --build -d

# 2. Install Playwright and its browser
cd e2e && npm install
npx playwright install --with-deps chromium

# 3. Run the suite
E2E_ADMIN_USERNAME=e2e-admin E2E_ADMIN_PASSWORD=e2e-admin-password npx playwright test

# 4. Tear down
docker compose -f docker-compose.e2e.yml down -v
```

- `E2E_BASE_URL` defaults to `http://localhost:8080`; override for remote stacks.
- `E2E_API_URL` defaults to `${E2E_BASE_URL}/api`.
- `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` must match the compose stack's
  `FIRST_ADMIN_*` env vars — defaults in the compose file are `e2e-admin` / `e2e-admin-password`.
- Reports land in `e2e/playwright-report/`; run `npm run report` to open them.
- The `e2e.yml` CI workflow runs on every PR to `main` but is **not** a required
  check yet (keep PR latency acceptable until the suite stabilises).

### Database migration (after editing `backend/app/models/`)

```bash
cd backend
uv run alembic revision --autogenerate -m "describe change"   # review the generated file
uv run alembic upgrade head
```

### Release version bump (release preparation only)

```bash
cd frontend && npm run bump:patch        # or bump:minor / bump:major
# updates frontend/package.json + package-lock.json + backend/pyproject.toml + uv.lock
# after merge: create and push tag vX.Y.Z matching frontend/package.json
# — or use npm run release:patch|minor|major to bump, commit and tag in one go
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

- [ ] Version bumped only if this is a release-preparation PR (`npm run bump:*`)
- [ ] `npm run build` + `npx vitest run` pass (frontend)
- [ ] `uv run ruff check` + `uv run pytest` pass (backend)
- [ ] `npm run check-i18n` passes; new strings translated in **all** locales
- [ ] Schema changes have an Alembic migration
