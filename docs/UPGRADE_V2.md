# Upgrading to v2.0.0

The v2.0.0 cutover is a **one-time, in-place data conversion**, not just a
schema migration: it consolidates every user's separate trees into shared
workspaces with sections. This is the pre-upgrade planning runbook — what to
check and do *before* and *during* the upgrade window. For what the backend
does automatically on startup, how to read a stuck/failed run, and the
restore commands, see ["Upgrading from v1.x to
v2.0.0"](OPERATIONS.md#upgrading-from-v1x-to-v200) in the Operations Guide;
this document doesn't repeat that material.

> This is a maintainer/operator document, not a feature-flagged code path —
> there is nothing to configure. It exists because the automated safety net
> in `app.services.migration.orchestrator` (preflight checks, an automatic
> backup, checkpointed resume) reduces the risk of this cutover but does not
> remove the parts only an operator can do: stopping old writers, taking your
> own off-host copy, and reviewing the result.

## 1. Compatibility

- **Source release**: any v1.x release upgrades directly. A database stamped
  with a revision older than the migration chain recognizes (pre-squash) is
  detected and re-based onto the `v1_0_0_baseline` revision automatically
  (see `app.db.init_db._stored_revision_is_unknown`) — you do not need to
  step through intermediate v1.x releases first.
- **PostgreSQL**: this release's own dev/CI/e2e stacks run PostgreSQL 18 (see
  [`docker-compose.dev.yml`](../docker-compose.dev.yml)) — that is the only
  version this upgrade is verified against. If your instance runs an older
  PostgreSQL that already serves your v1.x data, upgrade Postgres itself
  first (following its own major-version upgrade procedure) and confirm the
  backend can connect before starting the v2 upgrade.
- **Rollback is not "downgrade"**: `alembic downgrade` is not a supported
  path once `alembic upgrade head` has renamed `trees` to `workspaces`, and a
  v1.x application image cannot run against a partially- or fully-converted
  v2 schema either. The only supported way back is restoring a backup taken
  *before* you started (see [§6](#6-if-something-goes-wrong)).

## 2. Stop and prove every v1 writer

The conversion runs once, under an exclusive advisory lock, the first time a
v2.0.0 backend starts against a v1-shaped database — but that lock only
fences *other v2 backend processes* against each other (see
`MIGRATION_LOCK_KEY` in `app.services.migration.orchestrator`). It does
**not** know about an old v1.x process still pointed at the same database: a
rolling deploy that leaves a v1.x replica running while a v2.0.0 replica
starts converting is unsupported and can corrupt data (the v1 code has no
idea `trees` was just renamed to `workspaces` mid-write).

Before starting the v2.0.0 image:

1. **Scale every v1.x backend replica to zero** (`docker compose stop
   backend`, or your orchestrator's equivalent) — don't rely on a rolling
   update to hand off traffic.
2. **Confirm no v1 process still holds a connection.** On the Postgres side:
   ```sql
   SELECT pid, usename, application_name, state, query
   FROM pg_stat_activity
   WHERE datname = current_database();
   ```
   Only your own inspection query (and idle background connections you
   recognize) should remain. Kill anything unexpected
   (`SELECT pg_terminate_backend(pid)`) rather than starting the upgrade
   with a live v1 writer.
3. **Drain background work**, not just request traffic: an in-flight GEDCOM
   import, bundle import, or scheduled backup job (v1.x) should be allowed
   to finish or be cancelled — there is no v1-side "pause" switch, so this is
   a wall-clock wait, not an API call.
4. Only once all of the above are quiescent, start the v2.0.0 stack.

## 3. Pin the exact image

A floating tag (`latest`, or even a version tag if a registry entry is ever
force-pushed) can silently change under you mid-rollout. Before the upgrade,
resolve `APP_IMAGE_TAG` to its immutable digest and pin that instead:

```bash
docker pull ghcr.io/maxi-smidt/family-tree-backend:X.Y.Z
docker pull ghcr.io/maxi-smidt/family-tree-frontend:X.Y.Z
docker inspect --format '{{index .RepoDigests 0}}' \
  ghcr.io/maxi-smidt/family-tree-backend:X.Y.Z \
  ghcr.io/maxi-smidt/family-tree-frontend:X.Y.Z
```

Set `APP_IMAGE_TAG` (or edit the compose file directly) to reference the
`...@sha256:...` digest rather than the tag for the duration of the upgrade
rehearsal and rollout. This guarantees every replica in the fleet runs the
exact same, already-tested binary — no surprise re-pull mid-migration.

## 4. Take your own off-host copy

The automated `pre_migration` backup (see
[OPERATIONS.md](OPERATIONS.md#upgrading-from-v1x-to-v200)) protects against
the *conversion* failing — it does not protect against the host itself being
lost, and it lives on the same volumes as everything else. Before upgrading:

1. Take a database dump + `${DATA_PATH}` archive using the procedure in
   [Backup & restore](OPERATIONS.md#backup--restore).
2. Copy both **off the host** (object storage, another machine, your backup
   system) — not just to another directory on the same disk.

This is your only way back to actual v1.x; see [§6](#6-if-something-goes-wrong).

## 5. Disk and key checks

The automated preflight (`app.services.migration.preflight`) already
verifies free disk space (media + database size, plus a safety margin) and
that `SECRET_KEY` isn't a known-weak placeholder before it lets the backup or
conversion start — a failure here aborts before anything is written. Before
relying on that check under time pressure, confirm it yourself:

- `${DATA_PATH}` and `${APP_DATA_PATH}` have headroom for roughly one extra
  full copy of your current media + database size (the pre-migration backup
  duplicates both).
- `SECRET_KEY` in `.env` is the same unique value your v1.x instance already
  uses — changing it at upgrade time makes any *existing* encrypted backup
  unreadable, independent of the migration itself.

## 6. Monitor the migration

Ordinary API routes (and `/api/health/ready`) stay unavailable for the
duration of the conversion; two things stay reachable throughout so you don't
have to tail logs blind (#1020):

- **`GET /api/health/migration`** — unauthenticated, safe to poll. Returns
  `status` (`preflight` → `backup` → `migrating` → `validating` →
  `complete`, or `failed`), the run id, a phase heartbeat, a sanitized
  `failure_code`, and `phase_index`/`phase_count` progress counters. Never
  includes workspace/member ids or filesystem paths.
- **The frontend itself** — nginx now starts regardless of backend
  readiness and serves a maintenance screen that polls the endpoint above
  (see `frontend/src/components/auth/MaintenanceScreen.tsx`); a user opening
  the app mid-migration sees progress instead of a connection error, and is
  never signed out.

Structured progress also lands in `docker compose logs backend` (and
`${APP_DATA_PATH}/backend/logs/backend.log`) as `migration_phase` /
`migration_status` / `migration_checkpoint` lines from
`app.services.migration.state_machine`, each with the run id and elapsed
time — useful for confirming the run isn't stalled versus genuinely slow.

## 7. Validate, review, and finalize

Once `GET /api/health/migration` (or the admin API) reports `complete`,
ordinary routes reopen. Two more steps before you can consider the upgrade
done:

1. **Per-owner review**: every user with converted data gets a migration
   report (`GET /api/migration/reports`, or in-app) summarizing workspace
   consolidation, grant changes, and any dropped/converted virtual views.
   Ask affected users to review theirs, and resolve any pending conflict
   surfaced at `GET /api/migration/conflicts` (a duplicate-member bridge
   merge or a virtual-view match needing a human choice).
2. **Finalize**: `POST /api/admin/migration/runs/{run_id}/finalize` (admin
   only) records operator sign-off and unlocks legacy-artifact pruning. It
   refuses while any conflict marked `blocks_finalization` is still pending
   — resolve those first.

Finalizing does not delete the `pre_migration` backup or any report/conflict
row; those remain for audit regardless.

## 8. If something goes wrong

- **`recoverable`**: just restart the stack — the backend resumes from its
  last completed phase automatically. See the failure/recovery table in
  [OPERATIONS.md](OPERATIONS.md#upgrading-from-v1x-to-v200) for what each
  `failure_code` typically means.
- **`failed`** (unrecoverable): restore the automatic `pre_migration` backup
  into a **blank** database/media target running this **same v2.0.0 image**
  — full commands are in
  [OPERATIONS.md](OPERATIONS.md#upgrading-from-v1x-to-v200) — then
  investigate before retrying.
- **Going back to actual v1.x**: restore your own off-host snapshot from
  [§4](#4-take-your-own-off-host-copy) into a blank instance running the
  v1.x image (or, if it's an in-app `.ftbackup`, straight into a blank
  v2.0.0+ instance — no v1.x image required).

**Once any v2 write has been accepted** (a user signs in, edits data, or
otherwise touches the converted instance), restoring the pre-migration
backup rolls the instance back to that pre-migration point and **discards
every write made after it** — there is no merge. Treat "restore" here as an
all-or-nothing point-in-time rollback, not an undo of the migration alone.
