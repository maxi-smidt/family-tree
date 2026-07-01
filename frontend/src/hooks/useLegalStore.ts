import { create } from "zustand";
import { useAuthStore } from "@/hooks/useAuthStore";
import { LegalPublicDocuments, LegalService } from "@/services/LegalService";

interface LegalState {
  documents: LegalPublicDocuments | null;
  /** The locale the currently loaded documents were requested for. */
  locale: string | null;
  loaded: boolean;
  loading: boolean;
  accepting: boolean;
  load: (locale: string) => Promise<void>;
  accept: (locale: string) => Promise<void>;
}

export const useLegalStore = create<LegalState>((set, get) => ({
  documents: null,
  locale: null,
  loaded: false,
  loading: false,
  accepting: false,

  async load(locale) {
    const state = get();
    // Re-fetch when the requested locale changes (e.g. the user switches
    // language); skip duplicate fetches for the locale already (being) loaded.
    if (state.locale === locale && (state.loaded || state.loading)) return;
    set({ loading: true, locale });
    try {
      const documents = await LegalService.getPublicDocuments(locale);
      set({ documents, loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async accept(locale) {
    set({ accepting: true });
    try {
      await LegalService.accept(locale);
      // Refresh the user so legal_accepted flips and the gate closes.
      await useAuthStore.getState().refreshMe();
    } finally {
      set({ accepting: false });
    }
  },
}));

export const resetLegalStoreForSession = () => {
  useLegalStore.setState({
    documents: null,
    locale: null,
    loaded: false,
    loading: false,
    accepting: false,
  });
};
