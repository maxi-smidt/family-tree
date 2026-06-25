# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `vX.Y.Z` Git tags; pushing a tag publishes the matching
Docker images to GHCR (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## [Unreleased]

### Added

- **Optional opt-in error monitoring (Sentry / GlitchTip)** — admins can point
  `SENTRY_DSN` at a Sentry-compatible ingest (self-hosted GlitchTip or
  sentry.io) to enable error reporting. The feature is off by default and
  requires each user to also opt in via a new **Privacy** tab in user settings.
  PII (auth headers, cookies, request bodies, e-mail addresses, media URLs) is
  scrubbed before any event is transmitted. Unsetting `SENTRY_DSN` is a total
  no-op — no data is sent and the Privacy tab is hidden (#442).

- **Focused (windowed) tree view for very large trees** — trees with more than
  2,000 members now open in a focused mode that renders only a bounded
  neighborhood around a root person instead of loading the entire graph, keeping
  large trees (tested up to 200k members) responsive. A new
  `GET /api/trees/{id}/members/neighborhood` endpoint returns a bounded BFS
  subgraph (configurable ancestor/descendant depth, optional partner expansion,
  capped node count) and a new `GET /api/trees/{id}/members/search` endpoint
  powers server-side name search in this mode. On the canvas, depth +/- controls
  expand or shrink the neighborhood, "Focus here" re-roots on the selected
  person, search re-roots on the chosen result, and a banner shows how many of
  the total members are currently in view. Trees of 2,000 members or fewer are
  unaffected (#431).
- **Per-tree canvas viewport** — each tree now remembers its own last camera
  position and zoom (persisted locally) instead of sharing a single global
  viewport across all trees.
- **Optional external Redis support** — the backend now accepts a `REDIS_URL`
  environment variable pointing at an external Redis instance (plain, TLS, or
  password-authenticated). When unset the app behaves exactly as before — no
  Redis is required. When configured, the `/api/health/ready` endpoint reports
  Redis reachability (`redis: ok / unavailable`). This is the shared plumbing
  for the Redis pub/sub multi-worker SSE epic (#464).

### Changed

- **Tree layout runs off the main thread** — arranging the tree (manual
  re-arrange, and the automatic arrange after a GEDCOM import) now computes the
  dagre layout in a Web Worker instead of blocking the UI thread, so large trees
  no longer freeze the tab while laying out. The arrange button shows a spinner
  while a layout is in progress (#432).
- **Redis caching for statistics** — when `REDIS_URL` is configured, the
  `GET /api/trees/{id}/statistics` response is cached in Redis for up to 5
  minutes (`cache:stats:{tree_id}`). Member, relation, and disease writes
  invalidate the cache on a best-effort basis, with the 5-minute TTL as a
  backstop, so statistics are eventually consistent. Without Redis the endpoint
  computes statistics on every request exactly as before — no behaviour change
  (#467).
- **SSE event bus backed by Redis pub/sub for multi-worker deployments** — when
  `REDIS_URL` is configured, real-time SSE events are published to per-user
  Redis channels (`events:{user_id}`) and each worker's background listener
  delivers them to locally-connected clients. This enables running the backend
  with `WORKERS > 1` (set via the `WORKERS` env var on the Docker image) without
  losing events across workers. When `REDIS_URL` is unset the original
  in-process single-worker fan-out is unchanged — no Redis dependency is
  introduced (#466).
- **Explicit, configurable database connection pool** — the SQLAlchemy engine
  now sets `pool_size` (default 20), `max_overflow` (default 10) and
  `pool_recycle` (1800 s) explicitly instead of relying on the small QueuePool
  defaults (5 + 10), so concurrent requests no longer starve for connections
  before the request threadpool saturates. Tunable via the new `DB_POOL_SIZE` /
  `DB_MAX_OVERFLOW` / `DB_POOL_RECYCLE` env vars; keep
  `(DB_POOL_SIZE + DB_MAX_OVERFLOW) × WORKERS` below your Postgres
  `max_connections` (#462).

### Fixed

- **Map view now loads in production** — the Content-Security-Policy served by
  nginx did not allow the OpenStreetMap tile hosts, so the Map view rendered as
  a blank gray area (tiles blocked by `img-src`). `https://*.tile.openstreetmap.org`
  is now permitted in `img-src`. Development was unaffected because the Vite dev
  server sends no CSP (#471).

## [1.1.0] - 2026-06-23

Feature and polish release on top of `1.0.0`: in-place list editing,
admin-configurable relation types, faster large-tree rendering, and friendlier
date entry.

### Added

- **Inline cell editing in the List view** — edit names, gender, birthplace,
  hometown, and dates directly in the desktop table via an opt-in **Quick edit**
  toggle. Accident-proof by design: off by default, Enter or blur commits,
  Escape cancels, unchanged cells never write, and it is disabled for viewers
  and virtual trees. Every edit is reversible with undo.
- **Admin-configurable relation types** — set a custom label and per-type edge
  styling (color, stroke width, dash pattern) for each relation type, rendered
  live on the tree canvas.
- **Release announcement popup** — returning users see a one-time dialog after
  an update; admins can configure its content.

### Changed

- **Typeable dates and friendlier member entry** — the date picker now accepts
  typed input alongside the calendar, parent pickers show birth dates to
  disambiguate people, and the duplicate-name guard was relaxed so namesakes
  without a birth date are allowed.
- **Faster large trees** — heavy graph and layout processing moved off the main
  thread into a web worker, keeping the UI responsive on large trees.
- Birthplace and hometown now load with the member list, so those List-view
  columns populate immediately instead of only after opening a member.

### Fixed

- Deleting a relation or parent edge on the tree canvas now persists instead of
  reappearing after a reload.

## [1.0.0] - 2026-06-22

First stable release of Family Tree — a self-hostable web app for building and
exploring family history through an interactive visual tree.

### Added

- **Tree canvas** — interactive React Flow graph with drag-and-drop, automatic
  dagre layout, sub-tree extraction, and culling of off-screen nodes for large trees.
- **Members** — rich Markdown biographies, academic/honorific titles, deceased
  flag with partial/structured genealogy dates, hereditary disease records, and a
  tabbed edit form with inline photo upload and auto-linking.
- **Media** — gallery with bulk upload queue, per-tree configurable storage mode
  (compressed / original / both), and per-user storage quotas.
- **Genealogy content** — events, stories, and sources with citation & evidence
  records for member facts.
- **Views** — timeline map (Nominatim geocoding with location-type filters),
  composable read-only virtual views, and a List view with columns, filters,
  pagination, and CSV export.
- **Statistics** — customizable dashboard widgets.
- **Real-time collaboration (SSE)** — live propagation of layout changes, concurrent
  content edits, activity feed, ownership/access changes, friend requests and share
  invitations, storage-quota warnings, admin events, and long-running job progress.
- **Sharing & access** — owned + shared (`viewer` / `editor`) model with
  object-level permissions, a friend system, expiring invitation links, timed
  ownership-transfer with undo, and optional public read-only trees.
- **Accounts** — local JWT accounts plus optional Authentik (OIDC) SSO, TOTP
  two-factor authentication, per-user settings, and token-based self-registration.
- **Administration** — dedicated admin view, user management with soft-delete and
  scheduled purge, instance settings, and feature flags (global kill switch +
  per-user beta rollout).
- **Backup & portability** — scheduled backups with a restore UI, GEDCOM and
  high-resolution PNG export, and encrypted per-tree `.treedb` export/import bundles
  tagged with the app version.
- **Onboarding** — guided tour for new users.
- **Accessibility & UX** — keyboard navigation and screen-reader support for the
  canvas and views, localized ARIA labels, empty states, locale-aware date handling,
  and a dark/light theme built on OKLCH design tokens.
- **Internationalization** — English and German locales.
- **Mobile** — read-oriented browsing plus a management mode for import, export,
  sharing, and admin.
- **Quality** — Playwright end-to-end suite and CI wiring.

### Changed

- Migrated database columns from `camelCase` to `snake_case`; the JSON API
  contract is preserved via Pydantic alias generation.
- Squashed the Alembic migration history into a single `v1.0.0` baseline.
- Architecture cleanup: instance-wide relation-type registry, single repo-root
  `.env`, support for an external PostgreSQL, file-based logging, and a tag-based
  release flow.

### Fixed

- Pre-squash databases are auto-stamped onto the baseline on startup, so existing
  deployments upgrade cleanly across the squash.
- Locale-aware date formatting and inputs throughout the app.
- Numerous accessibility and UX polish fixes (ARIA labels, dark-mode tokens,
  error toasts, unsaved-changes guards).

### Security

- TOTP two-factor authentication for local accounts.
- Proactive session invalidation on account-state changes.
- Object-level permission enforcement on shared trees.
- Encrypted tree export bundles.

[1.1.0]: https://github.com/maxi-smidt/family-tree/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/maxi-smidt/family-tree/releases/tag/v1.0.0
