# v1.7.0 Release Readiness Code Review

- **Review date:** 2026-07-10
- **Baseline:** `v1.6.0` at `6e20bebee0e7c192d779e5c18153a6a66c953f3c`
- **Reviewed target:** `e3d82455cbfb3ab143fbe72457dc81c168bd977c`
- **Change window:** 29 commits, 146 files, 9,520 insertions, 4,927 deletions
- **Release verdict:** **NO-GO**

## Executive summary

The current code should not be released as v1.7.0. The review found **25
actionable findings: 4 blockers, 9 high, 8 medium, and 4 low severity**.

The four release blockers are:

1. The v1.7 database migration explicitly deletes all existing Sources,
   Citations, Evidence, and story attachments instead of migrating them.
2. The native `.treedb` format changed incompatibly while its schema version
   remained at v2, so v1.6 exports import “successfully” while silently losing
   the old source/attachment data.
3. JWTs for access, pending 2FA, and public-tree unlock all share the same
   signing key and subject claim; the normal bearer decoder does not check token
   purpose. This allows a 2FA bypass and, with a chosen tree ID, user/admin
   impersonation.
4. Stored media URLs accept traversal components and several backend helpers
   read them without a containment check. An editor can turn a member/gallery
   image URL into a local-file read and retrieve the result through export.

The normal CI-style checks are green, which is useful but misleading here:
none of the current tests exercises a populated v1.6-to-v1.7 migration, imports
a real v1.6 bundle containing Sources, or rejects purpose-specific JWTs when
used as bearer access tokens.

## Scope and method

The review covered:

- the complete `v1.6.0..HEAD` Git diff and its 29 commits;
- migrations and v1.6 upgrade compatibility;
- authentication, authorization, public sharing, media, export/import, backup,
  audit, and deployment configuration;
- frontend stores, async state transitions, autosave, Documents, public view,
  and API boundaries;
- current architecture outside the diff where it directly affects the release;
- CI-equivalent static checks, builds, and test suites;
- targeted mechanical reproductions for the JWT and media-path findings.

Severity means:

| Level   | Meaning                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| Blocker | Data loss, authentication compromise, or similarly unacceptable release risk              |
| High    | Serious security, integrity, or core-workflow failure that should be fixed before release |
| Medium  | Material correctness, reliability, operability, or release-hygiene defect                 |
| Low     | Maintainability, dead code, documentation, or performance debt                            |

## Findings overview

| ID     | Severity | Finding                                                                      | Release action              |
| ------ | -------- | ---------------------------------------------------------------------------- | --------------------------- |
| RR-001 | Blocker  | v1.7 migration irreversibly drops v1.6 user data                             | Must fix                    |
| RR-002 | Blocker  | `.treedb` schema changed without a bundle-version migration                  | Must fix                    |
| RR-003 | Blocker  | JWT purpose confusion enables 2FA bypass and identity impersonation          | Must fix                    |
| RR-004 | Blocker  | Media URL traversal permits backend local-file disclosure                    | Must fix                    |
| RR-005 | High     | “Full” instance backups omit media/data and cannot be restored               | Must fix                    |
| RR-006 | High     | Public-password unlock has no rate limit or bounded input                    | Must fix                    |
| RR-007 | High     | Public member-detail restriction is UI-only                                  | Must resolve policy and fix |
| RR-008 | High     | Tree switching retains stale domain stores and has overlapping-connect races | Must fix                    |
| RR-009 | High     | Member autosave is unordered and spans non-atomic writes                     | Must fix                    |
| RR-010 | High     | Document editing deletes old data before replacement succeeds                | Must fix                    |
| RR-011 | High     | External document links accept unsafe URL schemes                            | Must fix                    |
| RR-012 | High     | Access tokens and export passwords are placed in URLs                        | Must fix                    |
| RR-013 | High     | Known production secrets/passwords pass startup validation                   | Must fix                    |
| RR-014 | Medium   | 500 MB base64/JSON uploads create an avoidable memory-exhaustion path        | Fix or lower the limit      |
| RR-015 | Medium   | Public viewer cannot load protected media or custom relation types           | Fix                         |
| RR-016 | Medium   | Public unlock tokens survive password rotation for up to 12 hours            | Fix                         |
| RR-017 | Medium   | Public-tree links are ignored for already-authenticated users                | Fix                         |
| RR-018 | Medium   | Document activity is missing from UI filters; requests can race              | Fix                         |
| RR-019 | Medium   | Filesystem and database mutations are ordered inconsistently                 | Fix                         |
| RR-020 | Medium   | Migration/release metadata is inconsistent with v1.7.0                       | Fix before tagging          |
| RR-021 | Medium   | New audit trail is incomplete and UI-truncated                               | Fix or explicitly scope     |
| RR-022 | Low      | Components bypass the required store/service data flow                       | Refactor                    |
| RR-023 | Low      | Several modules are oversized and mix unrelated responsibilities             | Refactor incrementally      |
| RR-024 | Low      | Dead code, stale Sources documentation, and unused translations remain       | Clean up                    |
| RR-025 | Low      | Frontend vendor bundle is 1.63 MB after minification                         | Optimize                    |

## Blockers

### RR-001 — v1.7 migration irreversibly drops v1.6 user data

**Evidence**

- [`v1_7_0_documents.py`](../backend/alembic/versions/v1_7_0_documents.py#L89)
  says the old data “is dropped outright” and then drops
  `story_attachments`, `citations`, `source_evidence`, and `sources`.
- Its downgrade recreates only empty tables and explicitly provides no
  restoration
  ([lines 108–109](../backend/alembic/versions/v1_7_0_documents.py#L108)).
- There is no migration test that starts with populated v1.6 tables.

**Impact**

Every upgrading installation with Sources, citations, evidence files, or story
attachments loses those records. Their referenced media files also become
orphaned. A passing Alembic upgrade therefore reports success after destructive
data loss.

**Required remediation**

Replace the drop-only migration with a real data migration before this revision
is released anywhere:

- map each Source to a Document;
- map SourceEvidence to DocumentFile while retaining IDs, filenames, URLs,
  MIME types, sizes, and timestamps;
- map Citations to DocumentMemberLink and preserve `fact_type`, `page`, and
  `detail` in a deliberate, documented representation;
- map each story attachment to a Document/DocumentFile plus
  StoryDocumentLink;
- validate row counts, relationships, and backing file existence before
  dropping old tables;
- add an upgrade test built from a populated v1.6 schema and a downgrade policy
  that is honest about what is recoverable.

Do not ship a workaround that merely adds a changelog warning. This is data that
the application owns and can migrate.

### RR-002 — `.treedb` schema changed without a bundle-version migration

**Evidence**

- v1.6 exports used `BUNDLE_VERSION = 2` and emitted `sources`,
  `source_evidence`, `citations`, and `story_attachments`.
- Current code still declares
  [`BUNDLE_VERSION = 2`](../backend/app/api/routes/export_import.py#L65).
- [`migrate_bundle()`](../backend/app/api/routes/export_import.py#L84) is a
  no-op.
- The current importer reads only the new
  [Documents fields](../backend/app/api/routes/export_import.py#L369), so the
  old v2 keys are ignored.
- Tests construct current-shape bundles; there is no checked-in v1.6 bundle
  fixture containing Sources.

**Impact**

A valid v1.6 backup/export is accepted as the current schema and imports without
its Sources, citations, evidence, or story attachments. This is silent
compatibility failure rather than a clear rejection.

**Required remediation**

Bump the native bundle schema to v3 and implement an explicit v2→v3 migration.
Keep a real v1.6 `.treedb` fixture in tests and assert semantic preservation,
including attachment bytes and all links. Reject unsupported shapes rather than
silently ignoring keys.

### RR-003 — JWT purpose confusion enables 2FA bypass and identity impersonation

**Evidence**

- Normal access tokens, pending-TOTP tokens, and public-tree tokens use the same
  `SECRET_KEY`, algorithm, and `sub` claim
  ([security.py lines 41–50](../backend/app/core/security.py#L41),
  [62–78](../backend/app/core/security.py#L62), and
  [90–106](../backend/app/core/security.py#L90)).
- [`decode_access_token()`](../backend/app/core/security.py#L49) verifies only
  signature/standard time claims; it does not require an access-token purpose,
  audience, or issuer.
- [`get_current_user()`](../backend/app/api/deps.py#L19) trusts that decoder
  and loads `payload.sub` as a User.
- Password login returns a pending TOTP token before the second factor
  ([auth.py lines 114–116](../backend/app/api/routes/auth.py#L114)).
- Tree creation accepts a client-chosen, unconstrained string ID
  ([tree.py lines 27–31](../backend/app/schemas/tree.py#L27),
  [trees.py lines 114–133](../backend/app/api/routes/trees.py#L114)).

**Mechanical reproductions**

1. A TOTP-enabled user logged in with only username/password, then sent the
   returned `totp_session_token` as `Authorization: Bearer ...`.
   `GET /api/auth/me` returned 200 before a TOTP code was supplied.
2. An attacker created a tree whose ID matched a victim user ID, enabled public
   password access, unlocked it, and sent the public-tree token as a bearer
   token. `/api/auth/me` returned the victim; when the victim was an admin,
   `/api/users` also returned 200.

The temporary diagnostic test was removed after execution.

**Impact**

The first path completely bypasses the second factor. The second path can
impersonate any user whose ID is known (user IDs are exposed in several normal
sharing/friend/public-tree flows), including an administrator.

**Required remediation**

- Give every JWT an explicit immutable `typ`/purpose, issuer, and audience.
- Make the access-token decoder require exactly the access purpose.
- Prefer separate signing keys or at least separate audiences for access,
  TOTP-session, public-tree, SSE-ticket, and other token classes.
- Make tree IDs server-generated UUIDs, or strictly validate client IDs and
  remove the cross-namespace assumption.
- Add negative tests proving every non-access token is rejected at
  `get_current_user`, optional auth, SSE, and all admin routes.
- Rotate `SECRET_KEY` for any deployment that has run the affected code,
  invalidating existing tokens after the fix.

### RR-004 — Media URL traversal permits backend local-file disclosure

**Evidence**

- [`process_image_field()`](../backend/app/services/storage.py#L450) and its
  gallery equivalent accept any string beginning with
  `/api/media/<tree_id>/`; they do not reject `..`, separators, or require a
  direct-child filename.
- Member update persists that accepted value
  ([members.py lines 515–522](../backend/app/api/routes/members.py#L515)).
- Export, copy, move, and usage helpers join the stored suffix onto
  `media_root` without resolving and checking containment
  ([storage.py lines 331–425](../backend/app/services/storage.py#L331)).
- The HTTP media-serving route does perform a containment check, but that does
  not protect these internal helpers.

**Mechanical reproduction**

With a tree media directory present, a stored same-prefix URL containing enough
`../` components caused `media_url_to_data_url()` to read a file outside
`media_root` and return its base64 contents. Export makes that content
available to the editor.

**Impact**

An authenticated editor can read files available to the backend container,
potentially including environment-mounted secrets, configuration, database
credentials, or other application data.

**Required remediation**

Create one canonical media-path parser used by every helper. It must:

- reject traversal, slash/backslash, dot-prefixed, absolute, and noncanonical
  filename components;
- resolve the candidate path and require its parent to equal the resolved
  `media_root/tree_id`;
- verify that the URL tree ID matches the authorized tree;
- safely handle `originals/` as an explicit, controlled case.

Add regression tests for every consumer: export, copy, move, delete, disk usage,
member/gallery writes, and media serving. Audit existing database values for
poisoned URLs.

## High-severity findings

### RR-005 — “Full” instance backups omit media/data and cannot be restored

The service claims to capture the full database and all media
([backup_service.py lines 1–6](../backend/app/services/backup_service.py#L1)),
but [`_collect_bundle()`](../backend/app/services/backup_service.py#L70)
serializes database rows containing media URLs only. No media bytes are read.
It also omits persisted models including Friendships, TreeInvitations,
LegalAcceptances, LegalDocumentVersions, QualityIssueDismissals, GeocodeCache,
and BackgroundJobs. The [backup API](../backend/app/api/routes/backups.py#L43)
offers list/create/download/delete, but no restore or restore validation.

This is particularly dangerous for v1.7: the v1.6 backup implementation also
omitted Sources/Citations/Evidence, precisely the data RR-001 deletes. An admin
can see a “success” backup that cannot restore the instance it represents.

Required action:

- either implement a versioned, media-inclusive, end-to-end tested restore
  format;
- or remove/rename the in-app feature so it cannot be mistaken for a full
  disaster-recovery backup and direct admins to the documented PostgreSQL +
  data-directory procedure;
- never mark a backup successful until a manifest, row counts, media hashes,
  and a restore-verification path exist.

### RR-006 — Public-password unlock has no rate limit or bounded input

The normal login endpoint uses a rate limiter
([auth.py lines 87–112](../backend/app/api/routes/auth.py#L87)). The anonymous
public unlock endpoint performs bcrypt for every request but has no limiter,
request/IP key, or retry response
([trees.py lines 526–546](../backend/app/api/routes/trees.py#L526)).
`PublicTreeUnlock.password` and `PublicPasswordUpdate.password` also have no
minimum/maximum length.

This enables online password guessing and a low-bandwidth CPU denial of service.
Very long owner-supplied passwords can also make hashing fail as a 500 rather
than a validation error.

Add an IP+tree limiter (shared across workers via Redis when configured),
uniform errors/timing, bounded UTF-8 byte length, a sensible minimum for newly
set passwords, and tests for 429/recovery behavior.

### RR-007 — Public member-detail restriction is UI-only

The release note says public visitors are blocked from opening full member
detail. The frontend does this by removing callbacks
([useFlowNodes.ts lines 92–105](../frontend/src/hooks/useFlowNodes.ts#L92)).
However, anonymous public access still reaches:

- [`GET /members`](../backend/app/api/routes/members.py#L206), which can return
  the full `MemberOut`; and
- [`GET /members/{member_id}`](../backend/app/api/routes/members.py#L448),
  which always returns full `MemberOut`.

`MemberOut` includes image, exact life dates, biography/additional data,
locations, cemetery, places lived, and linked-tree identifiers
([family.py lines 20–49](../backend/app/schemas/family.py#L20)).

If the detail block is a privacy boundary, it is trivially bypassed with a
direct API call. If full data exposure is intentional, the UI behavior and
documentation currently imply a policy that does not exist.

Define the public-data policy before release and enforce it server-side with a
dedicated public schema/query. Add API tests proving restricted fields never
leave the server.

### RR-008 — Tree switching retains stale stores and has overlapping-connect races

[`clearDataStores()`](../frontend/src/hooks/useTreeStore.ts#L108) knows how to
clear all domain stores, but `connect()` clears only Activity
([lines 381–417](../frontend/src/hooks/useTreeStore.ts#L381)).
`clearDataStores()` runs only on disconnect. Events, Stories, Documents, and
Gallery use an `initialized` flag; their deferred loader will not fetch the
new tree while that flag remains true.

Consequences:

- after switching A→B, secondary tabs can continue showing A’s data under B;
- a stale document/event/story action uses B’s active tree ID with A’s object
  ID, producing errors or misleading state;
- two overlapping `connect(A)` / `connect(B)` calls are not sequenced; the
  unguarded “fresh tree” response at lines 395–407 can make A active again if it
  resolves last.

The existing “fast switching” unit test performs sequential connects and tests
only the member-store stale-write guard; it does not cover overlapping metadata
requests or initialized secondary stores.

Clear every tree-scoped store synchronously at switch start and add a connection
generation/request ID checked before every write, including `selectedTree` and
`isReady`. Add A/B deferred-store and overlapping-connect tests.

### RR-009 — Member autosave is unordered and spans non-atomic writes

Existing-member autosave fires debounced promises without a queue, abort,
revision, or latest-response guard
([EditMode.tsx lines 361–392](../frontend/src/components/shared/member-sheet/EditMode.tsx#L361)).
Unmount calls `flush()` but does not await completion, while the global
unsaved guard is deliberately disabled for existing members
([lines 394–400](../frontend/src/components/shared/member-sheet/EditMode.tsx#L394)).

Each save:

- resolves `activeTreeId()` at execution time;
- PATCHes the member;
- independently deletes/adds each parent relationship;
- refreshes members;
- independently creates/updates/deletes birth and death events
  ([useMemberStore.ts lines 700–769](../frontend/src/hooks/useMemberStore.ts#L700)).

The form sends both parent slots and both dates on every autosave
([EditMode.tsx lines 292–318](../frontend/src/components/shared/member-sheet/EditMode.tsx#L292)).
The event operations are feature/domain gated, but the member PATCH has already
committed before a disabled/restricted Events call fails.

Impact includes last-write inversion, duplicated parent relations, an old
member save being sent to a newly selected tree, lost close/navigation edits,
and “save failed” after partial persistence.

Capture tree ID at editor mount, serialize/coalesce saves, await a final flush
before close/navigation, add request revisions, and move member+parents+vital
events into one backend transaction/API command. Test slow/reordered responses,
tree switching, close/reload, feature-off Events, and relationship changes.

### RR-010 — Document editing deletes old data before replacement succeeds

Frontend file operations intentionally run **delete → rename → add**
([useDocumentStore.ts lines 42–75](../frontend/src/hooks/useDocumentStore.ts#L42)).
Document update separately commits metadata, member links, then every file/link
operation
([lines 139–160](../frontend/src/hooks/useDocumentStore.ts#L139)).

Replacing a file therefore deletes the working original first. A 413, network
failure, server restart, quota failure, or invalid later link leaves the
document partially changed and the old file permanently gone. Retrying can
produce another partial state.

Provide a backend atomic document command. Upload new files first to temporary
names, validate quota and all operations, commit database changes once, then
finalize and garbage-collect old files. At minimum, reverse replacement order
and implement compensating cleanup, idempotency keys, and failure-injection
tests.

### RR-011 — External document links accept unsafe URL schemes

The backend rejects only empty values and exact lowercase `data:` or
`/api/media/` prefixes
([documents.py lines 365–398](../backend/app/api/routes/documents.py#L365)).
It accepts `javascript:`, `file:`, mixed-case `DATA:`, protocol-relative
URLs, and other unwanted schemes. The frontend renders the value directly as
`href` and also passes it to `window.open`
([DocumentFiles.tsx lines 95–106](../frontend/src/components/shared/member-sheet/DocumentFiles.tsx#L95),
[MemberDocuments.tsx lines 52–62](../frontend/src/components/shared/member-sheet/MemberDocuments.tsx#L52)).

Allowlist normalized `https:` and `http:` URLs using a real URL parser on
both server and client. Reject credentials and control characters, decide
explicitly whether relative URLs are allowed, and sanitize existing rows.

### RR-012 — Access tokens and export passwords are placed in URLs

Two secrets use query strings:

- the long-lived access JWT is placed in
  [`/sse/events?token=...`](../frontend/src/services/realtime.ts#L39), and the
  backend accepts it as a query parameter;
- the optional export-encryption password is sent by a GET request as
  [`?password=...`](../frontend/src/services/TreeFileService.ts#L23), matching
  the backend GET parameter
  ([export_import.py lines 115–119](../backend/app/api/routes/export_import.py#L115)).

Query strings commonly appear in reverse-proxy/application logs, observability
systems, support captures, and intermediary metadata. The export GET can also
be cached or replayed contrary to its mutating/secret-bearing semantics.

Use an Authorization-capable fetch stream or a short-lived single-use SSE
ticket. Change encrypted export to POST with the password in a body, return
`Cache-Control: no-store`, and redact query strings at every proxy while old
clients are phased out.

### RR-013 — Known production secrets/passwords pass startup validation

`.env.example` contains known nonempty values for
[`SECRET_KEY`](../.env.example#L22) and
[`FIRST_ADMIN_PASSWORD`](../.env.example#L70). Compose’s `:?` expressions
check only that they are nonempty
([docker-compose.yml lines 21–34](../docker-compose.yml#L21)), so the example
configuration passes Compose validation unchanged. Backend defaults are also
known strings, and the seed warning checks only the exact password `admin`,
not `change-me`
([init_db.py lines 124–134](../backend/app/db/init_db.py#L124)).

A fresh self-hosted production deployment can therefore start with a public
known admin password and known JWT/session signing key.

Fail closed outside an explicit development/test mode when secrets are known
placeholders, short, or equal to defaults. Generate secrets during setup,
require an initial password change, and add a deployment-config test using the
checked-in example.

## Medium-severity findings

### RR-014 — 500 MB base64/JSON uploads create memory-exhaustion risk

The configurable document ceiling is 500 MB. The browser reads the whole file
into a data URL ([attachmentUtils.ts lines 79–85](../frontend/src/utils/attachmentUtils.ts#L79)),
keeps it in React state, and JSON-stringifies it. The backend holds the JSON,
base64 text, and decoded bytes. The proxy ceiling is 700 MB because a 500 MB
file becomes about 667 MiB before JSON/runtime overhead
([nginx.conf lines 5–13](../frontend/nginx.conf#L5)).

One allowed upload can consume multiple gigabytes across browser and backend;
concurrent uploads can terminate a worker. Move documents to streaming
`multipart/form-data` uploads with incremental size/hash validation and
temporary-file cleanup. Until then, lower the maximum substantially.

### RR-015 — Public viewer cannot load protected media or custom relation types

Public API calls can carry `X-Public-Tree-Token`, but
[`useMediaUrl`](../frontend/src/hooks/useMediaUrl.ts#L33) sends only the bearer
token. The media route uses authenticated-only
[`get_readable_tree`](../backend/app/api/routes/media.py#L43), not public-tree
authorization. Anonymous public photos and document images therefore fail.

Similarly, public-tree startup calls `GET /relation-types`, whose router
requires an authenticated user
([relation_types.py lines 22–37](../backend/app/api/routes/relation_types.py#L22)).
The rejected call is hidden by `Promise.allSettled`, leaving custom relation
rendering incomplete.

Either support public authorization consistently for these read surfaces or
intentionally remove media/custom metadata from public responses and UI. Test
both password-free and password-protected public trees with photos and custom
relations.

### RR-016 — Public unlock tokens survive password rotation

The unlock token contains only tree ID, issue time, expiry, and phase and lasts
12 hours ([security.py lines 86–106](../backend/app/core/security.py#L86)).
Authorization checks only that its tree ID matches
([deps.py lines 145–155](../backend/app/api/deps.py#L145)). Changing the public
password does not invalidate previously issued tokens
([trees.py lines 504–523](../backend/app/api/routes/trees.py#L504)).

Include a password/public-access version or revocation epoch in the token and
verify it on every request. Increment it on password change/removal and public
access changes.

### RR-017 — Public-tree links are ignored for already-authenticated users

Auth initialization records `#public=<id>`
([useAuthStore.ts lines 108–122](../frontend/src/hooks/useAuthStore.ts#L108)),
but [App.tsx lines 106–110](../frontend/src/App.tsx#L106) renders
`PublicTreeViewer` only while unauthenticated. A logged-in visitor who opens a
public link is taken to the normal app without selecting or displaying that
tree.

Consume the deep link in both auth states: open the tree normally if readable,
otherwise show the public viewer/password flow.

### RR-018 — Document activity is missing from UI filters; requests can race

Document routes record `target_type="document"`, but ActivityView’s
[`TARGET_KEY`](../frontend/src/components/view/activity-view/ActivityView.tsx#L42)
and [type filter](../frontend/src/components/view/activity-view/ActivityView.tsx#L181)
omit `document`. Rows display a raw internal word and cannot be selected as a
filter.

The paginated store also has no request generation or abort handling
([useActivityStore.ts lines 50–73](../frontend/src/hooks/useActivityStore.ts#L50)).
Changing page/filter quickly allows an older response for the same tree to
overwrite the latest selection.

Add the translated target, target navigation, and filter option; guard every
load with a request ID or AbortController.

### RR-019 — Filesystem and database mutations are ordered inconsistently

Document upload writes the file before the database commit without a generic
cleanup path for commit failure
([documents.py lines 315–356](../backend/app/api/routes/documents.py#L315)).
File and document deletion remove disk bytes before committing the row deletion
([lines 248–269](../backend/app/api/routes/documents.py#L248),
[421–433](../backend/app/api/routes/documents.py#L421)).

A database failure can therefore leave an orphan file after create or a live
database row pointing at a missing file after delete. Use staged files plus
after-commit cleanup/outbox semantics, and add commit-failure tests.

### RR-020 — Migration/release metadata is inconsistent with v1.7.0

The Alembic chain after `v1_7_0_documents` is named
`v1_8_0_public_tree_password` and `v1_9_0_admin_audit_trail`, even though all
changes are being prepared for app v1.7.0. Once deployed, Alembic revision IDs
are effectively immutable and these names consume future release namespaces.

The app metadata is still 1.6.0 in
[`frontend/package.json`](../frontend/package.json#L4) and
[`backend/pyproject.toml`](../backend/pyproject.toml#L3), which is expected
before release preparation but must not remain when tagging. The changelog also
contains duplicate List-view entries
([CHANGELOG.md lines 49–50](../CHANGELOG.md#L49)).

Before any release candidate:

- rename unreleased migration revisions to nonmisleading, collision-resistant
  IDs and update their chain;
- fix the changelog and document the actual migration behavior;
- after all fixes, run `cd frontend && npm run bump:minor`;
- verify frontend package/lock and backend pyproject/lock all say 1.7.0;
- create the `v1.7.0` tag only from that exact release commit.

### RR-021 — New audit trail is incomplete and UI-truncated

The backend supports `limit` and `offset`, but
[`AdminAuditPanel`](../frontend/src/components/admin/AdminAuditPanel.tsx#L13)
always requests the default first 100 records through
[`AdminService.listAuditLog()`](../frontend/src/services/AdminService.ts#L132).
There is no total, pagination, time/user/action filter, or export, so older
security events become invisible in the UI.

Public password set/change/remove is also security relevant but writes neither
the admin audit trail nor a detailed tree activity event
([trees.py lines 504–523](../backend/app/api/routes/trees.py#L504)).

Add cursor/offset pagination with total/filtering and audit all credential,
public-access, backup failure, and privilege-affecting actions. State retention
and tamper-protection expectations in the operations documentation.

## Low-severity architecture and cleanup findings

### RR-022 — Components bypass the required store/service data flow

Repository architecture requires
`Component → Zustand action → service → API`, but production components call
`api`, `TreeService`, or `fetch` directly. Examples include:

- `PublicTreeViewer`, `CanvasSearch`, and `BackupPanel`;
- account/password/2FA dialogs and panels;
- `LinkExistingTreeDialog`, `LinkedTreesGraphDialog`, and
  `MergeTreesDialog`.

This scatters loading/error/cancellation logic and contributed to inconsistent
public-token/media handling. Move these operations behind domain stores/hooks,
or explicitly document narrow exceptions and centralize transport concerns.

### RR-023 — Several modules are oversized and mix responsibilities

Current examples include:

- `frontend/src/components/ui/multi-select.tsx`: 1,271 lines;
- `ShareTreeDialog.tsx`: 1,230 lines;
- `backend/app/api/routes/members.py`: 1,148 lines;
- `backend/app/api/routes/virtual_views.py`: 1,139 lines;
- `backend/app/api/routes/trees.py`: 1,091 lines;
- `AdminView.tsx`: 1,087 lines;
- `useMemberStore.ts`: 1,073 lines;
- new `DocumentDialog.tsx`: 675 lines.

These modules combine transport, authorization/workflows, mapping, UI state,
and rendering. Split by use case/domain and move multi-entity transactions into
backend application services. This is not itself a release blocker, but it
raises regression risk and made several high-severity failures harder to avoid.

### RR-024 — Dead code, stale Sources documentation, and unused translations remain

Confirmed examples:

- `AdminService.downloadBackupUrl()` is defined but unused;
- `syncVitalEvent()` accepts an unused `_oldDate` parameter;
- [`docs/ACTIVITY_AUDIT.md`](ACTIVITY_AUDIT.md#L31) still claims Source CRUD
  routes exist;
- `check-i18n` reports a large mirrored set of unused DE/EN keys, including
  `dialog.share-tree.domains.sources` and obsolete public/admin labels.

Remove dead methods/parameters, update the audit document for Documents, and
delete genuinely obsolete translations after verifying dynamically generated
keys.

### RR-025 — Frontend vendor bundle is 1.63 MB after minification

`npm run build` passes but warns that the vendor chunk is 1,626.46 kB, above
the configured 900 kB warning threshold. Continue route/component
code-splitting, inspect the bundle composition, and separate heavy graph/map/
chart dependencies so public/login routes do not pay the authenticated-app
cost.

## Verification results

| Check                           | Result             | Notes                                                  |
| ------------------------------- | ------------------ | ------------------------------------------------------ |
| Frontend `npm run build`        | Pass               | Vendor chunk warning: 1,626.46 kB                      |
| Frontend `npx vitest run`       | Pass               | 67 files, 511 tests                                    |
| Frontend `npm run check-i18n`   | Pass with warnings | Locale parity passes; large unused-key list            |
| Frontend `npm run check-no-any` | Pass               | No explicit production `any`                           |
| Backend `ruff check`            | Pass               | No lint errors                                         |
| Backend compile/import          | Pass               | `compileall` and `import app.main`                     |
| Backend `pytest -n auto`        | Pass               | 740 tests                                              |
| Alembic heads/history           | Pass structurally  | One head; semantic migration issues remain             |
| `git diff --check`              | Pass               | No whitespace errors                                   |
| Playwright discovery            | Pass               | 72 tests in 9 files listed                             |
| Full Playwright execution       | Not run            | Docker daemon access unavailable in the review sandbox |
| Targeted JWT reproductions      | Vulnerable         | Both exploit assertions returned 200                   |
| Targeted media traversal        | Vulnerable         | Helper read outside `media_root`                       |

### Important coverage gaps

Before approving v1.7.0, add or run:

1. a populated PostgreSQL v1.6 fixture upgraded through Alembic head, with
   before/after row counts and media hashes;
2. a real v1.6 encrypted and unprotected `.treedb` fixture imported into
   v1.7, asserting Sources/Documents and attachments;
3. JWT token-class rejection tests across bearer auth, optional auth, SSE, and
   admin endpoints;
4. public-tree E2E tests with password, photos, custom relations, direct API
   calls, token rotation, and throttling;
5. overlapping tree-switch and secondary-store tests;
6. autosave tests with reordered/failed requests and Events disabled;
7. document replacement tests with failures after each operation;
8. an actual backup→blank-instance→restore drill, if the in-app backup feature
   remains;
9. the full Playwright suite against a v1.6-upgraded release-candidate stack;
10. dependency vulnerability and container-image scanning in the release
    pipeline.

## Required release plan

### Phase 1 — Security and data blockers

- [ ] Replace the destructive Documents migration and test a populated v1.6
      upgrade.
- [ ] Bump bundle schema to v3 and implement/test v2→v3 conversion.
- [ ] Introduce strict token purposes/audiences and rotate deployment secrets.
- [ ] Remove client-chosen arbitrary tree IDs or strictly constrain them.
- [ ] Centralize safe media-path resolution and audit existing stored URLs.

### Phase 2 — High-severity correctness

- [ ] Decide and enforce the server-side public-data policy.
- [ ] Add public-password throttling, validation, and revocation.
- [ ] Fix tree-switch clearing/sequencing.
- [ ] Make member autosave and document replacement transactional/idempotent.
- [ ] Allowlist external-link schemes.
- [ ] Remove access tokens and passwords from URLs.
- [ ] Fail startup on production placeholder credentials.
- [ ] Correct or remove the misleading in-app full-backup claim.

### Phase 3 — Release candidate

- [ ] Resolve the medium findings or explicitly accept each with owner/date.
- [ ] Add the missing migration, compatibility, race, and security tests.
- [ ] Run the complete E2E suite on a v1.6-upgraded PostgreSQL/media snapshot.
- [ ] Repair release notes and migration identifiers.
- [ ] Run `npm run bump:minor` from `frontend/` and verify all four versioned
      artifacts.
- [ ] Re-run every verification command in this report.
- [ ] Tag `v1.7.0` only after the blocker/high-severity retest is green.

## Final recommendation

Do **not** create or publish v1.7.0 from the reviewed commit. Cut a release-fix
branch, address RR-001 through RR-013, and produce a release candidate only
after a real v1.6 data upgrade and import/restore drill. The current green unit
test count is not sufficient evidence for release because the highest-risk
compatibility and token-boundary behaviors are absent from the test suite.
