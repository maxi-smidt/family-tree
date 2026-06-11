# Agent & Development Guidelines

This document outlines the core architectural decisions, development practices, and guidelines for the Family Tree project. It is intended to help developers and AI coding agents understand the project's structure and make consistent, informed contributions.

> **For Setup Instructions**: See [SETUP.md](./SETUP.md) for development environment setup.
> **For Copilot Users**: See [COPILOT.md](./COPILOT.md) for GitHub Copilot-specific guidelines.

## Table of Contents

1.  [Tech Stack](#tech-stack)
2.  [Architecture Overview](#architecture-overview)
3.  [Core Concepts](#core-concepts)
4.  [State Management (Zustand)](#state-management-zustand)
5.  [Backend & Persistence](#backend--persistence)
6.  [Frontend Guidelines](#frontend-guidelines)
7.  [Backend Guidelines](#backend-guidelines)
8.  [Testing](#testing)
9.  [Code Style & Conventions](#code-style--conventions)
10. [Contributing](#contributing)

---

## Tech Stack

- **Framework**: React (Vite) + TypeScript
- **Backend**: FastAPI (Python) + SQLAlchemy 2.0
- **State Management**: Zustand (per-domain stores)
- **UI Library**: Shadcn UI + Tailwind CSS
- **Graph/Visualization**: @xyflow/react (React Flow)
- **Layout Engine**: Dagre.js (`layoutUtils.ts`)
- **Icons**: Lucide React
- **Internationalization**: i18next
- **Testing**: Vitest + React Testing Library (frontend)
- **Database**: PostgreSQL
- **Auth**: JWT (local accounts) + Authentik OIDC (optional)
- **Deployment**: Docker Compose (nginx + FastAPI + Postgres)

---

## Architecture Overview

### High-Level Structure

The application follows a **frontend-backend separation** pattern:

- **Frontend (React/TypeScript)**: UI, user interactions, and state management
- **Backend (FastAPI/Python)**: REST API, authentication, database access, and media storage

### Communication Flow

```
User Interaction → React Component → Zustand Store Action
                                          ↓
                                   TreeService (HTTP client)
                                          ↓
                                   FastAPI REST API (/api/...)
                                          ↓
                                   SQLAlchemy → PostgreSQL
```

`TreeService` keeps the same method names and return shapes the stores
expect (`MemberDB`, `RelationDB`, ...), so swapping the storage backend left the
stores and components almost untouched — each method now takes a `treeId` and
issues an HTTP request instead of a SQL query.

### Key Design Decisions

1. **Client/Server**: Data lives in PostgreSQL behind the FastAPI API
2. **Per-domain stores**: Zustand stores (`useMemberStore`, `useGalleryStore`, ...) own their slice of state
3. **Service Layer**: `TreeService` encapsulates all API calls
4. **Owned + shared trees**: each tree has an owner and can be shared as viewer/editor
5. **Auth**: JWT-based; local accounts plus optional Authentik OIDC; admin-managed users
6. **Component-Based UI**: Reusable UI components from Shadcn UI library

---

## Core Concepts

### Data Model (`Member`)

The core entity is the `Member` (defined in `frontend/src/types/member.ts`). It includes identification, genealogical links, personal attributes, and layout information.

### Layout Logic

Automatic layout is handled in `frontend/src/utils/layoutUtils.ts` using `dagre` for topological sorting. The layout algorithm enforces a "Paternal (Father) on the Left" and "Maternal (Mother) on the Right" convention.

### File Organization

- **Components**: Located in `frontend/src/components/`, organized by category:
  - `layout/` - App-wide layout components (MainPanel, Layout, ErrorBoundary)
  - `shared/` - Reusable components used across features (dialogs, member-sheet)
  - `view/` - Feature-specific view components (tree-view, gallery-view, list-view, timeline-view, etc.)
  - `sidebar/` - Sidebar components (DatabaseSelector, LanguageSelector)
  - `ui/` - Base UI library components from Shadcn UI
- **Hooks**: Custom hooks in `frontend/src/hooks/`, including the main store
- **Services**: Business logic and database operations in `frontend/src/services/`
- **Types**: TypeScript definitions in `frontend/src/types/`
- **Utilities**: Helper functions in `frontend/src/utils/`

---

## State Management (Zustand)

Application state is split across per-domain Zustand stores in `frontend/src/hooks/`:
`useDatabaseStore` (the selected tree, its metadata and relation types),
`useMemberStore`, `useGalleryStore`, `useEventStore`, `useStoryStore`, plus
`useAuthStore` for the current session.

- **Actions**: All interactions with the backend (reads and writes) are handled through actions within the stores.
- **Data Flow**: Components call store actions to modify state and rely on reactive updates to re-render.
- **Database Service**: The stores delegate to `frontend/src/services/TreeService.ts`, an HTTP client over the FastAPI API (`frontend/src/services/api.ts`). The active `treeId` comes from `useDatabaseStore`.

### Best Practices

1. **Never bypass the store**: Always use store actions for data modifications
2. **Avoid direct database calls**: Use TreeService methods only through store actions
3. **Keep components pure**: Components should only read from store state and call actions
4. **Selective subscriptions**: Use selective store subscriptions to avoid unnecessary re-renders:
   ```typescript
   const members = useMemberStore((state) => state.members);
   ```

---

## Backend & Persistence

The backend lives in `backend/` (FastAPI). See [backend/README.md](../backend/README.md) for its internal layout.

### Schema management

The ORM models in `backend/app/models/` are the source of truth, and the schema
is versioned with **Alembic** (`backend/alembic/`). On startup the service runs
`alembic upgrade head` automatically, then seeds the admin + default settings.

### Adding a field / table

1. Update the relevant model in `backend/app/models/`.
2. Generate a migration: `uv run alembic revision --autogenerate -m "..."`,
   review it, then it is applied on the next startup (or `uv run alembic upgrade head`).
3. Update the matching Pydantic schema in `backend/app/schemas/` (keep the field
   names aligned with the frontend `*DB` contracts).
4. Expose it through the relevant router in `backend/app/api/routes/`.
5. Wire the frontend through `frontend/src/services/TreeService.ts` and the store.

### Database schema (per tree)

All content tables carry a `tree_id`. Key tables:

- `users`, `trees`, `tree_memberships` — accounts and the owned + shared model
- `members`, `relations`, `relation_types`, `member_diseases`
- `events` / `event_member_link`, `stories` / `story_member_link`
- `gallery_images` / `gallery_member_link`
- `app_settings` — instance-wide settings (key/value)

Member photos and gallery images are stored on the filesystem (`DATA_PATH/media`)
and referenced by URL.

---

## Frontend Guidelines

### Component Structure

Components follow a consistent structure:

```typescript
// 1. Imports
import { Component } from "library";
import { useStore } from "@/hooks/useStore";

// 2. Types/Interfaces
interface ComponentProps {
  // ...
}

// 3. Component
export function Component({ prop }: ComponentProps) {
  // Hooks
  const state = useStore();

  // Event handlers
  const handleClick = () => { };

  // Render
  return <div>...</div>;
}
```

### UI Component Guidelines

- **Use Shadcn UI components**: Prefer pre-built components from `frontend/src/components/ui/`
- **Tailwind CSS**: Use utility classes for styling
- **Lucide Icons**: Use consistent icon set throughout the app
- **Responsive Design**: Ensure components work on different window sizes

### React Flow Integration

When working with the family tree visualization:

- Use `@xyflow/react` for the flow canvas
- Custom node types are defined in `frontend/src/components/view/tree-view/node/FamilyNode.tsx`
- Custom edge types are defined in `frontend/src/components/view/tree-view/edge/RelationEdge.tsx`
- Layout calculations are in `frontend/src/utils/layoutUtils.ts`
- Never modify node positions manually; always recalculate the full layout

### Internationalization

- All user-facing text must use i18next translations
- Translation keys are in `frontend/src/i18n/locales/`
- Use the `useTranslation` hook: `const { t } = useTranslation('namespace');`
- Follow the naming conventions in the **[i18n Guide](./I18N_GUIDE.md)** for consistent key structure
- Run `npm run check-i18n` to verify translation completeness

**Quick Example:**

```typescript
const { t } = useTranslation(undefined, {
  keyPrefix: "dialog.create-database"
});
return <h1>{t("title")}</h1>;
```

For detailed patterns, pluralization, and best practices, see the [i18n Guide](./I18N_GUIDE.md).

---

## Backend Guidelines

The backend is a FastAPI app in `backend/app/`. Each resource is a router in
`backend/app/api/routes/`, returning Pydantic schemas whose field names match
the frontend `*DB` contracts.

### Adding an endpoint

```python
@router.get("/members", response_model=list[MemberOut])
def list_members(tree: Tree = Depends(get_readable_tree), db: Session = Depends(get_db)):
    return db.scalars(select(Member).where(Member.tree_id == tree.id)).all()
```

- Use `Depends(get_readable_tree)` for reads and `Depends(get_writable_tree)`
  for writes — these enforce the owned + shared access model and 404/403 as
  appropriate.
- Admin-only routes use `Depends(require_admin)`.
- Keep request/response field names aligned with the frontend types so
  `TreeService` and the stores keep working unchanged.

### Database operations

1. Go through SQLAlchemy models — never build raw SQL strings.
2. Scope every query by `tree_id`.
3. Commit within the request; let FastAPI return the serialized model.
4. Update the model in `backend/app/models/` when changing the schema.

---

## Testing

The project uses **Vitest** for unit testing.

- **Location**: Tests are co-located with the files they test (e.g., `frontend/src/types/member.test.ts`).
- **Running Tests**: Run `npm test` to execute the test suite.
- **Scope**: Focus on testing pure logic, data mapping functions, and utility algorithms (like layout calculations).

### What to Test

1. **Pure Functions**: Utility functions, data transformations, validators
2. **Business Logic**: State management actions, data processing
3. **Layout Algorithms**: Tree layout calculations
4. **Type Guards**: TypeScript type narrowing functions

### What Not to Test

- UI components (no React Testing Library tests currently)
- Backend endpoints (covered separately on the Python side)
- Third-party library integrations

### Writing Tests

```typescript
import { describe, it, expect } from "vitest";
import { functionToTest } from "./module";

describe("functionToTest", () => {
  it("should handle expected case", () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
  });

  it("should handle edge case", () => {
    const result = functionToTest(edgeCase);
    expect(result).toBe(edgeExpected);
  });
});
```

---

## Code Style & Conventions

### TypeScript

- Use **strict mode** (`strict: true` in tsconfig.json)
- Prefer **interfaces** over type aliases for object shapes
- Use **explicit return types** for exported functions
- Avoid `any`; use `unknown` when type is truly unknown

### Naming Conventions

- **Components**: PascalCase (e.g., `MemberSheet.tsx`)
- **Hooks**: camelCase with "use" prefix (e.g., `useMemberStore.ts`)
- **Utilities**: camelCase (e.g., `layoutUtils.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `NODE_WIDTH`)
- **Types/Interfaces**: PascalCase (e.g., `Member`, `LifeEvent`)

### File Naming

- Components: `ComponentName.tsx`
- Utilities: `descriptiveName.ts`
- Tests: `filename.test.ts` (co-located with the tested file)
- Types: `typename.ts` (singular, e.g., `member.ts`)

### Formatting

- **Prettier** handles all formatting automatically
- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line structures
- Line width: 80 characters (recommended)

### Comments

- Use JSDoc comments for exported functions and complex logic
- Inline comments should explain "why", not "what"
- Avoid obvious comments
- Keep comments up-to-date with code changes

---

## Contributing

### Before You Start

1. Read this document thoroughly
2. Review [SETUP.md](./SETUP.md) for development environment setup
3. Familiarize yourself with the codebase structure
4. Check existing issues and PRs to avoid duplicate work

### Development Workflow

1. **Create a branch**: `git checkout -b feature/your-feature-name`
2. **Make changes**: Follow the guidelines in this document
3. **Test**: Run `npm test` to ensure tests pass
4. **Format**: Prettier will auto-format on commit via Husky
5. **Commit**: Write clear, descriptive commit messages
6. **Push**: Push your branch and create a pull request

### Pull Request Guidelines

- **Title**: Clear and descriptive (e.g., "Add timeline filtering by event type")
- **Description**: Explain what changes were made and why
- **Testing**: Describe how you tested the changes
- **Screenshots**: Include screenshots for UI changes
- **Breaking Changes**: Clearly mark any breaking changes

### Code Review Focus

Reviewers will check for:

- Adherence to architectural patterns (store → service → API)
- Proper error handling
- Type safety (no `any` types)
- Test coverage for new logic
- Code style consistency
- Internationalization for user-facing text

### Migration Changes

If your changes require database schema modifications:

1. Update the relevant model in `backend/app/models/`
2. Update the matching Pydantic schema and router
3. Document the change in your PR description
4. Test that the schema still creates cleanly on a fresh database

---

## Additional Resources

- **[i18n Guide](./I18N_GUIDE.md)**: Translation conventions and patterns
- **FastAPI**: [Documentation](https://fastapi.tiangolo.com/)
- **SQLAlchemy**: [Documentation](https://docs.sqlalchemy.org/)
- **React Flow**: [Documentation](https://reactflow.dev/)
- **Zustand**: [Documentation](https://zustand-demo.pmnd.rs/)
- **Shadcn UI**: [Component Library](https://ui.shadcn.com/)
- **i18next**: [Documentation](https://www.i18next.com/)

---

**Questions?** Open an issue or discussion on the [GitHub repository](https://github.com/maxi-smidt/family-tree).
