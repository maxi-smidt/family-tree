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

## Branching

Branch names **should** follow `type/number-short-description` (recommended, not
CI-enforced): `type` is the [Conventional
Commits](https://www.conventionalcommits.org/) category (`feat`, `fix`, `perf`,
`refactor`, `docs`, `test`, `chore`), `number` is the issue number (drop it and
its slash when there's no issue), and `short-description` is a few kebab-case
words — e.g. `perf/123-faster-tree-layout` or `docs/update-branching` (no issue).

## Issue titles

Issues follow `area: short imperative summary` — e.g. `release: attest build
provenance and publish an SBOM for GHCR images`, `trees: track last-opened tree
per user instead of globally`. `area` is the domain or workstream the work sits
in (`ci`, `release`, `security`, `backend`, `gedcom`, `gallery`, `trees`,
`sharing`, `auth`, `documents`, `quality`, …), or `epic:` for a tracking issue
that groups sub-issues. Lowercase after the colon, no trailing period, under
~72 characters.

**Type and severity live in labels, not in the title** — `bug`, `enhancement`,
`refactor`, `epic`, plus `priority:high|medium|low`. Don't write `[Bug]:` or
`[Medium]` into a title.

## New features — always-on or admin-toggleable?

Before building a user-facing feature, **decide whether it should be gated by an
admin-managed feature flag or always on**, and say which in the PR description.
Flags live in the `FEATURES` registry in
[`feature_service.py`](backend/app/services/feature_service.py), mirrored 1:1 in
[`features.ts`](frontend/src/lib/features.ts); each has a global state admins
control — `on`, `off` (kill switch), or `beta` (per-user allowlist). Reach for a
flag when a feature is a self-contained domain admins might disable, beta-test,
or kill (`gallery`, `stories`, `gedcom`, …); core member/tree CRUD is
intentionally not flaggable. The four-step recipe is at the top of
`feature_service.py`. **If it's unclear which way to go, ask the requester** — it
is hard to reverse once the UI and data model assume one.

## PR titles & changelog

PRs are squash-merged, so **the PR title becomes a commit subject on `main` —
and release notes are generated from that history**, not hand-written. There is
no manual `CHANGELOG.md` entry to add.

PR titles **must be a [Conventional Commit](https://www.conventionalcommits.org/)
subject** — `type(scope): summary`, e.g. `feat(gallery): add face-tag search`
or `fix(sharing): revoke access for open sessions`; a CI lint job
([`amannn/action-semantic-pull-request`](.github/workflows/pr-title-lint.yml))
rejects PRs whose title doesn't parse. [`cliff.toml`](cliff.toml) maps types to
[Keep a Changelog](https://keepachangelog.com/) groups when a release is cut:
`feat` → Added, `fix` → Fixed, `perf`/`refactor` → Changed, `security` →
Security. `chore`, `typing`, `test`, `docs`, `ci`, `build`, and `style` are
internal-only and excluded from generated notes — pick one of those types for
work users never see instead of `feat`/`fix`.

## Golden rules — CI enforces these; a PR fails without them

1. **Do not bump the app version on ordinary PRs.** Release preparation is the
   exception: from `frontend/` run `npm run bump:patch` (or `bump:minor` /
   `bump:major`; `release:*` also commits + tags) — it updates
   `frontend/package.json` + lockfile + `backend/pyproject.toml` + `uv.lock`.
   Merge that release commit, then create a matching `vX.Y.Z` tag; CI verifies
   the tag matches `frontend/package.json` and the lockfile.
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

**Node.js 24** (frontend, npm; dev floor v20.19+/v22.12+) and **Python 3.12 +
[uv](https://docs.astral.sh/uv/)** (backend — not pip/poetry). Don't rely on
system defaults; they are usually too old.

## Commands

### Setup & run (development)

Config lives in a single repo-root `.env` (copy from `.env.example`), read by
both docker-compose and a host-run dev backend. Full walkthrough:
[docs/SETUP.md](docs/SETUP.md).

```bash
docker compose -f docker-compose.dev.yml up -d db                            # dev Postgres on :5432
cd backend  && uv sync && uv run uvicorn app.main:app --reload --port 8000   # API docs at /api/docs
cd frontend && npm install && npm run dev                                    # :1420 (proxies /api → :8000)
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
docker compose -f docker-compose.e2e.yml up --build -d   # full stack on :8080
cd e2e && npm install && npx playwright install --with-deps chromium
E2E_ADMIN_USERNAME=e2e-admin E2E_ADMIN_PASSWORD=e2e-admin-password npx playwright test
docker compose -f docker-compose.e2e.yml down -v
```

`E2E_ADMIN_*` must match the stack's `FIRST_ADMIN_*` (defaults `e2e-admin` /
`e2e-admin-password`); override `E2E_BASE_URL` for remote stacks. Reports land in
`e2e/playwright-report/`. The `e2e.yml` workflow runs on PRs to `main` but is not
a required check yet.

### Database migration (after editing `backend/app/models/`)

```bash
cd backend && uv run alembic revision --autogenerate -m "describe change"   # review it
uv run alembic upgrade head
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
- [ ] PR title is a Conventional Commit subject (`type(scope): summary`) — it
      becomes the changelog line for this change
