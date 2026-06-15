import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesStore } from "./useUnsavedChangesStore";

const makeGuard = (result = true) => ({
  requestSave: vi.fn().mockResolvedValue(result),
});

beforeEach(() => {
  useUnsavedChangesStore.setState({
    guards: {},
    pendingNav: null,
    dialogOpen: false,
  });
});

describe("useUnsavedChangesStore — hasUnsaved", () => {
  it("is false initially", () => {
    expect(useUnsavedChangesStore.getState().hasUnsaved()).toBe(false);
  });

  it("is true after register", () => {
    useUnsavedChangesStore.getState().register("a", makeGuard());
    expect(useUnsavedChangesStore.getState().hasUnsaved()).toBe(true);
  });

  it("is false after unregister", () => {
    useUnsavedChangesStore.getState().register("a", makeGuard());
    useUnsavedChangesStore.getState().unregister("a");
    expect(useUnsavedChangesStore.getState().hasUnsaved()).toBe(false);
  });
});

describe("useUnsavedChangesStore — guardNavigate", () => {
  it("runs action immediately when clean", () => {
    const action = vi.fn();
    useUnsavedChangesStore.getState().guardNavigate(action);
    expect(action).toHaveBeenCalledOnce();
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(false);
  });

  it("opens dialog and stashes action when dirty", () => {
    useUnsavedChangesStore.getState().register("a", makeGuard());
    const action = vi.fn();
    useUnsavedChangesStore.getState().guardNavigate(action);
    expect(action).not.toHaveBeenCalled();
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(true);
    expect(useUnsavedChangesStore.getState().pendingNav).toBe(action);
  });
});

describe("useUnsavedChangesStore — resolveStay", () => {
  it("closes dialog and drops pendingNav without running it", () => {
    const action = vi.fn();
    useUnsavedChangesStore.setState({ pendingNav: action, dialogOpen: true });
    useUnsavedChangesStore.getState().resolveStay();
    expect(action).not.toHaveBeenCalled();
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(false);
    expect(useUnsavedChangesStore.getState().pendingNav).toBeNull();
  });
});

describe("useUnsavedChangesStore — resolveDiscard", () => {
  it("runs pendingNav and clears guards + dialog", () => {
    const action = vi.fn();
    useUnsavedChangesStore.getState().register("a", makeGuard());
    useUnsavedChangesStore.setState({ pendingNav: action, dialogOpen: true });
    useUnsavedChangesStore.getState().resolveDiscard();
    expect(action).toHaveBeenCalledOnce();
    expect(useUnsavedChangesStore.getState().guards).toEqual({});
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(false);
  });
});

describe("useUnsavedChangesStore — resolveSave", () => {
  it("runs pendingNav when all requestSave resolve true", async () => {
    const action = vi.fn();
    useUnsavedChangesStore.getState().register("a", makeGuard(true));
    useUnsavedChangesStore.setState({ pendingNav: action, dialogOpen: true });
    await useUnsavedChangesStore.getState().resolveSave();
    expect(action).toHaveBeenCalledOnce();
    expect(useUnsavedChangesStore.getState().guards).toEqual({});
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(false);
  });

  it("keeps dialog open when any requestSave resolves false", async () => {
    const action = vi.fn();
    useUnsavedChangesStore.getState().register("a", makeGuard(false));
    useUnsavedChangesStore.setState({ pendingNav: action, dialogOpen: true });
    await useUnsavedChangesStore.getState().resolveSave();
    expect(action).not.toHaveBeenCalled();
    expect(useUnsavedChangesStore.getState().dialogOpen).toBe(true);
  });
});
