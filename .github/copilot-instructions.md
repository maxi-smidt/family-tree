# GitHub Copilot Instructions

This file is automatically detected by GitHub Copilot and other AI coding assistants to provide context about the project.

## Project Overview

Family Tree is a modern, cross-platform desktop application for building and exploring family history through an interactive visual interface. Built with Tauri, React, and TypeScript.

## Key Architecture

- **Frontend**: React + TypeScript + Vite
- **Desktop Framework**: Tauri (Rust)
- **State Management**: Zustand (single store pattern)
- **UI**: Shadcn UI + Tailwind CSS
- **Database**: SQLite (local-first)
- **Visualization**: React Flow (@xyflow/react)

## Data Flow Pattern (CRITICAL - Always Follow)

```
UI Component → Store Action → DatabaseService → Tauri Command → SQLite
     ↓              ↓              ↓
   Render ← State Update ← Return Data
```

**Never bypass this flow:**
- Do NOT call DatabaseService directly from components
- Do NOT use Tauri commands directly from components
- All data modifications MUST go through store actions

## Essential Documentation

Before making changes, consult these files in the `docs/` directory:

1. **[docs/AGENTS.md](../docs/AGENTS.md)** - Complete architecture and development guidelines
   - Architecture overview and data flow
   - Frontend and backend patterns
   - Component structure and conventions
   - Testing guidelines
   - Code style and naming conventions

2. **[docs/COPILOT.md](../docs/COPILOT.md)** - AI agent-specific instructions
   - Quick reference for common tasks
   - Code modification patterns with examples
   - Anti-patterns to avoid
   - Common operations (add field, add store action, add translation)

3. **[docs/SETUP.md](../docs/SETUP.md)** - Development environment setup
   - Prerequisites and installation
   - Development workflow
   - Common issues and troubleshooting

4. **[docs/I18N_GUIDE.md](../docs/I18N_GUIDE.md)** - Internationalization conventions
   - Translation key naming patterns
   - How to add/modify translations
   - Best practices for i18n

## Quick Rules for Code Changes

### State Management
- Use Zustand store (`useFamilyStore`) for all app state
- Never mutate state directly - use store actions
- Components should only read state and call actions

### TypeScript
- Use strict mode (no `any` types)
- Define interfaces for all data structures
- Export return types for functions

### Internationalization
- ALL user-facing text must use i18next translations
- Follow hierarchical key structure: `<feature>.<component>.<element>`
- Use `keyPrefix` for cleaner code
- Run `npm run check-i18n` to validate

### Testing
- Co-locate tests with files: `filename.test.ts`
- Test pure functions, business logic, and calculations
- Run `npm test` before committing

### Component Structure
```typescript
// 1. Imports
import { Component } from "library";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useTranslation } from "react-i18next";

// 2. Types/Interfaces
interface ComponentProps { }

// 3. Component
export function Component({ prop }: ComponentProps) {
  // Hooks first
  const { t } = useTranslation(undefined, { keyPrefix: "feature.component" });
  const action = useFamilyStore((state) => state.action);
  
  // Event handlers
  const handleClick = () => { };
  
  // Render
  return <div>{t("label")}</div>;
}
```

## Common Tasks

### Adding a New Field to Member
1. Update interface in `src/types/member.ts`
2. Add migration in `src-tauri/src/lib.rs`
3. Update queries in `src/db/queries.ts`
4. Update UI components
5. Add translations

### Adding a Store Action
1. Define in `src/hooks/useFamilyStore.ts`
2. Add DatabaseService method
3. Add Tauri command (if needed)
4. Use action in components

### Adding Translations
1. Follow naming conventions from I18N_GUIDE.md
2. Add to all locale files in `src/i18n/locales/`
3. Run `npm run check-i18n` to verify

## What NOT to Do

❌ Never bypass the store to call DatabaseService
❌ Never mutate store state directly
❌ Never use `any` type
❌ Never hardcode user-visible text
❌ Never modify state outside store actions
❌ Never remove tests without understanding their purpose

## Key Files

- `src/hooks/useFamilyStore.ts` - Single source of truth for app state
- `src/services/DatabaseService.ts` - All database operations
- `src/db/queries.ts` - SQL query definitions
- `src/types/member.ts` - Core data model
- `src/utils/layoutUtils.ts` - Tree layout calculations
- `src-tauri/src/lib.rs` - Rust backend and migrations

## Development Commands

```bash
npm run tauri dev      # Start development server
npm test               # Run test suite
npm run check-i18n     # Verify translations
npm run bump:patch     # Bump version
```

## For More Details

See the comprehensive documentation in the `docs/` directory:
- Full architecture patterns in `docs/AGENTS.md`
- AI-specific guidance in `docs/COPILOT.md`
- Setup instructions in `docs/SETUP.md`
- i18n conventions in `docs/I18N_GUIDE.md`
