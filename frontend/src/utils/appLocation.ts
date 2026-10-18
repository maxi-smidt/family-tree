import { MEDIA_VIEW, TREE_VIEW, type ViewId } from "@/lib/tabs";
import {
  MEMBER_SHEET_TABS,
  type MemberSheetTab,
} from "@/utils/memberSheetState";

/**
 * Where the user is in the app, as encoded in the URL (#1128):
 *
 *   /w/<workspaceId>/<page>?view=<savedViewId> | ?section=<sectionId>
 *                          &focus=<memberId>&member=<memberId>&tab=<sheetTab>
 *
 * The stores stay the source of truth inside a session; `useUrlLocation`
 * mirrors them into the URL and applies the URL back on load and on
 * back/forward. Only ids go into the URL — the server decides what the
 * viewer may actually see. Preferences (list/timeline settings, edit mode,
 * camera position) deliberately stay out.
 */

export type MediaSection = "gallery" | "documents";

export type CanvasScope =
  | { kind: "explore"; focusId: string | null }
  | { kind: "section"; id: string }
  | { kind: "saved-view"; id: string };

export interface AppLocation {
  workspaceId: string;
  view: ViewId;
  mediaSection: MediaSection;
  scope: CanvasScope;
  member: { id: string; tab: MemberSheetTab } | null;
}

/** What a URL asks for. Any part may be missing (bare `/`, an old link). */
export interface ParsedLocation {
  workspaceId: string | null;
  view: ViewId | null;
  mediaSection: MediaSection | null;
  scope: CanvasScope;
  member: { id: string; tab: MemberSheetTab } | null;
}

const WORKSPACE_PREFIX = "w";

// Page segment for each view. Gallery and Documents are two sections of the
// one Media view, but get their own segment so either can be linked.
const VIEW_SLUGS: Record<Exclude<ViewId, typeof MEDIA_VIEW>, string> = {
  "tree-view": "tree",
  "list-view": "list",
  "timeline-view": "timeline",
  "map-view": "map",
  "activity-view": "activity",
  "quality-report-view": "quality",
  "statistics-view": "statistics",
  "database-management-view": "manage",
  "friends-view": "friends",
  "identity-links-view": "identity-links",
};
const MEDIA_SLUGS: Record<MediaSection, string> = {
  gallery: "gallery",
  documents: "documents",
};

const VIEW_PARAM = "view";
const SECTION_PARAM = "section";
const FOCUS_PARAM = "focus";
const MEMBER_PARAM = "member";
const TAB_PARAM = "tab";
// Member links from before #1128 were `/?member=…&memberTab=…&memberMode=…`.
const LEGACY_TAB_PARAM = "memberTab";

function param(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)?.trim();
  return value ? value : null;
}

function parsePage(
  slug: string | undefined,
): { view: ViewId; mediaSection: MediaSection | null } | null {
  if (!slug) return null;
  for (const [section, mediaSlug] of Object.entries(MEDIA_SLUGS)) {
    if (mediaSlug === slug) {
      return { view: MEDIA_VIEW, mediaSection: section as MediaSection };
    }
  }
  for (const [view, viewSlug] of Object.entries(VIEW_SLUGS)) {
    if (viewSlug === slug) return { view: view as ViewId, mediaSection: null };
  }
  return null;
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseLocation(
  pathname: string,
  search: string,
): ParsedLocation {
  const segments = pathname.split("/").filter(Boolean);
  const inWorkspace = segments[0] === WORKSPACE_PREFIX && !!segments[1];
  const workspaceId = inWorkspace ? safeDecode(segments[1]) : null;
  const page = inWorkspace ? parsePage(segments[2]) : null;
  const params = new URLSearchParams(search);

  // Canvas scope and the member sheet only exist on the tree. An old
  // `/?member=` link has no page at all and still opens the tree.
  const onTree = page ? page.view === TREE_VIEW : !inWorkspace;
  let scope: CanvasScope = { kind: "explore", focusId: null };
  let member: ParsedLocation["member"] = null;
  if (onTree) {
    const savedViewId = param(params, VIEW_PARAM);
    const sectionId = param(params, SECTION_PARAM);
    scope = savedViewId
      ? { kind: "saved-view", id: savedViewId }
      : sectionId
        ? { kind: "section", id: sectionId }
        : { kind: "explore", focusId: param(params, FOCUS_PARAM) };
    const memberId = param(params, MEMBER_PARAM);
    if (memberId) {
      const tab = params.get(TAB_PARAM) ?? params.get(LEGACY_TAB_PARAM);
      member = {
        id: memberId,
        tab: MEMBER_SHEET_TABS.includes(tab as MemberSheetTab)
          ? (tab as MemberSheetTab)
          : "identity",
      };
    }
  }

  return {
    workspaceId,
    view: page?.view ?? (member ? TREE_VIEW : null),
    mediaSection: page?.mediaSection ?? null,
    scope,
    member,
  };
}

/** Path plus query for `location` — the canonical URL for that state. */
export function formatLocation(location: AppLocation): string {
  const page =
    location.view === MEDIA_VIEW
      ? MEDIA_SLUGS[location.mediaSection]
      : VIEW_SLUGS[location.view];
  const path = `/${WORKSPACE_PREFIX}/${encodeURIComponent(location.workspaceId)}/${page}`;
  if (location.view !== TREE_VIEW) return path;

  const params = new URLSearchParams();
  const { scope, member } = location;
  if (scope.kind === "saved-view") params.set(VIEW_PARAM, scope.id);
  else if (scope.kind === "section") params.set(SECTION_PARAM, scope.id);
  else if (scope.focusId) params.set(FOCUS_PARAM, scope.focusId);
  if (member) {
    params.set(MEMBER_PARAM, member.id);
    if (member.tab !== "identity") params.set(TAB_PARAM, member.tab);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Whether moving from `from` to `to` deserves its own history entry. Only a
 * switch between member-sheet tabs is minor enough to replace the current
 * one; everything else (workspace, page, scope, focus, opening or closing a
 * member) is a step Back should undo.
 */
export function isHistoryStep(from: AppLocation, to: AppLocation): boolean {
  const withoutTab = (location: AppLocation) =>
    formatLocation({
      ...location,
      member: location.member ? { ...location.member, tab: "identity" } : null,
    });
  return withoutTab(from) !== withoutTab(to);
}
