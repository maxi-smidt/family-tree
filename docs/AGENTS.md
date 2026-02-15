# Agent & Development Guidelines

This document outlines the core architectural decisions, development practices, and guidelines for the Family Tree project. It is intended to help developers and AI coding agents understand the project's structure and make consistent, informed contributions.

> **For Setup Instructions**: See [SETUP.md](./SETUP.md) for development environment setup.
> **For Copilot Users**: See [COPILOT.md](./COPILOT.md) for GitHub Copilot-specific guidelines.

## Table of Contents

1.  [Tech Stack](#tech-stack)
2.  [Architecture Overview](#architecture-overview)
3.  [Core Concepts](#core-concepts)
4.  [State Management (Zustand)](#state-management-zustand)
5.  [Database Migration Framework](#database-migration-framework)
6.  [Frontend Guidelines](#frontend-guidelines)
7.  [Backend Guidelines](#backend-guidelines)
8.  [Testing](#testing)
9.  [Code Style & Conventions](#code-style--conventions)
10. [Contributing](#contributing)

---

## Tech Stack

- **Framework**: React (Vite) + TypeScript
- **Native Runtime**: Tauri (Rust)
- **State Management**: Zustand (`useFamilyStore`)
- **UI Library**: Shadcn UI + Tailwind CSS
- **Graph/Visualization**: @xyflow/react (React Flow)
- **Layout Engine**: Dagre.js (`layoutUtils.ts`)
- **Icons**: Lucide React
- **Internationalization**: i18next
- **Testing**: Vitest + React Testing Library
- **Database**: SQLite (via Tauri SQL plugin)

---

## Architecture Overview

### High-Level Structure

The application follows a **frontend-backend separation** pattern:

- **Frontend (React/TypeScript)**: Handles UI, user interactions, and state management
- **Backend (Rust/Tauri)**: Manages database operations, file system access, and native OS integration

### Communication Flow

```
User Interaction → React Component → Zustand Store Action
                                          ↓
                                   DatabaseService
                                          ↓
                                   Tauri Commands (Rust)
                                          ↓
                                      SQLite DB
```

### Key Design Decisions

1. **Local-First**: All data is stored locally using SQLite
2. **Single Store Pattern**: One Zustand store (`useFamilyStore`) manages all application state
3. **Service Layer**: DatabaseService encapsulates all database interactions
4. **Migration Framework**: Version-based schema migrations managed by Rust backend
5. **Component-Based UI**: Reusable UI components from Shadcn UI library

---

## Core Concepts

### Data Model (`Member`)

The core entity is the `Member` (defined in `src/types/member.ts`). It includes identification, genealogical links, personal attributes, and layout information.

### Layout Logic

Automatic layout is handled in `src/utils/layoutUtils.ts` using `dagre` for topological sorting. The layout algorithm enforces a "Paternal (Father) on the Left" and "Maternal (Mother) on the Right" convention.

### File Organization

- **Components**: Located in `src/components/`, organized by feature (e.g., `member-sheet/`, `timeline/`)
- **Hooks**: Custom hooks in `src/hooks/`, including the main store
- **Services**: Business logic and database operations in `src/services/`
- **Types**: TypeScript definitions in `src/types/`
- **Utilities**: Helper functions in `src/utils/`

---

## State Management (Zustand)

Global application state is managed by a single Zustand store located at `src/hooks/useFamilyStore.ts`. This store is the single source of truth for all family data, gallery images, and database metadata.

- **Actions**: All interactions with the database (reads and writes) are handled through actions within the store.
- **Data Flow**: Components should call actions from the store to modify state and then rely on the reactive state updates to re-render.
- **Database Service**: The store delegates direct database operations to `src/services/DatabaseService.ts`, which encapsulates all SQL queries (defined in `src/db/queries.ts`).

### Best Practices

1. **Never bypass the store**: Always use store actions for data modifications
2. **Avoid direct database calls**: Use DatabaseService methods only through store actions
3. **Keep components pure**: Components should only read from store state and call actions
4. **Selective subscriptions**: Use selective store subscriptions to avoid unnecessary re-renders:
   ```typescript
   const members = useFamilyStore((state) => state.members);
   ```

---

## Database Migration Framework

To ensure smooth schema evolution and prevent data loss, the project uses a version-based migration framework managed by the Rust backend.

### How It Works

1.  **Versioning**: The database schema version is tracked using SQLite's `PRAGMA user_version`.

2.  **Migration Runner**: The migration logic resides in `src-tauri/src/lib.rs`. The `run_migrations` function checks the current `user_version` and executes pending SQL statements.

3.  **Execution**: When a user opens a database, the frontend invokes the `initialize_database` Tauri command. This command opens the SQLite connection, runs any necessary migrations, and ensures the schema is up-to-date before the frontend connects.

### Adding a New Migration

To update the database schema:

1.  Open `src-tauri/src/lib.rs`.
2.  Locate the `run_migrations` function.
3.  Add a new SQL string to the `migrations` vector.
4.  The Rust backend will automatically apply this migration the next time the database is opened.

This approach leverages Rust's performance and reliability for critical database operations.

### Database Schema

The database schema is defined in the migration SQL statements. Key tables include:
- `members`: Core family member data
- `life_events`: Timeline events for members
- `stories`: Biographical stories and narratives
- `gallery`: Photo storage and metadata

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

- **Use Shadcn UI components**: Prefer pre-built components from `src/components/ui/`
- **Tailwind CSS**: Use utility classes for styling
- **Lucide Icons**: Use consistent icon set throughout the app
- **Responsive Design**: Ensure components work on different window sizes

### React Flow Integration

When working with the family tree visualization:
- Use `@xyflow/react` for the flow canvas
- Custom node types are defined in `src/components/flow-panel/CustomNode.tsx`
- Layout calculations are in `src/utils/layoutUtils.ts`
- Never modify node positions manually; always recalculate the full layout

### Internationalization

- All user-facing text must use i18next translations
- Translation keys are in `src/i18n/locales/`
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

### Tauri Commands

Rust commands are exposed to the frontend via Tauri's command system. Located in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn command_name(param: Type) -> Result<ReturnType, String> {
    // Implementation
}
```

### When to Add New Commands

Add new Tauri commands when you need to:
- Access the file system
- Perform native OS operations
- Execute CPU-intensive tasks that should run in native code
- Access system APIs not available in the browser

### Database Operations

Database operations should:
1. Be defined in Rust commands
2. Use parameterized queries to prevent SQL injection
3. Handle errors gracefully and return Result types
4. Update the schema version when modifying the database structure

---

## Testing

The project uses **Vitest** for unit testing.

- **Location**: Tests are co-located with the files they test (e.g., `src/types/member.test.ts`).
- **Running Tests**: Run `npm test` to execute the test suite.
- **Scope**: Focus on testing pure logic, data mapping functions, and utility algorithms (like layout calculations).

### What to Test

1. **Pure Functions**: Utility functions, data transformations, validators
2. **Business Logic**: State management actions, data processing
3. **Layout Algorithms**: Tree layout calculations
4. **Type Guards**: TypeScript type narrowing functions

### What Not to Test

- UI components (no React Testing Library tests currently)
- Tauri commands (Rust backend has its own testing)
- Third-party library integrations

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { functionToTest } from './module';

describe('functionToTest', () => {
  it('should handle expected case', () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
  });
  
  it('should handle edge case', () => {
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
- **Hooks**: camelCase with "use" prefix (e.g., `useFamilyStore.ts`)
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
- Adherence to architectural patterns (store → service → Tauri)
- Proper error handling
- Type safety (no `any` types)
- Test coverage for new logic
- Code style consistency
- Internationalization for user-facing text

### Migration Changes

If your changes require database schema modifications:
1. Add a new migration in `src-tauri/src/lib.rs`
2. Increment the schema version
3. Document the migration in your PR description
4. Test with an existing database to ensure smooth upgrades

---

## Additional Resources

- **[i18n Guide](./I18N_GUIDE.md)**: Translation conventions and patterns
- **Tauri**: [Documentation](https://tauri.app/) | [API Reference](https://tauri.app/v1/api/js/)
- **React Flow**: [Documentation](https://reactflow.dev/)
- **Zustand**: [Documentation](https://zustand-demo.pmnd.rs/)
- **Shadcn UI**: [Component Library](https://ui.shadcn.com/)
- **i18next**: [Documentation](https://www.i18next.com/)

---

**Questions?** Open an issue or discussion on the [GitHub repository](https://github.com/maxi-smidt/family-tree).
