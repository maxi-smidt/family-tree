# Frontend transport boundary

Components read domain-store state and invoke domain-store actions. HTTP transport
lives in services, called from stores or focused hooks:

```
Component → store/hook action → service → API
```

`ApiError` imports and type-only service imports are permitted in components because
they do not perform transport. Test mocks are also excluded from the check.

## Audited exceptions

The following component transport calls are temporarily allowlisted by
`npm run check-transport-boundary`. They must be migrated to the indicated
domain as those domains are completed:

- Account and 2FA flows: `useAuthStore` (#697).
- Tree sharing: `useTreeSharingStore` (#698).
- Admin users, settings, relation types, audit, and legal history:
  focused admin hooks/stores (#699).
- Member linking/search and tree-management dialogs: member/tree domain stores
  (#700, #702).

Do not add a new allowlist entry merely for convenience. Migrate the call to the
appropriate store/hook, or document why the operation cannot fit the boundary.
