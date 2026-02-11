# Agent & Development Guidelines

This document outlines the core architectural decisions, development practices, and guidelines for the Family Tree project. It is intended to help developers understand the project's structure and make consistent, informed contributions.

## Table of Contents

1.  [Tech Stack](#tech-stack)
2.  [Core Concepts](#core-concepts)
3.  [State Management (Zustand)](#state-management-zustand)
4.  [Database Migration Framework](#database-migration-framework)

---

## Tech Stack

- **Framework**: React (Vite) + TypeScript
- **Native Runtime**: Tauri (Rust)
- **State Management**: Zustand (`useFamilyStore`)
- **UI Library**: Shadcn UI + Tailwind CSS
- **Graph/Visualization**: @xyflow/react (React Flow)
- **Layout Engine**: Dagre.js (`layoutUtils.ts`)
- **Icons**: Lucide React

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

---

## Database Migration Framework

To ensure smooth schema evolution and prevent data loss, the project uses a version-based migration framework.

### Location

The migration logic is centralized in `src/utils/db-migration.ts`.

### How It Works

1.  **Versioning**: The database schema version is tracked using SQLite's `PRAGMA user_version`. This is a reliable, built-in mechanism for versioning.

2.  **Migration Runner**: The `runMigrations` function is the core of the framework. When the application connects to the database, this function checks the current `user_version` and compares it against the list of available migrations.

3.  **Migrations Array**: A `migrations` array holds a list of migration functions, ordered chronologically. Each function in the array represents a single version update and contains the SQL commands needed to transition from the previous version to the new one.

4.  **Execution**: The runner executes all pending migrations in sequence until the database schema is up-to-date. After each successful migration, it increments the `user_version`.

### Adding a New Migration

To update the database schema:

1.  Open `src/utils/db-migration.ts`.
2.  Add a new `async` function to the end of the `migrations` array.
3.  Write the necessary SQL `ALTER TABLE`, `CREATE TABLE`, or data manipulation queries within this function.
4.  The framework will automatically apply the new migration the next time a user opens a database that is on an older version.

This approach decouples migration logic from the state store, making the codebase cleaner and schema management more maintainable.
