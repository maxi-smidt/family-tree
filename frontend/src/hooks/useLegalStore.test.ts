import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLegalStoreForSession, useLegalStore } from "./useLegalStore";
import { LegalService } from "@/services/LegalService";
import { useAuthStore } from "@/hooks/useAuthStore";

vi.mock("@/services/LegalService");

const documents = {
  terms_body: "Terms body",
  privacy_body: "Privacy body",
  imprint_body: "Imprint body",
  version: "2",
  locale: "de",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLegalStoreForSession();
  vi.mocked(LegalService.getPublicDocuments).mockResolvedValue(documents);
  vi.mocked(LegalService.accept).mockResolvedValue({
    accepted: true,
    version: "2",
  });
  useAuthStore.setState({
    refreshMe: vi.fn().mockResolvedValue(undefined),
  });
});

describe("useLegalStore", () => {
  it("load fetches and stores the public documents", async () => {
    await useLegalStore.getState().load("de");
    const state = useLegalStore.getState();
    expect(state.documents).toEqual(documents);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(LegalService.getPublicDocuments).toHaveBeenCalledWith("de");
  });

  it("load is a no-op for the same locale once already loaded", async () => {
    await useLegalStore.getState().load("de");
    await useLegalStore.getState().load("de");
    expect(LegalService.getPublicDocuments).toHaveBeenCalledTimes(1);
  });

  it("load re-fetches when the requested locale changes", async () => {
    await useLegalStore.getState().load("de");
    await useLegalStore.getState().load("en");
    expect(LegalService.getPublicDocuments).toHaveBeenCalledTimes(2);
    expect(LegalService.getPublicDocuments).toHaveBeenLastCalledWith("en");
  });

  it("load swallows errors and clears the loading flag", async () => {
    vi.mocked(LegalService.getPublicDocuments).mockRejectedValue(
      new Error("network"),
    );
    await useLegalStore.getState().load("de");
    const state = useLegalStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
  });

  it("accept calls the service with the locale then refreshes the user", async () => {
    await useLegalStore.getState().accept("en");
    expect(LegalService.accept).toHaveBeenCalledWith("en");
    expect(useAuthStore.getState().refreshMe).toHaveBeenCalledTimes(1);
    expect(useLegalStore.getState().accepting).toBe(false);
  });

  it("resetLegalStoreForSession clears all state", async () => {
    await useLegalStore.getState().load("de");
    resetLegalStoreForSession();
    const state = useLegalStore.getState();
    expect(state.documents).toBeNull();
    expect(state.loaded).toBe(false);
  });
});
