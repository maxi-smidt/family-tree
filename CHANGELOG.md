# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are cut from `vX.Y.Z` Git tags; pushing a tag publishes the matching
Docker images to GHCR (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## [Unreleased]

### Added

- Data-quality report now flags a child born after a parent's death year. A
  posthumous-birth grace window (~1 year) is allowed for fathers and
  parents of unknown gender, but not for mothers (#768).
- Research tasks: open questions and to-dos with open/done state, linked to
  any number of members (or none, for general tree-wide tasks), managed from
  the member sheet or created directly from the quality report. Tree nodes can
  show a toggleable indicator for members with open tasks, the quality report
  lists all open research items, and task changes appear in the activity log.
  Gated behind the new `research_tasks` feature flag (#725).
- Gallery face tags can now be marked as an "unknown person" (no member),
  which creates exactly one open, tree-level research task to identify them
  later. Resolving the tag to a member closes its task and turns the tag into
  a normal member link; deleting the tag removes its still-open task, while a
  completed task is kept as history. Gated behind the `research_tasks`
  feature flag (#736).

### Fixed

- Long, space-less document and attachment file names in the member sheet now
  truncate with an ellipsis (full name still available on hover) instead of
  pushing the sheet into horizontal scrolling. The member sheet was also
  widened to give the Records tab more room (#772).
- Switching to the Life tab (or any tab) while creating a new member now works;
  the sheet previously stayed stuck on Identity until the member was saved
  (#771).
- The member sheet's Records tab now shows its content immediately when the
  sheet is restored directly onto it (e.g. after a page refresh) in edit mode,
  instead of appearing blank until you switch tabs and back (#767).
- Research-task chips in the quality report now open the linked person's
  record, instead of only switching to the tree canvas (#725).
- Upgrading from the early research-task development build now creates the
  missing task-link table and preserves every existing person association
  (#725).
- Custom statistics widgets now honor the “All linked trees” scope, including
  readable linked trees only and counting bridge persons once (#570).
- The in-app changelog now renders release notes in small, on-demand windows,
  avoiding a full-history Markdown render as releases accumulate (#746).
- The in-app changelog is now generated from this source file while every
  frontend image is built, so published images cannot display a stale committed
  copy (#745).
- The gallery upload progress panel now dismisses itself automatically once
  every image has uploaded successfully, instead of lingering after the uploads
  complete. It stays open when an upload fails so the failure can be reviewed
  and retried (#731).

### Security

- Shared members restricted from research tasks can no longer infer task titles
  from the activity log, including in virtual tree views (#725).

### Changed

- Deleting a person, relation, or disease record now stores a full snapshot of
  the deleted data (including a person's relations, disease records, and
  event/story/gallery/document links) in the tree activity log, laying the
  groundwork for a future undo of accidental deletes (#572).

### Added

- Media now opens Gallery and Documents from one tab menu. Documents have a
  tree-wide archive with search, filtering for unlinked records, pagination,
  direct links to people and linked timeline items, and editor controls. They
  can be saved without linked people, and document-card details are collapsed
  by default while still showing attachment and people counts, and listing
  uploaded attachments and external links in separate expanded sections (#722).
- The tree-view people search now shows current-tree matches first, then
  searches every other tree shared with the user; selecting an outside match
  opens and centers that person in its tree (#724).
- Live collaboration presence: avatar chips in the tree canvas show who else is
  currently viewing the open tree — including yourself and accepted friends
  with profile pictures, and other collaborators with initials/icon fallbacks —
  once another person joins, and highlight anyone editing; a member sheet also
  shows an indicator when someone else has it open in edit mode.
  Backed by heartbeats with TTL expiry, works single-worker (in-process) and
  multi-worker (`REDIS_URL`), and is gated behind a new admin-toggleable
  `presence` feature flag (#723).
- Friends can now see an accepted friend's profile picture in the Friends view;
  images continue to be served through an authenticated friendship-only route
  (#739).
- The Statistics view now has an “On this day” widget for upcoming birthdays,
  death anniversaries, dated events, and stories, with direct links to people
  in the tree (#727).
- Generation lines can now be adjusted per tree from the sidebar with None and
  four snap-aligned spacing presets, while preserving node-center alignment
  (#743).
- Linking a person who is already attached to a gallery image now confirms that
  existing link instead of failing without feedback (#728).
- Gallery images opened from a member's detail view now show linked people and
  their face-tag regions (#728).
- Uploading photos from a member's edit view now opens face tagging for each
  new image, so a face can be marked immediately (#728).
- Users can now set first and last profile names and select an adjustable crop
  when uploading, replacing, or removing a private profile picture. Account
  avatars consistently prefer the picture, then name initials, then a generic
  user icon (#737).
- Gallery photos can now be annotated with manual, normalized face regions
  linked to people in the tree. Face tags remain accurate at every display
  size, and existing whole-image links continue to work unchanged (#728).

### Changed

- Member-selection lists (gallery image links, and the people selectors in the
  document, story, and event dialogs) no longer offer people who are already
  linked. Selected people remain visible and removable, while the dropdown and
  its search results only show candidates that can still be added. The same
  filtering applies to the linked-documents selector (#735).

## [1.7.1] - 2026-07-14

### Fixed

- released changelog

## [1.7.0] - 2026-07-14

### Added

- In-app instance backups now include all durable state and media bytes in a
  versioned, self-verifying encrypted manifest. A guarded command-line restore
  path supports blank-instance recovery (or an explicit replacement) (#663).
- Stories can now carry an optional historical date and appear alongside life
  events on the Timeline, with a consistent shared presentation in member
  sheets and the activity log (#653).
- The activity log now loads in pages with a page-size selector and a "showing X–Y of Z" summary, matching the list view. Actor, action, and type filters are applied server-side so paging and counts stay correct for large histories (#645).
- An instance-wide, admin-visible audit trail for account, administrative,
  backup, virtual-view, and tree-deletion actions.
- The admin audit trail now paginates with a total count and offset navigation,
  adds actor / action / subject-type / time-range filters, and offers a
  filter-aware CSV export, so older security and administrative events stay
  discoverable instead of only the newest entries (#670).
- The activity log now surfaces document changes: creating, updating, or deleting
  a document appears with a translated **document** label and a file icon, and the
  type filter can isolate document activity like any other content type (#668).
- Subtle horizontal ruled lines in the tree view background for vertical orientation — notebook-style, evenly spaced, and toggleable in the canvas controls (enabled by default).
- Fast Mode: add a child directly to both parents from their union node (#595).
- **Documents**: a reusable document bundles one or more files (or external links) with a title, date, notes, and the people it mentions, and appears on every mentioned person's profile. Events and stories can link documents directly — and create them inline — so a scan or record can be attached once and referenced from multiple places (#594).
- Location inputs in the member edit sheet now show a geocoding resolution hint below the field, matching the event dialog (#598).
- **Documents**: document uploads now show a progress indicator while files upload, matching the gallery image upload experience (#596).
- **Documents**: double-click a document to open its file in a new browser tab, with a loading indicator while it opens (#597).
- Selection tool: click a highlighted person to toggle them in or out of the current selection, so individuals can be removed without clearing and re-selecting everything (#620).
- Public trees can now be optionally protected with a password: the owner sets a shared secret in the share dialog, and anonymous visitors must enter it before the tree loads. The password is stored hashed and never exposed (#622).

### Changed

- Gallery images and member photos now upload as streamed multipart requests
  instead of base64 data URLs in JSON. The browser keeps a `File` reference and
  sends the raw bytes, which the backend streams to a temporary file in bounded
  chunks before normalizing — cutting the whole-file memory copies on both ends
  and cleaning up temporary files on cancellation, rejection, quota failure, or
  restart. Image type, size, dimension, decompression-bomb, quota, and
  storage-mode safeguards are unchanged (#692).
- The in-app "What's New" notice is now a simple per-user version check: each
  version opens the notice once, and its changelog link opens Settings directly
  on the changelog view (#705).
- The initial page load is now much lighter: the graph, map, chart and Markdown
  libraries are code-split and fetched only when their view is first opened, so
  the login screen and public trees no longer download them. The shared vendor
  bundle drops from ~1.63 MB to ~0.51 MB (≈490 KB → ≈157 KB gzipped) and the
  initial JavaScript payload is roughly halved. A build-time budget check guards
  against regressions (#673).
- **Documents**: file uploads now use bounded-memory multipart streaming instead
  of base64 JSON. Interrupted, invalid, oversized, or checksum-mismatched
  uploads clean up their temporary files; the configurable document cap is now
  100 MB to keep concurrent upload disk use predictable (#666).
- Renamed the member "Sources" section to **Documents** and reworked it from per-fact source citations into the simpler, reusable document model above; the "Documents & Stories" section is now just **Stories**. The admin `sources` feature flag is unchanged and now governs Documents. During the v1.7 upgrade, existing sources, citations, evidence files, and story attachments are migrated into Documents with their files, metadata, and member/story links preserved (#662).
- Member entry sheet: core fields now autosave for existing members (with a subtle "Saving…/Saved" indicator) instead of requiring an explicit Save button, matching the records that already saved automatically. Creating a new member still uses an explicit "Create member" action. (#618)
- **Documents**: linked documents on events and stories are now collapsed behind a compact paperclip indicator showing the count — click it to reveal the files, instead of always rendering the full list inline (#614).
- Member stories are now collapsed by default across the member sheet and detail views, showing just the title with a chevron to reveal the full text and any linked documents on demand (#636).
- Location display is now a single reusable component with one leading map-pin icon that doubles as the "show on map" link where available. The timeline no longer renders a duplicate map-pin, and every place that shows a location (timeline, member sheet, read-only profile, and the member detail dialog) now looks consistent (#635).
- Member life events now collapse their description by default across the member sheet and detail views: the event's type, date and location stay visible, with a chevron to reveal the full description on demand.

### Fixed

- Reloading a previously open member sheet now restores its member, tab, and
  mode from tree-scoped local state instead of mutable URL parameters. Legacy
  member links are validated and safely fall back when stale or inaccessible
  (#704).
- Sessions now renew automatically before their access token expires. A failed
  renewal has a direct in-app sign-in path, and the warning banner no longer
  obscures the sidebar toggle (#706).
- Gallery searches no longer crash when the result set is shorter than the
  full gallery, and malformed gallery-image responses are safely ignored (#708).
- Empty tab states now use the full panel height and center their content
  vertically (#707).
- The activity log no longer shows stale results when you change page, page size,
  or a filter faster than the server responds: each request now supersedes the
  previous one, so an out-of-order response can't overwrite newer page or filter
  state, and the loading and error indicators always reflect the current request
  (#668).
- **Documents**: saving a document now applies its metadata, people, file
  attachments, external links, removals and renames as a single atomic request
  instead of a sequence of separate ones. Picked files stream to a staging area
  first and are attached only when the save commits, so replacing a file no
  longer removes the original before its replacement is in place: a failed save
  (quota, invalid file, network drop) leaves the previous valid document and its
  files fully intact, with no half-applied edits and no orphaned files on disk.
  Retried saves are idempotent (#665).
- Public tree links now reliably show member photos and custom relationship
  styles, including after entering a public-tree password; signed-in visitors
  also open the linked tree directly when they can read it. Public sharing now
  clearly lists the exposed details, password fields explain their requirements
  before submission, and a missing legacy profile photo no longer hides the
  replacement-photo control (#667).
- Upgrading to the Documents model no longer discards existing genealogical
  data: the database migration now maps the old Sources, Citations, Evidence,
  and story attachments into Documents and their link tables — preserving ids,
  metadata, citation detail, filenames, MIME types, sizes, timestamps, and the
  on-disk file bytes — and validates that every legacy row was carried over
  before dropping the old tables, rolling the whole upgrade back on any mismatch
  so no data is lost. Previously the migration dropped that data outright (#662).
- Importing a `.treedb` backup created before v1.7 no longer silently loses its
  source citations and story attachments. The export bundle version is now `3`,
  and a migration step maps a pre-1.7 bundle's sources/citations/evidence/
  attachments into Documents on import. A test also guards against changing the
  bundle's schema without bumping its version, so this class of silent data loss
  can't recur (#661).
- Editing a member's birth or death date now keeps the vital event's linked
  documents, location, and description instead of silently clearing them
  (#659).
- Member autosave now serializes edits and commits identity, parent, and
  vital-event updates together, preventing late saves and partial persistence
  when Events is unavailable (#664).
- Storage quotas now apply to the combined data and media usage of every tree
  owned by a user, rather than allowing the full quota in each individual tree
  (#654).
- Switching directly between trees now invalidates every content view before it
  is opened, so Activity, Timeline, Stories, Gallery, Documents, Statistics,
  and Data Quality cannot show rows from the previously selected tree (#652).
- Member sheets now keep the selected tab while switching between view and edit modes, and restore the same member, tab, and mode from a shareable URL after refresh (#648).
- Timeline and Activity filters now stay visible while their long lists scroll, without nested scrollbars or obscured entries (#646).
- Tree Management keeps its owned, shared, and virtual-view tables in equal-height panes with independent scrolling (#647).
- Member name search now works in the Events and Stories dialogs and the gallery image sheet, where typing a name previously returned no results (#592).
- Every member search (tree canvas, parent pickers, extract-subtree, and the member selectors above) now shows the born (maiden) name and birth year beneath each result, and matches only on the full and maiden name — birth dates and internal ids no longer affect search (#592).
- Uploads no longer fail with a "file too large" error for files below the admin-configured image/document size limits. The frontend proxy previously capped every request body at 50 MB — well under the configurable maximum and, because uploads are base64-encoded, rejecting documents around 37 MB and up — so raising the limit in settings had no effect (#593).
- **Documents**: extracting a subtree now removes documents left orphaned (no member/event/story links) in the source tree after their links are moved into the new tree, deleting their files and on-disk bytes too — previously an unreferenced copy lingered in the source tree's document list (#605).
- Public tree view: clicking a member's name no longer opens the full member detail dialog in the anonymous read-only view (#621).
- Documents: a failed file upload no longer leaves an orphaned document entry with no file attached — if any attachment fails to upload (for example, rejected by a reverse proxy's body-size limit), the new document is rolled back and a clear error is shown. Also documented the reverse-proxy `client_max_body_size` guidance for self-hosters (#612).
- Documents: downloaded files now keep their original upload name instead of the internal stored hash — `serve_media` sets a `Content-Disposition` header, RFC 5987-encoded for non-ASCII names (#613).
- Tree view: the connector from a couple's union dot to their shared children now uses the relationship's colour for custom relationship types too, not only the built-in married/partner/divorced types. A newly created custom relationship colours the union dot and its child connectors immediately, without a refresh (#617).
- Member edit sheet: the "Places lived" entry containers now use the same corner radius (`rounded-md`) as the surrounding input fields, fixing the mismatched border radius (#619).
- **Documents**: read-only member profiles now show linked documents beneath each event, matching the stories view and the edit mode (#606).
- List view: the desktop table column header and pagination now stay pinned while long member lists scroll inside the tab, with an opaque header over the rows beneath in both light and dark themes (#634).
- Onboarding tutorial no longer starts while the legal acceptance gate (terms & privacy) is still open — it now waits until terms are accepted, so tour highlights no longer point at elements hidden behind the legal dialog (#615).
- Event descriptions now preserve newlines when displayed — the Timeline, member sheet (edit and read-only), and member detail dialog render event descriptions with `whitespace-pre-wrap`, matching how story content is shown. Previously multi-line descriptions collapsed into a single run-on block (#637).

### Security

- Hardened release boundaries by separating JWT purposes, using short-lived SSE tickets, throttling and revoking public-tree unlocks, canonicalizing stored-media paths, redacting anonymous member payloads, allowlisting external document link schemes, keeping export passwords out of URLs, generating tree IDs server-side, and rejecting placeholder production credentials.
- **Upgrade note:** production startup now refuses to boot with a placeholder or shorter-than-32-character `SECRET_KEY`, and (for local-auth deployments) a missing, placeholder, or shorter-than-12-byte `FIRST_ADMIN_PASSWORD`. Deployments still running with weak values must set strong ones before upgrading, or the backend will exit on start. Authentik-only deployments no longer need a local admin password. This check runs only when `ENVIRONMENT=production` (which the provided compose stacks set automatically).
- Credential and public-access changes are now audited consistently: two-factor enable/disable, a tree's public role and public password being set or cleared, and **failed** backups are recorded in the admin audit trail (previously only some of these were). Credentials themselves (passwords, tokens, TOTP secrets) are never written to the trail (#670).

## [1.6.0] - 2026-07-06

### Added

- Selection mode on the tree canvas: box-select or click multiple members, then drag to reposition them together for manual layout — or act on them in bulk (delete, collapse/expand) (#577).
- Changelog ("What's new") is now available as a dedicated tab in user settings.

### Fixed

- Allow drawing a relationship directly from a union node to add a shared child to a couple (#578).
- Make drawing relationships on the tree canvas less fiddly: a larger snap radius so target handles catch from further away, plus a bigger grab area on the source handles and the small union-node dots so connections are easier to start (#576).

## [1.5.0] - 2026-07-05

### Added

- **Tree-in-tree links** — a member can now be linked to another tree that details their own family (e.g. a spouse who married in, whose ancestry is a separate tree). Link an existing tree you can access, or create and link a brand-new one from the member's Relations tab — the new tree is seeded with a copy of that person (the "bridge person"), and the two rows are linked both ways: each side shows a badge on its node, and clicking it navigates into the other tree centered on the same person, with a breadcrumb to jump back. Badges pointing at a tree that is not shared with you appear muted and disabled, with a "not shared with you" hint. Editing the bridge person's personal details on either side keeps the other side in sync (when you may edit that tree too); canvas position and collapse state stay per-tree. When a save could not update the linked copy (no edit access there), the editor is told right away, and the Data Quality report flags bridge persons whose two copies have drifted apart — with one-click resolution to adopt either side's data (requires edit access to both trees, dismissible like other notes). Gated by the admin-managed `tree_links` feature flag — turning the flag off pauses navigation and syncing without blocking ordinary member edits.
- **Linked-trees graph** — a "View Linked Trees" action on each tree (Tree Management, gated by `tree_links`) opens a diagram of every tree reachable from it through tree-in-tree member links, with the current tree highlighted, own/shared role badges, member counts, and bridge-link counts on the connecting edges. Trees you cannot access appear as muted placeholders with no name or count leaked; clicking any accessible tree opens it. Cycles (A links to B which links back to A) are handled gracefully, and very large graphs are capped and flagged as truncated.
- **Share a tree together with its linked trees** — the Share dialog can now grant or revoke access on a tree's linked trees in the same step as the anchor tree, instead of sharing each one by hand. When sharing, an opt-in "Also share N linked trees" section lists the linked trees you own with a per-tree checkbox (all checked by default); trees linked but not owned by you are shown disabled. When revoking a user's access, if they also have access to manageable linked trees you're asked which of those to remove it from too, with an option to remove access from just the current tree. Each tree keeps its own explicit access list — this is a convenience batch operation, not a new inheritance mechanism.
- **Map view life-path lines and time slider** — selecting a single member on the map now draws a dashed line through their geography in chronological order (birthplace → places lived, sorted by date → cemetery), toggleable with a "Show life path" switch (#552). A full-width year slider below the map reruns the map's date filter as-of a chosen year, so events and residences appear as time advances; its play/pause button animates through the years (and rewinds to the start when pressed at the end), and the slider range is derived automatically from every date in the tree (#553). The date filters and time slider now place each location by its own relevant date — birthplaces by birth date and cemeteries by death date (hometowns, having no natural date, are always shown) — and those dates are surfaced in the marker popups.
- **"Show on map" from member locations and timeline events** — a small map-pin button next to a member's birthplace, hometown, cemetery and places-lived entries (in the member sheet's Life tab), and next to a timeline event's location, jumps straight to the Map view centered and zoomed on that place, opening its marker popup (#554).
- **Fix an unresolved map location manually** — the map view's unresolved-locations popover now has a "Fix location" button alongside Retry: pick from live Nominatim search suggestions for an edited query, or drop a pin directly on an embedded map (draggable to fine-tune). The correction is saved globally in the geocode cache and marked so it is never re-geocoded or overwritten, matching the tree-independent, instance-wide nature of the existing geocode cache (#555).
- **In-app "What's new" changelog** — the version number in the sidebar footer is now a button that opens a dialog listing what changed in each release, grouped by version and generated from this changelog file (#563).
- **Combined statistics across linked trees** — the Statistics view can now switch from "This tree" to "All linked trees" (shown once a tree has at least one tree-in-tree link), aggregating the anchor tree with every tree reachable through those links that you can read. Bridge persons — the same human represented by one row per linked tree — are counted once rather than once per tree. Gated by the existing `tree_links` feature flag (#566).
- **Wider activity-log coverage** — the activity log now also records tree creation and renaming, sharing grants/revokes (including batch and restriction changes), ownership transfers, tree-in-tree links, JSON/GEDCOM imports, tree merges, and content member-link changes (#564).

### Changed

- **Map view polish** — marker popups now group birthplace/hometown/cemetery/places-lived/event entries under one heading per type (instead of an interleaved list), scroll when a place has many entries, and every member name in them is a clickable link that jumps straight to that person in the tree view, centered and zoomed on their card (#548). The row of location-type legend chips is replaced by a compact dropdown with one switch per type, previewing the active colors in its trigger. Map tiles dim to match dark mode instead of staying bright white (#549), and are sharper on hi-DPI displays (#556). The map no longer yanks your pan/zoom when changing filters — a "fit to markers" button recenters on demand — the date-range filter now also applies to places-lived entries (not just events), and the filter bar wraps on narrow screens instead of clipping (#551).
- **Map view marker redesign** — each location now renders as a single filled pin instead of a row of hollow rings: one solid disc in the type's color for a single-type location, or a disc with a conic-gradient ring split into one segment per type for a mixed location, with a small count badge when a marker groups more than one entry. Markers now carry an accessible label (location name + entry count) for screen readers. Nearby markers are also clustered as you zoom out, with a badge showing how many markers each cluster contains. The location-type filter uses the same visual language: a single circle that is light gray when nothing is selected and fills with the selected types' colors as pie segments (#550).
- **Unresolved map locations are now actionable** — the map's "could not be resolved" note is replaced with an "N unresolved location(s)" popover listing every location that failed to geocode, where each one is used (which member field or event, with a "show in tree" link back to the member), and a per-location retry button to re-request just that lookup immediately instead of waiting for the next visit (#547).
- **Subtree extraction now moves a branch into a linked tree** — extracting a subtree no longer creates an unlinked copy that silently diverges; the selected branch is _moved_ into a new tree and the selected person stays in both trees as the connecting bridge person (tree-in-tree link). Extraction offers two selections: "direct family" (the person's family of origin: parents, siblings and their branches, with married-in spouses; the person's own children stay) and "partnership" (the person's partner(s), the partner's family, and the shared children). A preview shows members moved, relations severed by the cut, and media size before anything runs. Extraction now requires owning the tree and is gated by the `tree_links` feature flag; linked subtrees survive later deletion of the bridge person in the original tree, and freshly extracted trees are arranged automatically on first open (#535).

### Fixed

- **Linking an existing tree now always creates a bridge person** — picking a tree from the "Linked tree" dropdown previously pointed the member at that tree without a matching row on the other side, leaving the link with nothing to navigate to. It now opens a dialog to resolve a real bridge person: find a matching person already in the target tree, or copy this member into it as a new one — writing to the target tree requires edit access there, and a member without edit access is shown a read-only explanation instead. Linking now also requires the member to be saved first, since establishing a bridge writes a row in the other tree. "Find existing person" now only surfaces people named the same as the member being linked (reusing the tree-merge duplicate-detection), and if the matched person's details differ, a per-field resolver (Use A / Use B / Combine) lets you reconcile them before the link is created instead of leaving the two rows to drift (#565).
- **Unlinking a tree now removes the link from both sides** — clearing a member's "Linked tree" previously only unlinked the side you edited, leaving the counterpart in the other tree still linked (a phantom badge) and its edits still syncing one-directionally back. Unlinking now tears down both sides of the bridge (#565).
- **Deleting a bridge person dissolves the tree-in-tree link** — removing one side of a linked person now turns the surviving copy in the other tree back into an ordinary member (both link fields cleared), instead of leaving it with a broken "linked tree" badge that pointed at a person who no longer exists (#565).
- **Tree merge and subtree extraction keep title, deceased and adopted flags** — copied members previously lost their academic title and their deceased/adopted status.
- **Map view shows "places lived" markers again** — the optimized member list payload had dropped the places-lived field, so the map's "Place lived" layer (and its legend filter) was always empty (#544).
- **Locations that once failed geocoding can now recover** — transient lookup failures (e.g. rate limits or timeouts) are no longer cached as permanently unresolvable; they are retried on the next map visit, and "no results" answers are re-checked after a week (#545).
- **Map view shows a loading indicator while locations are being resolved** — instead of a misleading "No mappable events found" empty state while events load and new locations are geocoded (#546).

## [1.4.0] - 2026-07-01

### Added

- **Dismiss data-quality notes** — each issue in the Data Quality report can now be dismissed so it stops cluttering the view; a "Show dismissed" toggle brings dismissed notes back and lets you restore them. Dismissals are shared by every editor of the tree and persist across reloads.
- **Toggle timeline detail visibility** — the timeline view now has a "Show details" switch to hide event location and description for a more compact overview. The preference is remembered locally.
- **Legal terms acceptance gate** — admins can require users to accept the Terms of Service and Privacy Policy before making changes, managed from a dedicated **Legal documents** tab in administration. New users are blocked by a non-dismissable dialog until they accept. Versioning is automatic: editing and saving any legal document bumps the version under the hood (starting from 0), which forces existing users to re-accept. All three documents are admin-editable; the Privacy Policy and Impressum are publicly viewable without logging in (login page and public tree links), while the Terms are presented in the acceptance gate and the in-app sidebar. Documents are maintained per language (German and English, German authoritative), with an in-dialog language switch; the accepted language is recorded in the audit trail.
- **Immutable legal document version history / consent receipts** — every published Terms, Privacy Policy, and Impressum text is snapshotted immutably the moment it goes live. Acceptance is recorded in an append-only audit log (the single source of truth for the gate) capturing username, timestamp, IP, user-agent, accepted language, and a content hash of the exact Terms and Privacy text agreed to — so a past "accepted" consent can always be tied back to the precise wording. Admins can browse the full version history (with the original text) per document and language in the Legal tab.
- **Cemetery / place of burial field** — members now have a Cemetery field alongside Birthplace and Hometown, editable when a member is marked deceased. It shows up in the member sheet, list view, map view, statistics, GEDCOM import/export (as `BURI`/`PLAC`), source citations, and tree merging.

### Changed

- **Gender-specific fallback icon colors** — members without profile pictures now display a User icon colored by gender (pink for female, blue for male) to improve visual scanning of the tree.

### Fixed

- **Sharing popup horizontal scroll** — the share tree dialog now has a minimum width to prevent layout shift and horizontal scrolling when public sharing is enabled.
- **Sharing popup stays open when toggling public access** — toggling public sharing in the share tree dialog no longer closes the dialog; the confirmation stays nested so users can see and copy the public link immediately.

## [1.3.1] - 2026-06-27

### Changed

- **Public shared trees now show the interactive tree** — opening a tree shared with public read-only access renders the real, pannable/zoomable family tree (nodes and connections) instead of a flat list of member cards. The public view is purely visual: no tabs, sidebar, editing, or member detail pop-ups.

### Fixed

- **Collapsed nodes no longer leave dangling lines** — when a member is collapsed, the relationship lines and union markers connecting to its now-hidden descendants are hidden too, instead of floating disconnected on the canvas.

## [1.3.0] - 2026-06-27

### Added

- **Adopted member flag** — members can now be marked as adopted when adding or editing them via a new "Adopted" toggle in the member form (Life tab).
- **Custom statistics widgets** — users can now build their own chart widgets in the Statistics view with a simple pivot builder: pick a chart type (bar, pie, line, area) and the controls adapt to it — cartesian charts ask for an X-axis dimension to group by (gender, birth/death decade, birth year, age at death, birthplace, hometown, name, living/deceased, academic title) and a Y-axis measure (member count, average lifespan, average age), while pie charts ask what to "slice by" and the slice size. Cartesian charts also support an optional breakdown for multi-series charts, with a stacked/grouped toggle for bar and area charts. Includes color, title, axis labels, and a live preview. Custom widgets live alongside built-in widgets and can be reordered, hidden, edited, duplicated, or deleted.
- **Shareable statistics widgets** — custom widgets can be exported to a JSON file (individually or all at once) and imported back, so widget designs can be backed up or shared between trees and users. Imported files are validated, and any entry referencing an unknown chart type, dimension, or measure is safely skipped.
- **Connection mode kinship display** — when a path is found between two selected members in connection mode, a banner now shows the human-readable relationship (e.g. "Anna is the grandmother of Carl"), gendered by the member's gender setting.
- **Extended connection mode kinship** — connection mode now also recognizes partner (husband/wife/spouse/ex-), in-law (parent-in-law, child-in-law, sibling-in-law), and step relationships (step-parent, step-child, step-sibling) on top of blood relations.
- **Connection mode relative fallback** — connected members who share no precise kinship term (blood, partner, in-law, or step) now appear in the banner as "relative" or "distant relative", so connection mode always explains a found connection.

### Changed

- **Event partial-date picker** — event dates now support imprecise/partial dates (year, month+year, or full date) via the same picker used for member birth/death dates; the timeline sort is also updated to handle partial-date strings correctly (year-only, month+year, and full-date events now sort into the right chronological order).

### Removed

- **Sibling / half-sibling / step-sibling stored connection types** — these horizontal relation types are now derived from the family tree's parent graph (as they always were for display) and can no longer be created as explicit connections. Existing stored rows of these types are deleted by the migration; they remain fully visible as computed relationships.

### Fixed

- **Tree auto layout confirmation** — the Arrange members action now asks for confirmation before moving member cards, preventing accidental layout changes.
- **GEDCOM import preserves the adopted flag** — members imported from a GEDCOM file are now marked as adopted when their child-to-family link uses `PEDI adopted` or carries an `ADOP` event, and export emits this so the flag survives an export/import round-trip.
- **Partial-date validation** — event and member dates with impossible month or day values (e.g. month 13, February 30, or February 29 in a non-leap year) are now rejected instead of accepted as valid.

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

[1.3.0]: https://github.com/maxi-smidt/family-tree/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/maxi-smidt/family-tree/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/maxi-smidt/family-tree/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/maxi-smidt/family-tree/releases/tag/v1.0.0
