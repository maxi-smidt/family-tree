# Agent & Development Guidelines

This document outlines the core architectural decisions, development practices, and guidelines for the Family Tree project. It is intended to help developers understand the project's structure and make consistent, informed contributions.

## Table of Contents

1.  [Tech Stack](#tech-stack)
2.  [Core Concepts](#core-concepts)
3.  [State Management (Zustand)](#state-management-zustand)
4.  [Database Migration Framework](#database-migration-framework)
5.  [Testing](#testing)

---

## Tech Stack

- **Framework**: React (Vite) + TypeScript
- **Native Runtime**: Tauri (Rust)
- **State Management**: Zustand (`useFamilyStore`)
- **UI Library**: Shadcn UI + Tailwind CSS
- **Graph/Visualization**: @xyflow/react (React Flow)
- **Layout Engine**: Dagre.js (`layoutUtils.ts`)
- **Icons**: Lucide React
- **Testing**: Vitest + React Testing Library

---

## Core Concepts

### Data Model (`Member`)

The core entity is the `Member` (defined in `src/types/member.ts`). It includes identification, genealogical links, personal attributes, and layout information.

### Layout Logic

Automatic layout is handled in `src/utils/layoutUtils.ts` using `dagre` for topological sorting. The layout algorithm enforces a "Paternal (Father) on the Left" and "Maternal (Mother) on the Right" convention.

---

## State Management (Zustand)

Global application state is managed by a single Zustand store located at `src/hooks/useFamilyStore.ts`. This store is the single source of truth for all family data, gallery images, and database metadata.

- **Actions**: All interactions with the database (reads and writes) are handled through actions within the store.
- **Data Flow**: Components should call actions from the store to modify state and then rely on the reactive state updates to re-render.
- **Database Service**: The store delegates direct database operations to `src/services/DatabaseService.ts`, which encapsulates all SQL queries (defined in `src/db/queries.ts`).

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

---

## Testing

The project uses **Vitest** for unit testing.

- **Location**: Tests are co-located with the files they test (e.g., `src/types/member.test.ts`).
- **Running Tests**: Run `npm test` to execute the test suite.
- **Scope**: Focus on testing pure logic, data mapping functions, and utility algorithms (like layout calculations).
