# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `vX.Y.Z` Git tags; pushing a tag publishes the matching
Docker images to GHCR (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## [Unreleased]

### Added

- **Custom statistics widgets** — users can now create their own chart widgets in the Statistics view, choosing chart type (bar, pie, line, area), data series, color, title, and axis labels. Custom widgets live alongside built-in widgets and can be reordered, hidden, edited, or deleted.
- **Connection mode kinship display** — when a path is found between two selected members in connection mode, a banner now shows the human-readable relationship (e.g. "Anna is the grandmother of Carl"), gendered by the member's gender setting.
- **Extended connection mode kinship** — connection mode now also recognizes partner (husband/wife/spouse/ex-), in-law (parent-in-law, child-in-law, sibling-in-law), and step relationships (step-parent, step-child, step-sibling) on top of blood relations.
- **Connection mode relative fallback** — connected members who share no precise kinship term (blood, partner, in-law, or step) now appear in the banner as "relative" or "distant relative", so connection mode always explains a found connection.

## [1.2.0] - 2026-06-25

Performance and scalability release focused on very large trees and multi-worker
deployments: a windowed focused view for huge trees, off-the-main-thread layout
and imports, optional Redis-backed statistics caching and cross-worker SSE
fan-out, an explicit/configurable database connection pool, single-leader
background sweepers, and graceful shutdown on `docker stop`.

### Added

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

- **Faster tree & GEDCOM import** — member and relation rows are now written with bulk inserts instead of one ORM object per row, substantially speeding up large imports (200k+ members). Date sort keys are precomputed so layout ordering is unchanged (#433).
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
- **Large imports no longer stall the server** — GEDCOM parsing and
  encrypted-bundle decryption for uploaded import files now run in a worker
  thread instead of on the backend event loop, so importing a large file no
  longer freezes unrelated requests or SSE streams. Malformed or unsupported
  files still return an immediate error as before (#435).
- **Faster tree layout for large trees** — the tree layout's post-processing no
  longer re-scans every member inside a per-member loop; a one-time lookup map
  drops the merged-node re-centering pass from O(n²) to O(n), measurably
  speeding up layout for trees with thousands of members. Computed positions are
  unchanged (#463).
- **Background sweepers elect a single leader under multiple workers** — the
  deletion-purge sweep and the scheduled-backup check now acquire a Postgres
  advisory lock before each run, so a backend running with `WORKERS > 1` no
  longer executes them once per worker (which could create duplicate concurrent
  backups). With a single worker the lock is always free, so behaviour is
  unchanged; no Redis is required (#346).
- **`WORKERS` is now configurable from the compose stack** — the backend
  service accepts a `WORKERS` env var (default 1) wired through
  `docker-compose.yml` / `docker-compose.prod.yml`, and the app logs a startup
  warning when `WORKERS > 1` without `REDIS_URL` (a config that silently drops
  SSE events across workers). Previously multi-worker mode required hand-editing
  the image command.

### Fixed

- **Readiness probe no longer blocks the event loop** — `/api/health/ready`
  was made `async` to add the Redis check, but still ran the blocking
  `SELECT 1` database probe directly on the event loop. A slow or unreachable
  Postgres could therefore stall every in-flight request and SSE stream on the
  worker for the connection timeout — exactly when probes fire most. The
  database check now runs in the threadpool, so the event loop stays free.
- **Backend now shuts down gracefully on `docker stop`** — the container command
  ran uvicorn under a shell without `exec`, so the shell (PID 1) swallowed
  `SIGTERM` and uvicorn never ran its lifespan shutdown (cancelling the
  background sweepers, stopping the Redis SSE listener, closing the Redis
  client) before the kill-timeout `SIGKILL`. The command now `exec`s uvicorn so
  it receives the signal directly and shuts down cleanly.
- **Map view now loads in production** — the Content-Security-Policy served by
  nginx did not allow the OpenStreetMap tile hosts, so the Map view rendered as
  a blank gray area (tiles blocked by `img-src`). `https://*.tile.openstreetmap.org`
  is now permitted in `img-src`. Development was unaffected because the Vite dev
  server sends no CSP (#471).

### Security

- **Login rate-limiter memory is now bounded** — the in-memory sliding-window
  limiter previously kept a per-key entry indefinitely, so a spray of distinct
  usernames/IPs against the login endpoint could grow process memory without
  limit. Fully-expired keys are now swept opportunistically and a hard cap
  evicts least-recently-used keys as a backstop, so memory stays bounded by
  recent activity. Limiting behaviour for legitimate users is unchanged (#346).

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

[1.2.0]: https://github.com/maxi-smidt/family-tree/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/maxi-smidt/family-tree/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/maxi-smidt/family-tree/releases/tag/v1.0.0
