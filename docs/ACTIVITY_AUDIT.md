# Activity / audit log — coverage, rollback, and scope

This document tracks what the per-tree `ActivityLog` (`backend/app/models/
activity.py`) covers, whether an entry could ever be used to reverse the
action it records, and which actions deliberately live _outside_ this log
because they have no single owning tree. It satisfies the acceptance
criteria of issue #564; it does not implement anything beyond the write
paths added in that PR.

`ActivityLog` is **per-tree**: every row has a NOT NULL `tree_id` FK with
`ondelete="CASCADE"`. Writing a row is unconditional (it always happens when
the corresponding action succeeds); only the **read** endpoint
(`GET /trees/{id}/activity`) is available to authorized users.
`record_activity(...)` (`backend/app/services/activity.py`) only calls
`db.add(...)` — callers must invoke it before their own `db.commit()` so the
row is part of the same transaction and rolls back with it on failure.

## (a) Coverage matrix

Legend: **Logged** = already covered before this PR · **Added** = added by
this PR · **Admin audit** = covered by the separate, non-tree-scoped trail
(see §c) · **N/A** = no DB mutation to log (read-only or preview-only endpoint).

| Action                                                             | Status      | Notes                                                                                                                                         |
| ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Member create/update/delete                                        | Logged      | `app/api/routes/members.py`; update stores a before/after diff via `_SKIP_DIFF`-filtered fields                                               |
| Relation create/delete                                             | Logged      | `app/api/routes/members.py` (relation endpoints)                                                                                              |
| Event create/update/delete                                         | Logged      | `app/api/routes/events.py`                                                                                                                    |
| Story create/update/delete                                         | Logged      | `app/api/routes/stories.py`                                                                                                                   |
| Gallery image create/update/delete                                 | Logged      | `app/api/routes/gallery.py`                                                                                                                   |
| Document / disease CRUD                                            | Logged      | `app/api/routes/documents.py` & `MemberDisease` routes                                                                                        |
| Tree create                                                        | **Added**   | `app/api/routes/trees.py::create_tree`                                                                                                        |
| Tree rename                                                        | **Added**   | `update_tree`; only written when the name actually changes                                                                                    |
| Tree delete                                                        | Admin audit | preserved after the tree and its per-tree activity rows are deleted                                                                           |
| Share grant (single)                                               | **Added**   | `share_tree`; one row per newly-granted user, `target_type="share"`                                                                           |
| Share grant (batch)                                                | **Added**   | `share_trees_batch`; one row per tree × newly-granted user                                                                                    |
| Share revoke (single)                                              | **Added**   | `revoke_access`                                                                                                                               |
| Share revoke (batch)                                               | **Added**   | `revoke_access_batch`; one row per tree actually revoked                                                                                      |
| Public-access toggle                                               | **Added**   | `set_public_access`; only written when the flag actually changes                                                                              |
| Member-restriction change                                          | **Added**   | `update_member_restrictions`; before/after restriction list in `details`                                                                      |
| Ownership transfer                                                 | **Added**   | `transfer_ownership`; before/after `owner_id`                                                                                                 |
| Ownership transfer revert                                          | **Added**   | `revert_transfer`; before/after `owner_id`                                                                                                    |
| Content member-link reassignment (`PUT .../links`) — event         | **Added**   | `app/api/routes/events.py::set_links`                                                                                                         |
| Content member-link reassignment — story                           | **Added**   | `app/api/routes/stories.py::set_links`                                                                                                        |
| Content member-link reassignment — gallery image                   | **Added**   | `app/api/routes/gallery.py::set_links`                                                                                                        |
| JSON-bundle import                                                 | **Added**   | `do_import` in `app/services/tree_bundle_import.py`; one `create`/`import` row on the new tree once the importing user is resolved            |
| GEDCOM import                                                      | **Added**   | `do_import_gedcom` in `app/services/tree_gedcom_import.py`, same pattern                                                                      |
| Tree merge                                                         | **Added**   | `app/services/merge.py::merge_trees`; one row on the newly created tree                                                                       |
| Backup create/delete                                               | Admin audit | instance-wide; no backup restore endpoint currently exists                                                                                    |
| App-settings change                                                | Admin audit | instance-wide setting                                                                                                                         |
| Legal-doc version change                                           | Admin audit | legal changes are included in settings snapshots                                                                                              |
| Auth login                                                         | Admin audit | successful local, TOTP, and Authentik logins only; no credentials are stored                                                                  |
| User create/delete                                                 | Admin audit | self-registration and admin account lifecycle actions                                                                                         |
| Role/admin change                                                  | Admin audit | captured as a before/after user update                                                                                                        |
| Password change                                                    | Admin audit | password values are never recorded                                                                                                            |
| Merge **preview** endpoint                                         | N/A         | read-only, no mutation                                                                                                                        |

## (b) Rollback feasibility

**`update` actions.** Reversible field-by-field: the route stores an explicit
`{"before": {...}, "after": {...}}` diff in `details` (see the member-update
handler and the new tree-rename / public-access / restrictions / ownership
entries above). The one intentional gap is `_SKIP_DIFF` in the member-update
handler — `position_x`, `position_y`, `is_collapsed`, and `image_data` are
excluded from the diff (position/collapse are cosmetic layout state churned
on almost every interaction, and `image_data` payloads are large binary blobs
not worth duplicating into the log). An undo of those specific fields is not
possible from the log as it stands today.

**`create` actions.** Reversible by deleting the referenced row: the log
stores the new row's `id` and a human label, which is enough to locate and
delete it (assuming no further edits happened in between and no other rows
came to depend on it).

**`delete` actions.** Split by target type since issue #572:

_Member, relation, and disease deletes are **reversible in the product**_
(issue #762): `POST /trees/{tree_id}/activity/{entry_id}/undo` restores them
from the snapshot below — see "Undo endpoint" further down. Their `details`
carries a versioned pre-image snapshot
(`{"snapshot": {"version": 1, ...}}`, built by `member_delete_snapshot` /
`delete_snapshot` in `backend/app/services/activity.py`). A member-delete
snapshot captures everything the DB cascade removes: the full member row
(every mapped column, collected via SQLAlchemy mapper inspection so schema
evolution is picked up automatically), relations on either side, disease
rows, and all four content link tables (`event_links`, `story_links`,
`gallery_links` including face-tag regions, `document_links`). The member's
profile photo survives because `image_data` is a media URL and member
deletion does not unlink the file. Restoring is conditional on referenced
rows still existing (the other member of a relation, the
event/story/image/document behind a link).

_Event, story, gallery-image, and document deletes are also **reversible in
the product**_ (snapshotted by issue #760, undoable by the same #762 endpoint
as above). `event_delete_snapshot` / `story_delete_snapshot` /
`gallery_delete_snapshot` / `document_delete_snapshot`
(`backend/app/services/activity.py`) follow the same pattern: the full parent
row plus every link table that cascades away with it.

- **Event**: `event` row, `member_links` (`event_member_link`),
  `document_links` (`event_document_link`). Events own no media.
- **Story**: `story` row, `member_links` (`story_member_link`),
  `document_links` (`story_document_link`). Stories own no media.
- **Gallery image**: `gallery_image` row, `member_links`
  (`gallery_member_link`, including face-tag regions), and `trashed_media` —
  the image's media URL, moved into trash rather than deleted (see below).
  `gallery_unknown_faces` rows also cascade away but are deliberately not
  snapshotted — they are derived state a re-tag recreates.
- **Document**: `document` row, `files` (`document_files`, both `"file"` and
  `"link"` kind), `member_links` / `event_links` / `story_links`
  (`document_member_link` / `event_document_link` / `story_document_link`),
  and `trashed_media` — the URLs of every `kind=="file"` attachment, moved
  into trash. The standalone `DELETE /documents/{id}/files/{file_id}`
  endpoint now records its own `delete` row too (`target_type
="document_file"`), built inline from `delete_snapshot(document_file=...,
trashed_media=...)` since it's a single row with no link tables of its own.

**Content provenance (issue #1023).** Every snapshot of a record that carries
an origin scope (event, story, gallery image, document, disease — and the
diseases inside a member snapshot) also stores a `content_scopes` map keyed
`"<content_type>:<content_id>"`, so an undo puts the record back into the
section it came from instead of restoring it workspace-wide. The key is
optional, so pre-#1023 snapshots still restore under `version: 1`; they simply
come back workspace-wide, as does any record whose section has been deleted in
the meantime.

**Media trash/retention (issue #760).** Gallery and document deletes used to
call `delete_media`, unlinking the bytes immediately — a row snapshot alone
couldn't restore those. Both call sites now use `trash_media`
(`backend/app/services/storage.py`) instead: it moves the file (and any
`originals/` sibling from `"both"`-mode gallery uploads) into
`<tree_dir>/.trash/` rather than deleting it, stamping its mtime to the move
time. A per-tree `.trash/` directory can never collide with a real tree id
(tree ids must start with an alphanumeric; `.trash` starts with a dot).
Trashed files are excluded from storage-quota accounting
(`storage_usage.py`), so deleting still frees quota immediately even though
the bytes physically survive. `purge_expired_media_trash` permanently
removes trashed files older than `MEDIA_TRASH_TTL_SECONDS` (30 days, a fixed
constant, not admin/env-configurable) — it runs as part of the existing
background sweep (`backend/app/services/deletion_sweeper.py`), alongside the
pending-user purge. That window is now the user-facing recovery guarantee
for the undo endpoint below: `untrash_media` (`backend/app/services/
storage.py`) moves a file back out of `.trash/` on undo, and a restore
attempted after the sweep already reclaimed it degrades gracefully — the row
comes back, the media link is just dead — rather than failing.

**Known remaining gap.** `document_service.save_document` (the composite
`PUT /documents/{id}` the frontend uses for in-place edits) can also remove
files as part of an atomic multi-change save. That's an `update` action, not
a `delete`, and the issue's scope covers whole-entity deletes plus the
standalone single-file delete endpoint — so file removals via that composite
save path are unchanged: still an immediate `delete_media` with no
per-file snapshot. A future issue could extend snapshotting to that path too.

**Single-action undo vs. "revert to timestamp."** Even with enriched delete
snapshots, there's a second axis of difficulty: undoing _one_ action (the
most recent delete, say) is a local, self-contained operation once the
pre-image exists — issue #762 implements exactly that, for `delete` entries
only. Reverting an entire tree to an earlier point in time is a different
problem — it requires replaying the _inverse_ of every intervening action in
reverse order (undo the last update, then the one before it, ...) — and
remains **out of scope**. Undo of `create` entries (delete the referenced
row) and `update` entries (re-apply the stored `before` diff) are also not
implemented by #762; the latter is additionally blocked by the `_SKIP_DIFF`
fields never being captured in the first place.

**Undo endpoint (issue #762).** `POST /trees/{tree_id}/activity/{entry_id}/undo`
(`backend/app/api/routes/activity.py`, `Depends(get_writable_tree)`) restores a
single `delete` entry from its snapshot. It dispatches on
`details.snapshot.version` (currently only `1` is understood; an unknown
version or a missing snapshot is a 422, never a crash) to a per-type restore
function in `backend/app/services/activity_undo.py` — `restore_member`,
`restore_relation`, `restore_disease`, `restore_event`, `restore_story`,
`restore_gallery_image`, `restore_document`, `restore_document_file` — each
mirroring its matching `*_delete_snapshot` builder key-for-key.

Restoring is **partial and safe**: the main row plus every child reference
that still validates (the other endpoint of a relation, the parent of a link
row) comes back; anything that doesn't validate is skipped and reported rather than failing
the whole undo (`{"restored": {...}, "skipped": [{"table", "reason"}, ...]}`).
A double-undo, or an undo racing a concurrent insert of the same id, surfaces
as a structured 409, never a 500. The undo itself writes a new `create`
activity entry (`details.undo_of` pointing at the entry it reverses), so the
log stays append-only — an undo is a new action, not an erasure. It is
available to authorized editors; the activity log itself is available to
authorized readers.

## (c) Admin / non-tree audit — recommendation

The following action classes have **no single `tree_id`** they can be
durably attached to, so they cannot live in the per-tree `ActivityLog`:

- **Tree delete** — the only tree it could be scoped to is the one being
  deleted, and `ActivityLog.tree_id` cascades on tree deletion. A row logged
  here would be deleted in the same transaction as the tree, making the
  "audit" self-erasing and pointless. (Left as a one-line comment at the
  `delete_tree` call site referencing this doc.)
- **Backup create/delete/restore** — instance-wide operations
  (`/admin/backups`) over the whole database, not one tree.
- **App-settings changes, legal-doc version changes** — instance-wide admin
  settings (admin settings routes, `/legal`), not tied to any tree.
- **Account/auth actions** — login, user create/delete, role/admin change,
  password change. These precede or are orthogonal to tree membership
  entirely.

**Rationale:** forcing these into the per-tree log would mean either (a)
picking an arbitrary tree to attach the row to, which misrepresents what the
action affected and breaks the "every row belongs to the tree it changed"
invariant the rest of this log relies on, or (b) allowing `tree_id` to be
nullable, which would complicate every existing per-tree query and the
`ondelete="CASCADE"` FK semantics for comparatively rare admin actions.

**Implementation:** `AdminAuditLog` is the separate trail. It has no `tree_id`
foreign key, snapshots both actor ID and username, captures generic subjects and
JSON before/after details, and is exposed only via the read-only
`GET /admin/audit-log` endpoint and the Administration → Audit trail tab.

### Retention

Audit rows are retained indefinitely by the application. Administrators should
apply their organisation's data-retention policy through database lifecycle and
backup controls; this application deliberately provides no UI or API to alter
or delete audit entries, preserving their evidentiary value.
