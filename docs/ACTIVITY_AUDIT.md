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
(`GET /trees/{id}/activity`) is gated by the `activity_log` feature flag.
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
| Source / disease CRUD                                              | Logged      | existing source & `MemberDisease` routes                                                                                                      |
| Subtree extract                                                    | Logged      | `app/services/extract.py:548`                                                                                                                 |
| Tree-in-tree link (`POST /members/{id}/link`) — source side        | Logged      | existing `action="update"`, `target_type="member"` on the anchor tree                                                                         |
| Tree-in-tree link — **target-side counterpart**                    | **Added**   | second row now written on `target.id`; `create` for a fresh clone (`mode="create"`), `update` for an existing counterpart (`mode="existing"`) |
| Tree-in-tree unlink (via member `PATCH` clearing `linked_tree_id`) | Logged      | already captured by the ordinary member-update diff; no separate action needed                                                                |
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
| JSON-bundle import                                                 | **Added**   | `_do_import` in `app/api/routes/export_import.py`; one `create`/`import` row on the new tree once the importing user is resolved              |
| GEDCOM import                                                      | **Added**   | `_do_import_gedcom`, same pattern                                                                                                             |
| Tree merge                                                         | **Added**   | `app/services/merge.py::merge_trees`; one row on the newly created tree                                                                       |
| Virtual-view CRUD                                                  | Admin audit | owner-scoped, cross-tree overlay — no single `tree_id`                                                                                        |
| Backup create/delete                                               | Admin audit | instance-wide; no backup restore endpoint currently exists                                                                                    |
| Feature-flag change                                                | Admin audit | instance-wide setting                                                                                                                         |
| App-settings change                                                | Admin audit | instance-wide setting                                                                                                                         |
| Legal-doc version change                                           | Admin audit | legal changes are included in settings snapshots                                                                                              |
| Auth login                                                         | Admin audit | successful local, TOTP, and Authentik logins only; no credentials are stored                                                                  |
| User create/delete                                                 | Admin audit | self-registration and admin account lifecycle actions                                                                                         |
| Role/admin change                                                  | Admin audit | captured as a before/after user update                                                                                                        |
| Password change                                                    | Admin audit | password values are never recorded                                                                                                            |
| Merge/extract **preview** endpoints                                | N/A         | read-only, no mutation                                                                                                                        |

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

**`delete` actions.** **Not reversible today.** The log stores only
`target_label` — a name/title snapshot — not a full pre-image of the row. Two
compounding problems:

1. The deleted row's other columns (dates, notes, custom fields, media
   references, ...) are gone; only the label survives.
2. Cascade-deleted children — relations attached to a deleted member, content
   links (`EventMemberLink`/`StoryMemberLink`/`GalleryMemberLink`), and
   attached media — are unrecoverable. Nothing in the log describes them.

**What genuine per-action undo would need:** enrich delete `details` with a
full serialized pre-image of the row _and_ its cascade children (e.g. for a
member delete: the member row plus its relations, disease records, and
content links, keyed so they can be re-inserted verbatim). This is a
meaningful schema/behavior change — it is **not implemented in this PR**;
delete payloads are left exactly as they were.

**Single-action undo vs. "revert to timestamp."** Even with enriched delete
snapshots, there's a second axis of difficulty: undoing _one_ action (the
most recent delete, say) is a local, self-contained operation once the
pre-image exists. Reverting an entire tree to an earlier point in time is a
different problem — it requires replaying the _inverse_ of every intervening
action in reverse order (undo the last update, then the one before it, ...),
and deletes are the action class that currently carries no reversible
payload at all. Until deletes carry full snapshots, "revert to timestamp" is
not achievable even in principle, regardless of how much other tooling is
built on top of the log.

**Recommendation:** the concrete next step, if rollback is ever pursued, is
enriching delete `details` with full row + cascade-children snapshots. That
work is deliberately out of scope here.

## (c) Admin / non-tree audit — recommendation

The following action classes have **no single `tree_id`** they can be
durably attached to, so they cannot live in the per-tree `ActivityLog`:

- **Tree delete** — the only tree it could be scoped to is the one being
  deleted, and `ActivityLog.tree_id` cascades on tree deletion. A row logged
  here would be deleted in the same transaction as the tree, making the
  "audit" self-erasing and pointless. (Left as a one-line comment at the
  `delete_tree` call site referencing this doc.)
- **Virtual-view CRUD** — a `VirtualView` is owned by a `User`
  (`owner_id`), not a tree; it is a cross-tree overlay that can reference
  members from multiple trees. There is no single tree to scope the log
  entry to.
- **Backup create/delete/restore** — instance-wide operations
  (`/admin/backups`) over the whole database, not one tree.
- **Feature-flag changes, app-settings changes, legal-doc version changes**
  — instance-wide admin settings (`/admin/features`, admin settings routes,
  `/legal`), not tied to any tree.
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
