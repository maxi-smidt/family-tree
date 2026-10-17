import { create } from "zustand";
import { isViewId, MEDIA_VIEW, TREE_VIEW, type ViewId } from "@/lib/tabs";
import { readMemberSheetDeepLink } from "@/utils/memberSheetState";

export type MediaSection = "gallery" | "documents";

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

function readInitialView(): ViewId {
  if (readMemberSheetDeepLink()) return TREE_VIEW;
  const stored = safeGet(ACTIVE_VIEW_STORAGE_KEY);
  // Gallery and Documents used to be separate top-level views.
  if (stored === "gallery-view" || stored === "documents-view") {
    return MEDIA_VIEW;
  }
  return stored && isViewId(stored) ? stored : TREE_VIEW;
}

function readInitialMediaSection(): MediaSection {
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
  /** Re-read the persisted view and media section from localStorage. */
  hydrate: () => void;
}

/**
 * The view currently shown in the main panel. Shared between the left
 * navigation (which changes it) and MainPanel (which renders it), and
 * mirrored to localStorage so a reload reopens the same view.
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
