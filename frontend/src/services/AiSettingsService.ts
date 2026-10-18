import { api } from "@/services/api";
import type { AiSettings, AiSettingsSave } from "@/types/ai";

const BASE = "/users/me/ai-settings";

export const AiSettingsService = {
  get(): Promise<AiSettings> {
    return api.get<AiSettings>(BASE);
  },

  save(payload: AiSettingsSave): Promise<AiSettings> {
    return api.put<AiSettings>(BASE, payload);
  },

  remove(): Promise<AiSettings> {
    return api.del<AiSettings>(BASE);
  },
};
