import { create } from "zustand";
import { AiSettingsService } from "@/services/AiSettingsService";
import type { AiProviderInfo, AiSettings, AiSettingsSave } from "@/types/ai";

interface AiSettingsState {
  settings: AiSettings | null;
  loading: boolean;
  /** Load once per session; `force` re-reads after a change elsewhere. */
  load: (force?: boolean) => Promise<void>;
  save: (payload: AiSettingsSave) => Promise<AiSettings>;
  remove: () => Promise<void>;
  clear: () => void;
}

export const useAiSettingsStore = create<AiSettingsState>()((set, get) => ({
  settings: null,
  loading: false,

  load: async (force = false) => {
    if (get().loading || (get().settings && !force)) return;
    set({ loading: true });
    try {
      set({ settings: await AiSettingsService.get() });
    } finally {
      set({ loading: false });
    }
  },

  save: async (payload) => {
    const settings = await AiSettingsService.save(payload);
    set({ settings });
    return settings;
  },

  remove: async () => {
    set({ settings: await AiSettingsService.remove() });
  },

  clear: () => set({ settings: null, loading: false }),
}));

/** The configured provider, or `undefined` while AI is off. */
export function activeAiProvider(
  settings: AiSettings | null,
): AiProviderInfo | undefined {
  if (!settings?.configured) return undefined;
  return settings.providers.find((p) => p.id === settings.provider);
}
