import { useEffect } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import { MEDIA_VIEW } from "@/lib/tabs";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useSavedViewStore } from "@/hooks/useSavedViewStore";
import { useSectionStore } from "@/hooks/useSectionStore";
import { useWorkspaceNavStore } from "@/hooks/useWorkspaceNavStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import {
  formatLocation,
  isHistoryStep,
  parseLocation,
  type AppLocation,
  type CanvasScope,
  type ParsedLocation,
} from "@/utils/appLocation";

/** Marks the history entries this app writes, so foreign ones are ignored. */
export interface LocationHistoryState {
  __ftLocation: true;
  // Camera of the tree canvas on this entry, kept current while panning so
  // Back lands where the user left off (see `useCanvasHistory`).
  viewport?: { x: number; y: number; zoom: number };
}

export function isLocationHistoryState(
  value: unknown,
): value is LocationHistoryState {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { __ftLocation?: unknown }).__ftLocation === true
  );
}

interface LocationRestoreState {
  /** True while back/forward is applying a URL to the stores. */
  restoring: boolean;
  /** Bumped each time a restore finishes, so the canvas can re-apply its camera. */
  restoredSeq: number;
}

export const useLocationRestoreStore = create<LocationRestoreState>(() => ({
  restoring: false,
  restoredSeq: 0,
}));

// One-shot: the next URL write replaces the current entry instead of adding
// one. Used for corrections the user didn't ask for — a link to a member who
// isn't reachable, a saved view that no longer exists — so Back doesn't land
// on the broken state again.
let replaceNextWrite = false;
export function requestLocationReplace() {
  replaceNextWrite = true;
}

let applying = false;
let lastWritten: AppLocation | null = null;
// What the page was opened with, applied once its workspace is ready.
let pendingInitial: ParsedLocation | null = null;

/** The location the stores currently show, or null while it is settling. */
export function readStoreLocation(): AppLocation | null {
  const { selectedTree, isReady } = useWorkspaceStore.getState();
  if (!selectedTree || !isReady) return null;
  const { activeView, mediaSection } = useActiveViewStore.getState();
  const members = useMemberStore.getState();
  if (members.focusPending) return null;
  const scope: CanvasScope = members.activeSavedViewId
    ? { kind: "saved-view", id: members.activeSavedViewId }
    : members.focusSectionIds?.length
      ? { kind: "section", id: members.focusSectionIds[0] }
      : {
          kind: "explore",
          focusId: members.windowed ? members.focusRootId : null,
        };
  const sheet = useMemberSheetStore.getState().openSheets[selectedTree.id];
  return {
    workspaceId: selectedTree.id,
    view: activeView,
    mediaSection,
    scope,
    member: sheet ? { id: sheet.memberId, tab: sheet.tab } : null,
  };
}

function writeLocation() {
  if (applying || pendingInitial) return;
  const location = readStoreLocation();
  if (!location) return;
  const url = formatLocation(location);
  const current = `${window.location.pathname}${window.location.search}`;
  const previous = lastWritten;
  lastWritten = location;
  if (url === current) {
    replaceNextWrite = false;
    return;
  }
  const push =
    !replaceNextWrite && previous !== null && isHistoryStep(previous, location);
  replaceNextWrite = false;
  if (push) {
    const state: LocationHistoryState = { __ftLocation: true };
    window.history.pushState(state, "", url);
  } else {
    const state: LocationHistoryState = {
      ...(isLocationHistoryState(window.history.state)
        ? window.history.state
        : {}),
      __ftLocation: true,
    };
    window.history.replaceState(state, "", url);
  }
}

function sameScope(a: CanvasScope, b: CanvasScope) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "explore" && b.kind === "explore")
    return a.focusId === b.focusId;
  return (a as { id: string }).id === (b as { id: string }).id;
}

async function applyScope(scope: CanvasScope) {
  const current = readStoreLocation()?.scope;
  if (current && sameScope(current, scope)) return;
  const nav = useWorkspaceNavStore.getState();
  const members = useMemberStore.getState();
  const unavailable = async () => {
    toast.error(i18n.t("hooks.url-location.view-unavailable"));
    useWorkspaceNavStore.getState().selectExplore();
    await useMemberStore.getState().exitFocus();
  };

  if (scope.kind === "saved-view") {
    nav.selectSavedView(scope.id);
    try {
      await useSavedViewStore.getState().openSavedView(scope.id);
    } catch {
      await unavailable();
    }
    return;
  }

  if (scope.kind === "section") {
    // The neighborhood endpoint silently ignores sections the viewer can't
    // see, so check the id against the viewer's own section list first.
    const sections = useSectionStore.getState();
    if (!sections.initialized) await sections.refreshSections();
    const exists = useSectionStore
      .getState()
      .sections.some((section) => section.id === scope.id);
    if (!exists) {
      await unavailable();
      return;
    }
    nav.selectSection(scope.id);
    await members.focusSection(scope.id);
    return;
  }

  nav.selectExplore();
  if (scope.focusId) {
    await members.setFocusRoot(scope.focusId);
    // An id outside the viewer's reach comes back as a 404, which leaves the
    // canvas as it was; fall back to the whole family instead.
    const focused = useMemberStore
      .getState()
      .members.some((member) => member.id === scope.focusId);
    if (!focused) await unavailable();
    return;
  }
  if (
    members.activeSavedViewId ||
    members.focusSectionIds?.length ||
    members.windowed
  ) {
    await members.exitFocus();
  }
}

/** Bring the stores in line with `location` (the workspace already matches). */
async function applyLocation(location: ParsedLocation) {
  const workspaceId = useWorkspaceStore.getState().selectedTree?.id;
  if (!workspaceId) return;
  const activeView = useActiveViewStore.getState();
  if (location.view) activeView.setActiveView(location.view);
  if (location.view === MEDIA_VIEW && location.mediaSection) {
    activeView.setMediaSection(location.mediaSection);
  }
  await applyScope(location.scope);

  const sheets = useMemberSheetStore.getState();
  const open = sheets.openSheets[workspaceId];
  if (location.member) {
    // The canvas opens the sheet once the member is loaded, or drops it
    // (with a toast) when the viewer can't reach that member.
    sheets.setOpenSheet(workspaceId, {
      memberId: location.member.id,
      tab: location.member.tab,
      mode: open?.memberId === location.member.id ? open.mode : "view",
    });
  } else if (open) {
    sheets.clearOpenSheet(workspaceId);
  }
}

async function restoreFromUrl() {
  const location = parseLocation(
    window.location.pathname,
    window.location.search,
  );
  if (!location.workspaceId) return;
  applying = true;
  useLocationRestoreStore.setState({ restoring: true });
  try {
    const workspaces = useWorkspaceStore.getState();
    if (workspaces.selectedTree?.id !== location.workspaceId) {
      try {
        await openWorkspace(location.workspaceId);
      } catch {
        toast.error(i18n.t("hooks.url-location.workspace-unavailable"));
        requestLocationReplace();
        return;
      }
    }
    await applyLocation(location);
  } finally {
    applying = false;
    useLocationRestoreStore.setState((s) => ({
      restoring: false,
      restoredSeq: s.restoredSeq + 1,
    }));
    // Normalise the entry (e.g. drop ids that turned out unreachable)
    // without adding a new one.
    requestLocationReplace();
    writeLocation();
  }
}

/**
 * Open a workspace by id: from the viewer's own list when it is there,
 * otherwise resolved directly (a public workspace, or one shared since the
 * list was loaded). Rejects when the viewer has no access.
 */
export async function openWorkspace(workspaceId: string) {
  const { workspaces, selectTree, openTreeById } = useWorkspaceStore.getState();
  const known = workspaces.find((workspace) => workspace.id === workspaceId);
  if (known) await selectTree(known);
  else await openTreeById(workspaceId);
}

/**
 * The workspace the URL the app was opened with points at, if any. App's
 * startup opens it instead of the most recently used one.
 */
export function initialUrlWorkspaceId(): string | null {
  return parseLocation(window.location.pathname, window.location.search)
    .workspaceId;
}

/**
 * Remember the URL the page was opened with, before startup picks a
 * workspace. Its page, scope and member are applied once that workspace is
 * ready; if startup lands on a different workspace (no access), only the
 * page carries over.
 */
export function captureInitialLocation() {
  pendingInitial = parseLocation(
    window.location.pathname,
    window.location.search,
  );
  lastWritten = null;
}

/**
 * Keeps the URL and the stores in step (#1128). Mounted once by MainPanel:
 * store changes write the URL (a new history entry per real step, a replace
 * for minor ones), and back/forward applies the URL to the stores.
 */
export function useUrlLocation() {
  useEffect(() => {
    // Take the opening URL exactly once, even if this effect runs twice
    // (React StrictMode mounts effects twice in development).
    const initial = pendingInitial;
    if (initial) {
      void (async () => {
        const workspaceId = useWorkspaceStore.getState().selectedTree?.id;
        applying = true;
        try {
          if (
            workspaceId &&
            (!initial.workspaceId || initial.workspaceId === workspaceId)
          ) {
            await applyLocation(initial);
          }
        } finally {
          applying = false;
          requestLocationReplace();
          writeLocation();
        }
      })();
    } else if (!applying) {
      requestLocationReplace();
      writeLocation();
    }
    pendingInitial = null;

    const unsubscribers = [
      useWorkspaceStore.subscribe(writeLocation),
      useActiveViewStore.subscribe(writeLocation),
      useMemberStore.subscribe(writeLocation),
      useMemberSheetStore.subscribe(writeLocation),
    ];
    const onPopState = () => void restoreFromUrl();
    window.addEventListener("popstate", onPopState);
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
}

/** Test helper: forget module state between tests. */
export function resetUrlLocationForTests() {
  applying = false;
  lastWritten = null;
  pendingInitial = null;
  replaceNextWrite = false;
  useLocationRestoreStore.setState({ restoring: false, restoredSeq: 0 });
}
