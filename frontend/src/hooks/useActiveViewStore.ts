import { create } from "zustand";
import { isViewId, MEDIA_VIEW, TREE_VIEW, type ViewId } from "@/lib/tabs";
import { parseLocation, type MediaSection } from "@/utils/appLocation";

export type { MediaSection };

const ACTIVE_VIEW_STORAGE_KEY = "ft_active_tab";
const ACTIVE_MEDIA_SECTION_STORAGE_KEY = "ft_active_media_section";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the in-memory state still works */
  }
}

// The URL wins over the remembered page, so a link or a reload opens exactly
// what it names; a bare `/` falls back to the page this browser used last.
function urlLocation() {
  return parseLocation(window.location.pathname, window.location.search);
}

function readInitialView(): ViewId {
  const fromUrl = urlLocation().view;
  if (fromUrl) return fromUrl;
  const stored = safeGet(ACTIVE_VIEW_STORAGE_KEY);
  // Gallery and Documents used to be separate top-level views.
  if (stored === "gallery-view" || stored === "documents-view") {
    return MEDIA_VIEW;
  }
  return stored && isViewId(stored) ? stored : TREE_VIEW;
}

function readInitialMediaSection(): MediaSection {
  const fromUrl = urlLocation().mediaSection;
  if (fromUrl) return fromUrl;
  const stored = safeGet(ACTIVE_MEDIA_SECTION_STORAGE_KEY);
  if (stored === "documents") return "documents";
  if (safeGet(ACTIVE_VIEW_STORAGE_KEY) === "documents-view") return "documents";
  return "gallery";
}

interface ActiveViewState {
  activeView: ViewId;
  mediaSection: MediaSection;
  setActiveView: (view: ViewId) => void;
  setMediaSection: (section: MediaSection) => void;
  /** Re-read the view and media section from the URL, else localStorage. */
  hydrate: () => void;
}

/**
 * The view currently shown in the main panel. Shared between the left
 * navigation (which changes it) and MainPanel (which renders it). The URL
 * carries it (see `useUrlLocation`); localStorage only remembers the last
 * page for a bare `/`.
 */
export const useActiveViewStore = create<ActiveViewState>((set) => ({
  activeView: readInitialView(),
  mediaSection: readInitialMediaSection(),
  setActiveView: (view) => {
    safeSet(ACTIVE_VIEW_STORAGE_KEY, view);
    set({ activeView: view });
  },
  setMediaSection: (section) => {
    safeSet(ACTIVE_MEDIA_SECTION_STORAGE_KEY, section);
    set({ mediaSection: section });
  },
  hydrate: () =>
    set({
      activeView: readInitialView(),
      mediaSection: readInitialMediaSection(),
    }),
}));
