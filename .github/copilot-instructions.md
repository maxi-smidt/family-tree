# GitHub Copilot Instructions

This file is automatically detected by GitHub Copilot and other AI coding assistants to provide context about the project.

## Project Overview

Family Tree is a self-hostable **web application** for building and exploring family history through an interactive visual interface. A React single-page app talks to a FastAPI backend backed by PostgreSQL, deployed with Docker Compose.

## Mandatory before every PR to `main` (CI-enforced)

1. **Bump the version** — run `npm run bump:patch` (or `bump:minor` / `bump:major`) in `frontend/`. The `check-version` workflow **fails the PR if `frontend/package.json` is unchanged**. This also updates `frontend/constants.json`.
2. **Translation parity** — run `npm run check-i18n` (from `frontend/`); the `check-i18n` workflow gates it.
3. **Build + tests green** — frontend (`npm run build`, `npx vitest run`) and backend (`uv run ruff check`, `uv run pytest`) must pass; the CI workflow runs all of these.

> Toolchain: **Node 22** (frontend, npm) and **Python 3.12 + uv** (backend). System defaults are often too old.

## Repo structure

```
frontend/   React + TypeScript + Vite SPA (own Dockerfile + nginx.conf)
backend/    FastAPI service — SQLAlchemy 2.0 + Alembic, managed with uv (own Dockerfile)
docker-compose.yml / docker-compose.dev.yml / .env.example
package.json (root)   repo-level tooling only (prettier + husky)
```

## Key Architecture

- **Frontend**: React + TypeScript + Vite, Shadcn UI + Tailwind, React Flow (`@xyflow/react`)
- **State**: Zustand — per-domain stores (`useMemberStore`, `useGalleryStore`, `useEventStore`, `useStoryStore`, `useDatabaseStore`, `useAuthStore`)
- **Backend**: FastAPI + SQLAlchemy 2.0 on PostgreSQL, Alembic migrations
- **Auth**: JWT local accounts + optional Authentik (OIDC); owned + shared trees
- **Deployment**: Docker Compose (nginx serves the SPA and proxies `/api` to FastAPI)

## Data Flow Pattern (CRITICAL — Always Follow)

```
UI Component → Store Action → DatabaseService (HTTP client) → FastAPI (/api) → SQLAlchemy → PostgreSQL
     ↓              ↓                      ↓
   Render ← State Update ←           Return Data
```

**Never bypass this flow:**

- Do NOT call `DatabaseService` directly from components
- Do NOT call `fetch`/the API directly from components
- All data modifications MUST go through store actions

`DatabaseService` (`frontend/src/services/DatabaseService.ts`) is a thin HTTP client over `frontend/src/services/api.ts`; each method takes a `treeId` and returns the `*DB` row shapes the stores map. Keep backend response field names aligned with the frontend `*DB` types.

## Essential Documentation

Before making changes, consult these in the `docs/` directory:

1. **[docs/AGENTS.md](../docs/AGENTS.md)** — architecture, data flow, frontend & backend patterns, conventions
2. **[docs/COPILOT.md](../docs/COPILOT.md)** — AI quick reference and common-task recipes
3. **[docs/SETUP.md](../docs/SETUP.md)** — production vs development setup
4. **[docs/I18N_GUIDE.md](../docs/I18N_GUIDE.md)** — internationalization conventions
5. **[backend/README.md](../backend/README.md)** — backend service details

## Quick Rules for Code Changes

### State management

- Use the relevant Zustand store for app state; never mutate state directly — use store actions
- Components only read state and call actions

### TypeScript

- Strict mode, no `any`; define interfaces for data structures

### Internationalization

- ALL user-facing text uses i18next; keys are hierarchical: `<feature>.<component>.<element>`
- Translations live in `frontend/src/i18n/locales/`; run `npm run check-i18n` (from `frontend/`)

### Testing

- Co-locate frontend tests: `filename.test.ts`; run `npm test` (from `frontend/`)

### Component structure

```typescript
import { Component } from "library";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTranslation } from "react-i18next";

interface ComponentProps {}

export function Component({ prop }: ComponentProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "feature.component" });
  const action = useMemberStore((state) => state.action);

  const handleClick = () => {};

  return <div>{t("label")}</div>;
}
```

## Common Tasks

### Adding a new field to Member

1. Add the column to the model in `backend/app/models/family.py`
2. Generate a migration: `uv run alembic revision --autogenerate -m "..."` (review it)
3. Update the Pydantic schema in `backend/app/schemas/family.py` (keep names aligned with the frontend `*DB` type)
4. Expose it via the relevant router in `backend/app/api/routes/`
5. Update `frontend/src/types/member.ts` and wire it through `DatabaseService` + the store
6. Update UI components and add translations

### Adding a backend endpoint

1. Add the route in `backend/app/api/routes/` using `Depends(get_readable_tree)` / `get_writable_tree` (or `require_admin`)
2. Return a Pydantic schema whose field names match the frontend contract
3. Add the matching `DatabaseService` method and call it from a store action

### Adding translations

1. Follow `docs/I18N_GUIDE.md`
2. Add to all locale files in `frontend/src/i18n/locales/`
3. Run `npm run check-i18n` (from `frontend/`)

## What NOT to Do

❌ Never bypass the store to call `DatabaseService` or `fetch`
❌ Never mutate store state directly
❌ Never use `any`
❌ Never hardcode user-visible text
❌ Never build raw SQL on the backend — go through SQLAlchemy models, scoped by `tree_id`

## Key Files

- `frontend/src/hooks/` — per-domain Zustand stores
- `frontend/src/services/DatabaseService.ts` — HTTP data-access layer
- `frontend/src/services/api.ts` — fetch wrapper + auth token
- `frontend/src/types/member.ts` — core data model
- `frontend/src/utils/layoutUtils.ts` — tree layout calculations
- `backend/app/api/routes/` — FastAPI routers
- `backend/app/models/` — SQLAlchemy models (migrations in `backend/alembic/`)

## Development Commands

```bash
# Frontend (from ./frontend)
npm run dev            # Vite dev server (proxies /api to the backend)
npm test               # unit tests
npm run check-i18n     # verify translations
npm run bump:patch     # REQUIRED on every PR — bumps frontend/package.json + constants.json (or bump:minor/major)

# Backend (from ./backend)
uv run uvicorn app.main:app --reload --port 8000

# Full stack
docker compose up -d --build
```

## For More Details

See the comprehensive documentation in the `docs/` directory and `backend/README.md`.
