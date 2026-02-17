# Frontend Style Guide

This document defines the consistent styling patterns used throughout the Family Tree application to ensure a cohesive and intuitive user experience.

## Core Principles

1. **Consistency**: Use the same spacing, sizing, and styling patterns across similar components
2. **Clarity**: Visual hierarchy should be clear and intentional
3. **Accessibility**: Follow WCAG guidelines and use semantic HTML
4. **Maintainability**: Style patterns should be reusable and documented

## Component Patterns

### Dialog Forms

All dialog forms should follow this consistent pattern:

```tsx
<Dialog open={isOpen} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>

    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-4 py-4 px-1">
        <div className="space-y-2">
          <Label htmlFor="fieldId">{label}</Label>
          <Input id="fieldId" {...props} />
        </div>
        {/* More fields... */}
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

- Form element has `className="space-y-4"`
- Content container uses `className="space-y-4 py-4 px-1"`
- Each field wraps label + input with `className="space-y-2"`
- Use `Label` component from `ui/label` for field labels
- All dialog buttons use `size="sm"`
- Cancel button uses `variant="outline"`
- Destructive actions use `variant="destructive"`

### Sheet Forms (Member Sheet, Image Sheet)

For side sheets with forms, use the Field component pattern:

```tsx
<Sheet open={isOpen} onOpenChange={onClose}>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>{title}</SheetTitle>
    </SheetHeader>

    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Input {...props} />
      </Field>
      {/* More fields... */}
    </FieldGroup>
  </SheetContent>
</Sheet>
```

**Key Rules:**

- Use `FieldGroup` with `className="gap-4"` for the form container
- Use `Field` + `FieldLabel` components for consistent field structure
- FieldLabel uses uppercase, smaller font: `className="text-[12px] font-semibold text-muted-foreground uppercase"`
- Inputs in sheets can use `className="h-7 text-xs shadow-none"` for more compact layout

### Spacing Patterns

#### Vertical Spacing

- **Field Groups**: `space-y-4` or `gap-4` (4 = 1rem = 16px)
- **Individual Fields**: `space-y-2` (2 = 0.5rem = 8px)
- **Dialog/Sheet Content**: `py-4 px-1` for top/bottom padding and minimal horizontal padding to prevent focus ring clipping
- **Sections**: `space-y-6` for major section breaks

#### Horizontal Spacing

- **Button Groups**: `gap-2` in DialogFooter
- **Inline Elements**: `gap-2` or `gap-3` depending on size
- **Form Inputs**: `px-3` for left/right padding (default from Input component)

### Typography

#### Labels

- **Dialog Labels** (`Label`): `text-sm font-medium` (default from component)
- **Sheet Labels** (`FieldLabel`): `text-[12px] font-semibold text-muted-foreground uppercase`
- **Helper Text**: `text-xs text-muted-foreground`
- **Error Text**: `text-sm text-destructive`

#### Input Text

- **Default Inputs**: `text-base md:text-sm` (default from Input component)
- **Compact Inputs** (sheets): `text-xs`

### Colors

Use semantic color classes from the theme:

- **Text Colors**:
  - Primary text: (default foreground)
  - Secondary text: `text-muted-foreground`
  - Error text: `text-destructive`
- **Border Colors**:
  - Default: `border-input`
  - Focus: `border-ring`
  - Error: `border-destructive`

- **Background Colors**:
  - Default: `bg-background`
  - Muted: `bg-muted`
  - Accent: `bg-accent`

### Input Components

#### Standard Input

```tsx
<Input
  id="fieldId"
  value={value}
  onChange={onChange}
  placeholder="Enter value"
/>
```

- Default height: `h-9` (36px)
- Default padding: `px-3 py-1`

#### Compact Input (for sheets)

```tsx
<Input className="h-7 text-xs shadow-none" value={value} onChange={onChange} />
```

- Reduced height: `h-7` (28px)
- Smaller text: `text-xs`
- No shadow: `shadow-none`

#### Textarea

```tsx
<Textarea
  rows={4}
  value={value}
  onChange={onChange}
  placeholder="Enter description"
/>
```

- Default min-height: `min-h-16`
- Default padding: `px-3 py-2`

### Button Patterns

#### Dialog Buttons

```tsx
<DialogFooter>
  <Button variant="outline" size="sm">
    Cancel
  </Button>
  <Button size="sm">Confirm</Button>
  <Button variant="destructive" size="sm">
    Delete
  </Button>
</DialogFooter>
```

#### Button Variants

- `default`: Primary action (blue)
- `outline`: Secondary action (border only)
- `destructive`: Dangerous action (red)
- `ghost`: Minimal button (no border/background)
- `success`: Success action (green)

#### Button Sizes

- `sm`: `h-8` - Use for dialogs and compact layouts
- `default`: `h-9` - Standard size for main UI
- `lg`: `h-10` - Use for prominent actions

### Form Validation

#### Error Display

```tsx
{
  error && <p className="text-sm text-destructive">{error}</p>;
}
```

#### Input Error State

```tsx
<Input
  aria-invalid={!!error}
  // Input automatically shows red border/ring when aria-invalid
/>
```

## Special Cases

### EditMode (Member Sheet)

The EditMode component uses a more compact layout with custom styling:

- Uses `FieldGroup` with `className="gap-4"`
- Labels use `text-[12px] font-semibold text-muted-foreground uppercase`
- Inputs use `h-7 text-xs shadow-none`

This is intentional for the compact side sheet layout.

### PasswordDialog

Uses a custom layout with:

- Space between fields: `space-y-4 py-4 px-1`
- Inline button for password visibility toggle
- Conditional error messages with `text-destructive`

### AlertDialog Components

AlertDialog uses different components but similar patterns:

```tsx
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>{description}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction variant="destructive">Confirm</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## Don't Modify Shadcn UI Components

Components in `src/components/ui/` are from shadcn/ui and should NOT be modified directly. Instead:

- Apply custom styling where components are used
- Use className prop to override styles
- Create wrapper components if needed for specific patterns

## Accessibility

### ARIA Attributes

- Use `aria-invalid` for input error states
- Use `aria-label` for icon buttons
- Use `htmlFor` to associate labels with inputs

### Keyboard Navigation

- Ensure all interactive elements are keyboard accessible
- Use proper focus management in dialogs and sheets
- Test with keyboard-only navigation

## Migration Checklist

When updating existing components to follow this guide:

- [ ] Replace custom label elements with `Label` or `FieldLabel`
- [ ] Standardize spacing: `space-y-4` for forms, `space-y-2` for fields
- [ ] Add `py-4 px-1` padding to form content containers to prevent focus ring clipping
- [ ] Add `size="sm"` to dialog buttons
- [ ] Replace `text-red-500` with `text-destructive`
- [ ] Ensure consistent DialogFooter structure
- [ ] Update any hardcoded colors to use theme variables
- [ ] Test keyboard navigation and screen reader compatibility

## Examples

See the following components for reference implementations:

- `src/components/view/timeline-view/EventDialog.tsx` - Standard dialog form
- `src/components/shared/member-sheet/StoryDialog.tsx` - Dialog with scrollable content
- `src/components/shared/member-sheet/DiseaseDialog.tsx` - Dialog with select inputs
- `src/components/shared/member-sheet/EditMode.tsx` - Compact sheet form
- `src/components/shared/dialog/CreateDatabaseDialog.tsx` - Simple dialog form
- `src/components/shared/dialog/PasswordDialog.tsx` - Conditional form fields
