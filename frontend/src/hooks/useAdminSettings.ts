import { useCallback, useState } from "react";
import { AdminService, AdminSettings } from "@/services/AdminService";

/** Instance settings state and persistence boundary for the admin area. */
export function useAdminSettings() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await action();
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(
    () =>
      run(async () => {
        const nextSettings = await AdminService.getSettings();
        setSettings(nextSettings);
      }),
    [run],
  );

  const saveSettings = useCallback(
    (nextSettings: AdminSettings) =>
      run(async () => {
        const savedSettings = await AdminService.updateSettings(nextSettings);
        setSettings(savedSettings);
        return savedSettings;
      }),
    [run],
  );

  return { settings, setSettings, loading, error, loadSettings, saveSettings };
}
