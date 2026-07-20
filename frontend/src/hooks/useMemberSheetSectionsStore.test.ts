import { afterEach, describe, expect, it } from "vitest";
import { useMemberSheetSectionsStore } from "./useMemberSheetSectionsStore";

afterEach(() => {
  useMemberSheetSectionsStore.setState({ collapsedSections: {} });
  localStorage.removeItem("ft-member-sheet-sections");
});

describe("useMemberSheetSectionsStore", () => {
  it("toggles a section's collapsed state independently of others", () => {
    const { toggleSection } = useMemberSheetSectionsStore.getState();

    toggleSection("events");

    expect(useMemberSheetSectionsStore.getState().collapsedSections).toEqual({
      events: true,
    });

    toggleSection("documents");
    toggleSection("events");

    expect(useMemberSheetSectionsStore.getState().collapsedSections).toEqual({
      events: false,
      documents: true,
    });
  });
});
