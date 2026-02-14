# Internationalization (i18n) Guide

This document outlines the internationalization conventions and patterns used in the Family Tree application.

## Overview

The application uses [react-i18next](https://react.i18next.com/) for internationalization support. Translation files are located in `src/i18n/locales/` with one JSON file per language:

- `en.json` - English (default)
- `de.json` - German

## Translation Key Naming Conventions

### Hierarchical Structure

Translation keys follow a hierarchical namespace structure that mirrors the component organization:

```
<feature>.<component>.<element>
```

Examples:

- `sidebar.appearance` - Sidebar feature, appearance setting
- `dialog.create-database.title` - Create database dialog, title element
- `sheet.member-sheet.events.title` - Member sheet, events section, title

### Key Naming Patterns

1. **Component-specific keys**: Use the component's feature area as the prefix

   ```
   sidebar.*
   dialog.*
   gallery-view.*
   list-view.*
   tree-view.*
   timeline-view.*
   ```

2. **Common/Shared keys**: Place in the `common` namespace

   ```
   common.gender.*
   common.relation-types.*
   common.date-unknown
   ```

3. **Form elements**: Use descriptive suffixes

   ```
   *-field        // Form field labels (e.g., firstname-field)
   *-placeholder  // Input placeholders (e.g., search-placeholder)
   *-description  // Help text or descriptions
   ```

4. **Actions**: Use verb forms

   ```
   create, edit, delete, cancel, save, add, update
   ```

5. **Toast messages**: Use descriptive prefixes
   ```
   toast-success-*
   toast-error-*
   toast-warning-*
   ```

## Using Translations in Components

### Basic Usage with keyPrefix

The recommended pattern is to use `keyPrefix` to avoid repeating namespace prefixes:

```tsx
import { useTranslation } from "react-i18next";

export const MyComponent = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.create-database",
  });

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
    </div>
  );
};
```

### Pluralization

For pluralized content, use the `count` parameter with `_one` and `_other` suffixes in the JSON:

**Translation JSON:**

```json
{
  "list-view": {
    "view": {
      "selected-members_one": "member found",
      "selected-members_other": "members found"
    }
  }
}
```

**Component Usage:**

```tsx
const { t } = useTranslation(undefined, { keyPrefix: "list-view.view" });

// Automatically selects the correct plural form
<span>{t("selected-members", { count: memberCount })}</span>;
```

### Interpolation

For dynamic values in translations, use double curly braces `{{variable}}`:

**Translation JSON:**

```json
{
  "sheet": {
    "member-sheet": {
      "show-more": "Show {{count}} more"
    }
  }
}
```

**Component Usage:**

```tsx
{
  t("show-more", { count: remainingCount });
}
```

### Dynamic Key Lookup

For accessing translation keys dynamically based on data values:

```tsx
// Using template literals with i18n.t
const { i18n } = useTranslation();
const genderText = i18n.t(`common.gender.${member.gender}`);

// Using a separate translation function with keyPrefix
const { t: tRelation } = useTranslation(undefined, {
  keyPrefix: "common.relation-types",
});
const relationText = tRelation(relationType.id);
```

### Multiple Translation Namespaces

When a component needs translations from multiple namespaces:

```tsx
const { t } = useTranslation(undefined, { keyPrefix: "dialog.add-relation" });
const { t: tRelation } = useTranslation(undefined, {
  keyPrefix: "common.relation-types",
});

return (
  <>
    <h1>{t("title")}</h1>
    <span>{tRelation("married")}</span>
  </>
);
```

## Validation

### Automated i18n Checks

The project includes a script to validate i18n implementation:

```bash
npm run check-i18n
```

This script checks for:

- **Missing keys**: Translation keys used in code but not defined in translation files
- **Unused keys**: Translation keys defined in JSON files but not used in code (informational)
- **Pluralization support**: Detects pluralization patterns and validates `_one`/`_other` variants
- **Template literal keys**: Recognizes dynamic key patterns like `i18n.t(\`common.gender.\${x}\`)`

### Pre-commit Hook

The i18n check runs automatically via Husky pre-commit hooks to ensure all translations are in place before committing.

## Best Practices

1. **Always use i18n for user-facing text**
   - Never hardcode user-visible strings
   - Use translation keys even for single-word labels

2. **Keep keys descriptive but concise**
   - Good: `dialog.create-database.title`
   - Avoid: `dialog.create-database.title-for-the-create-database-dialog`

3. **Group related keys together**
   - Keep all dialog keys under `dialog.*`
   - Keep all component-specific keys under their feature namespace

4. **Use consistent naming patterns**
   - Follow the established patterns for fields, placeholders, actions, etc.
   - This makes keys predictable and easier to find

5. **Document dynamic key patterns**
   - When using dynamic keys, add comments explaining the pattern
   - Example: `// Dynamically accesses common.gender.m, common.gender.f, common.gender.o`

6. **Maintain parity across languages**
   - Ensure all translation files have the same structure
   - Update all language files when adding new keys

7. **Review unused key warnings**
   - The check-i18n script may report false positives for dynamically accessed keys
   - Review "unused" keys carefully before removing them
   - Keys accessed via template literals or dynamic lookups may appear unused

## Common Patterns

### Dialog Pattern

```tsx
export const MyDialog = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.my-dialog" });

  return (
    <Dialog>
      <DialogTitle>{t("title")}</DialogTitle>
      <DialogDescription>{t("description")}</DialogDescription>
      <Button onClick={handleCancel}>{t("cancel")}</Button>
      <Button onClick={handleConfirm}>{t("confirm")}</Button>
    </Dialog>
  );
};
```

### Form Pattern

```tsx
export const MyForm = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "form.my-form" });

  return (
    <form>
      <Label>{t("name-field")}</Label>
      <Input placeholder={t("name-placeholder")} />

      <Label>{t("date-field")}</Label>
      <DatePicker placeholder={t("date-placeholder")} />

      <Button type="submit">{t("save")}</Button>
    </form>
  );
};
```

### List Pattern with Pluralization

```tsx
export const MyList = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "list.my-list" });

  return (
    <div>
      <span>{t("items-count", { count: items.length })}</span>
      {/* ... */}
    </div>
  );
};
```

## Troubleshooting

### "Missing i18n keys" error

If you see this error during commit or CI:

1. Check the error output for the specific missing keys
2. Add the keys to all translation files (`en.json`, `de.json`, etc.)
3. Ensure the key path matches exactly what's used in the code

### Keys appear "unused" but are actually used

This can happen with dynamic keys. Common cases:

- Template literal keys: `i18n.t(\`common.gender.\${value}\`)`
- Dynamic lookups: `t(dynamicKey)`
- Keys used via data mapping: `types.map(type => t(type.id))`

These are expected and the warnings can be ignored.

### Pluralization not working

Ensure:

1. You're passing a `count` parameter: `t("key", { count: value })`
2. Both `_one` and `_other` variants exist in the JSON
3. The base key (without suffix) is not defined in the JSON

## Contributing

When adding new features:

1. Add translation keys to all language files simultaneously
2. Follow the established naming conventions
3. Run `npm run check-i18n` before committing
4. Document any new dynamic key patterns

For questions or clarifications, refer to existing patterns in the codebase or consult the team.
