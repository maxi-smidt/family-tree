import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MemberSheetSectionsState {
  /**
   * Whether each Records-tab section (keyed by a stable section id, e.g.
   * "events") is collapsed. Missing entries default to expanded. Shared
   * between view and edit mode, and across members, since it reflects a
   * per-user layout preference rather than per-member data.
   */
  collapsedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
}

export const useMemberSheetSectionsStore = create<MemberSheetSectionsState>()(
  persist(
    (set) => ({
      collapsedSections: {},
      toggleSection: (sectionId) =>
        set((state) => ({
          collapsedSections: {
            ...state.collapsedSections,
            [sectionId]: !state.collapsedSections[sectionId],
          },
        })),
    }),
    { name: "ft-member-sheet-sections", version: 1 },
  ),
);
