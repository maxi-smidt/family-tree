import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceNavStore } from "./useWorkspaceNavStore";

beforeEach(() => {
  useWorkspaceNavStore.getState().clear();
});

describe("useWorkspaceNavStore", () => {
  it("starts in explore mode with no selection", () => {
    const state = useWorkspaceNavStore.getState();
    expect(state.mode).toBe("explore");
    expect(state.selectedSectionId).toBeNull();
    expect(state.selectedSavedViewId).toBeNull();
  });

  it("selecting a section clears any saved-view selection", () => {
    useWorkspaceNavStore.getState().selectSavedView("v1");
    useWorkspaceNavStore.getState().selectSection("s1");

    const state = useWorkspaceNavStore.getState();
    expect(state.mode).toBe("section");
    expect(state.selectedSectionId).toBe("s1");
    expect(state.selectedSavedViewId).toBeNull();
  });

  it("selecting a saved view clears any section selection", () => {
    useWorkspaceNavStore.getState().selectSection("s1");
    useWorkspaceNavStore.getState().selectSavedView("v1");

    const state = useWorkspaceNavStore.getState();
    expect(state.mode).toBe("saved-view");
    expect(state.selectedSavedViewId).toBe("v1");
    expect(state.selectedSectionId).toBeNull();
  });

  it("selectExplore resets both selections", () => {
    useWorkspaceNavStore.getState().selectSection("s1");
    useWorkspaceNavStore.getState().selectExplore();

    const state = useWorkspaceNavStore.getState();
    expect(state.mode).toBe("explore");
    expect(state.selectedSectionId).toBeNull();
    expect(state.selectedSavedViewId).toBeNull();
  });
});
