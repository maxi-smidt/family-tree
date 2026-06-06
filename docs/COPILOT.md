# GitHub Copilot Development Guidelines

This document provides specific instructions for GitHub Copilot agents working on the Family Tree project. It complements the [AGENTS.md](./AGENTS.md) development guidelines with Copilot-specific best practices.

> **Note**: Human developers should refer to [AGENTS.md](./AGENTS.md) for comprehensive guidelines.

> **Stack update**: This project is now a **web app** — React (in `frontend/`) +
> FastAPI/PostgreSQL (in `backend/`). The old Tauri/SQLite desktop layer has been
> removed. Treat [AGENTS.md](./AGENTS.md) as the source of truth; some
> Tauri/SQLite-specific examples below are retained only as historical context.

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Project Architecture](#project-architecture)
3. [Code Modification Guidelines](#code-modification-guidelines)
4. [Common Tasks](#common-tasks)
5. [Testing & Verification](#testing--verification)
6. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

---

## Quick Reference

### Critical Paths

- **State Stores**: `frontend/src/hooks/` - per-domain Zustand stores (`useMemberStore`, `useDatabaseStore`, ...)
- **Database Service**: `frontend/src/services/DatabaseService.ts` - HTTP client for the API
- **API Client**: `frontend/src/services/api.ts` - fetch wrapper + auth token
- **Types**: `frontend/src/types/member.ts` - Core data model
- **Layout Logic**: `frontend/src/utils/layoutUtils.ts` - Tree layout calculations
- **Backend**: `backend/app/` - FastAPI routes, models, schemas (migrations in `backend/alembic/`)
- **i18n Guide**: `docs/I18N_GUIDE.md` - Translation key conventions and patterns

### Key Commands

```bash
# Frontend (from ./frontend)
npm run dev            # Start the Vite dev server (proxies /api to the backend)
npm test               # Run test suite
npm run check-i18n     # Verify translations

# Backend (from ./backend)
uv run uvicorn app.main:app --reload --port 8000

# Full stack
docker compose up -d --build
```

### Common Imports

```typescript
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { Member } from "@/types/member";
import { DatabaseService } from "@/services/DatabaseService";
import { useTranslation } from "react-i18next";
```

---

## Project Architecture

### Data Flow Pattern (Always Follow This)

```
UI Component → Store Action → DatabaseService → Tauri Command → SQLite
     ↓              ↓              ↓
   Render ← State Update ← Return Data
```

**Never bypass this flow**. Do not:

- Call DatabaseService directly from components
- Use Tauri commands directly from components
- Modify state outside of store actions

### Store-First Development

All data modifications must go through the Zustand store:

```typescript
// ✅ CORRECT
const addMember = useFamilyStore((state) => state.addMember);
await addMember(newMember);

// ❌ WRONG - Never do this
await DatabaseService.insertMember(newMember);
```

---

## Code Modification Guidelines

### 1. Component Organization

Components are organized by category in `src/components/`:

- **`layout/`** - App-wide layout components
  - MainPanel, Layout, ErrorBoundary, TabWrapper
- **`shared/`** - Reusable components used across features
  - `dialog/` - All dialog components (MemberDetailDialog, PasswordDialog, etc.)
  - `member-sheet/` - Member detail sheet and related components
- **`view/`** - Feature-specific view components
  - `tree-view/` - Family tree visualization (FlowPanel, nodes, edges)
  - `gallery-view/` - Photo gallery view
  - `list-view/` - List/table view of members
  - `timeline-view/` - Timeline view of events
  - `database-management-view/` - Database management
  - `database-merge-view/` - Database merging
- **`sidebar/`** - Sidebar components
  - DatabaseSelector, LanguageSelector, FamilyTreeSidebar
- **`ui/`** - Base UI library components (Shadcn UI)
  - button, dialog, input, select, etc.

**Import examples**:

```typescript
import { MainPanel } from "@/components/layout/MainPanel";
import { MemberDetailDialog } from "@/components/shared/dialog/MemberDetailDialog";
import { FlowPanel } from "@/components/view/tree-view/FlowPanel";
import { Button } from "@/components/ui/button";
```

### 2. Reading the Codebase

Before making changes:

1. **Understand the data flow**: Trace from UI → Store → Service → Tauri
2. **Check existing patterns**: Look for similar functionality already implemented
3. **Review types**: Understand the data structures in `src/types/`
4. **Check translations**: Ensure i18n keys exist for any new text

### 3. Making Changes

#### Adding a New Feature

1. **Define types** (if needed) in `src/types/`
2. **Add SQL queries** (if needed) in `src/db/queries.ts`
3. **Create Tauri command** (if needed) in `src-tauri/src/lib.rs`
4. **Add DatabaseService method** that calls the Tauri command
5. **Create store action** that uses the DatabaseService method
6. **Update UI component** to use the store action
7. **Add translations** for any user-facing text
8. **Write tests** for pure logic

#### Modifying Existing Code

- **Minimal changes**: Change only what's necessary
- **Preserve patterns**: Match existing code style and structure
- **Update tests**: Modify tests if behavior changes
- **Check dependencies**: Ensure changes don't break dependent code

### 4. Database Changes

If you need to modify the database schema:

1. Open `src-tauri/src/lib.rs`
2. Locate the `run_migrations` function
3. Add a new SQL statement to the `migrations` vector
4. The migration runs automatically on next database open
5. Update TypeScript types to match new schema

**Example**:

```rust
// In src-tauri/src/lib.rs, add to migrations vector:
"ALTER TABLE members ADD COLUMN middle_name TEXT",
```

### 5. UI Components

When creating or modifying UI components:

- **Use Shadcn UI**: Prefer existing components from `src/components/ui/`
- **Tailwind classes**: Use utility classes for styling
- **Lucide icons**: Import from `lucide-react`
- **Responsive**: Consider different window sizes
- **Accessibility**: Include proper ARIA labels

**Example Component Structure**:

```typescript
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useTranslation } from "react-i18next";

export function MyComponent() {
  const { t } = useTranslation("namespace");
  const action = useFamilyStore((state) => state.action);

  return (
    <Button onClick={() => action()}>
      <Plus className="w-4 h-4 mr-2" />
      {t("button-label")}
    </Button>
  );
}
```

---

## Common Tasks

### Task: Add a New Field to Member

1. **Update type** in `src/types/member.ts`:

   ```typescript
   export interface Member {
     // ... existing fields
     newField?: string;
   }
   ```

2. **Add migration** in `src-tauri/src/lib.rs`:

   ```rust
   "ALTER TABLE members ADD COLUMN new_field TEXT",
   ```

3. **Update queries** in `src/db/queries.ts` if needed

4. **Update UI components** to display/edit the field

5. **Add translations** for labels

### Task: Add a New Store Action

1. **Define action** in `src/hooks/useFamilyStore.ts`:

   ```typescript
   export interface FamilyStore {
     // ... existing actions
     newAction: (param: Type) => Promise<void>;
   }

   // In the store implementation:
   newAction: async (param) => {
     try {
       const result = await DatabaseService.newMethod(param);
       set({ /* update state */ });
     } catch (error) {
       console.error("Error:", error);
     }
   },
   ```

2. **Add DatabaseService method** in `src/services/DatabaseService.ts`

3. **Add Tauri command** (if needed) in `src-tauri/src/lib.rs`

### Task: Add a Translation

1. **Follow naming conventions** from [i18n Guide](./I18N_GUIDE.md):
   - Use hierarchical structure: `<feature>.<component>.<element>`
   - Example: `dialog.create-database.title` or `sheet.member-sheet.events.title`

2. **Add to all locale files** in `src/i18n/locales/`:

   ```json
   {
     "dialog": {
       "create-database": {
         "title": "Create Database"
       }
     }
   }
   ```

3. **Use in component** with keyPrefix:

   ```typescript
   const { t } = useTranslation(undefined, {
     keyPrefix: "dialog.create-database"
   });
   return <h1>{t("title")}</h1>;
   ```

4. **Verify** with `npm run check-i18n`

For detailed patterns, pluralization, and interpolation, see the [i18n Guide](./I18N_GUIDE.md).

---

## Testing & Verification

### Running Tests

Always run tests after making changes:

```bash
npm test                 # Run all tests
npm test -- --watch     # Watch mode
npm test -- filename    # Run specific file
```

### Manual Verification

For UI changes:

1. Run `npm run tauri dev`
2. Test the feature manually
3. Try edge cases (empty data, long text, etc.)
4. Test with existing database (if applicable)

### What to Test

- **Pure functions**: Data transformations, calculations
- **Store actions**: State management logic (mock database calls)
- **Layout algorithms**: Tree positioning calculations
- **Type guards**: TypeScript narrowing functions

---

## Anti-Patterns to Avoid

### ❌ Don't Do This

1. **Bypassing the store**:

   ```typescript
   // ❌ WRONG
   const result = await DatabaseService.getData();
   ```

2. **Modifying state directly**:

   ```typescript
   // ❌ WRONG
   const members = useFamilyStore((state) => state.members);
   members.push(newMember); // Never mutate store state
   ```

3. **Using `any` type**:

   ```typescript
   // ❌ WRONG
   function process(data: any) {}

   // ✅ CORRECT
   function process(data: Member) {}
   ```

4. **Hard-coded text**:

   ```typescript
   // ❌ WRONG
   <Button>Add Member</Button>

   // ✅ CORRECT
   <Button>{t("add-member")}</Button>
   ```

5. **Ignoring errors**:

   ```typescript
   // ❌ WRONG
   try {
     await action();
   } catch (e) {}

   // ✅ CORRECT
   try {
     await action();
   } catch (error) {
     console.error("Failed to perform action:", error);
     // Handle error appropriately
   }
   ```

### ✅ Best Practices

1. **Always use store actions**:

   ```typescript
   const action = useFamilyStore((state) => state.action);
   await action(params);
   ```

2. **Immutable state updates**:

   ```typescript
   set((state) => ({
     members: [...state.members, newMember],
   }));
   ```

3. **Type-safe code**:

   ```typescript
   function process(data: Member): ProcessedMember {
     // Type-checked transformation
     return { ...data, processed: true };
   }
   ```

4. **Internationalized text**:

   ```typescript
   const { t } = useTranslation("namespace");
   return <div>{t("key")}</div>;
   ```

5. **Error handling**:
   ```typescript
   try {
     await action();
   } catch (error) {
     console.error("Operation failed:", error);
     // Show user-friendly error message
   }
   ```

---

## Debugging Tips

### Common Issues

1. **State not updating**: Ensure you're using store actions, not direct mutations
2. **Translations missing**: Run `npm run check-i18n` to find missing keys
3. **Type errors**: Check that types match between frontend and backend data
4. **Layout issues**: Re-run layout calculation after modifying members

### Useful Tools

- **React DevTools**: Inspect component state and props
- **Redux DevTools**: Works with Zustand for store inspection
- **Console logging**: Add strategic logs in store actions and services
- **TypeScript checking**: `npm run build` runs type checking

---

## Summary Checklist

Before submitting changes, verify:

- [ ] All data modifications use store actions
- [ ] DatabaseService methods are only called from store
- [ ] Types are properly defined (no `any`)
- [ ] Translations added for new user-facing text
- [ ] Tests written for new logic
- [ ] Tests pass (`npm test`)
- [ ] Code follows existing patterns
- [ ] Error handling is in place
- [ ] Changes are minimal and focused
- [ ] Database migrations added if schema changed

---

## Additional Resources

- **[AGENTS.md](./AGENTS.md)**: Comprehensive development guidelines
- **[SETUP.md](./SETUP.md)**: Development environment setup
- **[README.md](../README.md)**: Project overview
- **[i18n Guide](./I18N_GUIDE.md)**: Translation conventions and patterns

---

**Remember**: When in doubt, follow existing patterns in the codebase. Consistency is key to maintainability.

---

## UI Styling Guidelines

### Dialog Form Pattern

All dialog forms follow a consistent pattern for spacing and structure:

```tsx
<Dialog open={isOpen} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
    </DialogHeader>

    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-4 py-4 px-1">
        <div className="space-y-2">
          <Label htmlFor="field">{label}</Label>
          <Input id="field" {...props} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit">
          Confirm
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

**Key Rules:**

- Form: `className="space-y-4"`
- Content: `className="space-y-4 py-4 px-1"` (px-1 prevents focus ring clipping)
- Fields: `className="space-y-2"` (wraps label + input)
- Dialog buttons: `size="sm"`
- Cancel button: `variant="outline"`

### Focus Ring Prevention

Input components have a 3px focus ring. To prevent clipping:

- Add `px-1` (or `p-1` for all sides) padding to containers
- Applies to dialogs, search fields, and form containers

### Theme Colors

Always use semantic theme colors, never hardcoded values:

```tsx
// ✅ CORRECT
<p className="text-destructive">{error}</p>
<div className="bg-card border-border">...</div>

// ❌ WRONG
<p className="text-red-500">{error}</p>
<div className="bg-white border-gray-200">...</div>
```

**Common Theme Colors:**

- `text-foreground` - Primary text
- `text-muted-foreground` - Secondary text
- `text-destructive` - Error text
- `bg-card` - Card backgrounds
- `bg-background` - Page background
- `border-border` - Default borders

### Dark Mode Support

All components automatically support dark mode via CSS variables. The app uses `next-themes` for theme switching:

```tsx
import { useTheme } from "next-themes";

function MyComponent() {
  const { theme, setTheme } = useTheme();
  // theme values: "light" | "dark" | "system"
}
```

**Best Practices:**

- Use theme color classes (see above)
- Test in both light and dark modes
- Avoid hardcoded colors
- Use `bg-card` for cards (not `bg-white`)
- Use `text-foreground` for text (not `text-black`)

### Destructive Button Style

Destructive buttons use a subtle red tone:

```tsx
<Button variant="destructive" size="sm">
  Delete
</Button>
```

Style: 10% red background, red border, red text - maintains accessibility while being less intense.

### Component Spacing

**Vertical Spacing:**

- Field groups: `space-y-4` or `gap-4` (16px)
- Individual fields: `space-y-2` (8px)
- Dialog/sheet content: `py-4 px-1`
- Major sections: `space-y-6` (24px)

**Button Spacing:**

- Dialog buttons: `gap-2` in DialogFooter
- Use `size="sm"` for all dialog buttons

### Search Field Pattern

Search fields with icon:

```tsx
<div className="flex items-center gap-4 p-1">
  <div className="relative w-72">
    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
    <Input
      placeholder={t("search")}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      className="pl-8"
    />
  </div>
</div>
```

Note the `p-1` on the outer container to prevent focus ring clipping.

---
