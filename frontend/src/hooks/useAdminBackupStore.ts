import { create } from "zustand";
import { AdminService, BackupRecord } from "@/services/AdminService";

interface AdminBackupState {
  backups: BackupRecord[];
  loading: boolean;
  triggering: boolean;
  downloadingId: string | null;
  loadBackups: () => Promise<void>;
  triggerBackup: () => Promise<BackupRecord>;
  deleteBackup: (id: string) => Promise<void>;
  downloadBackup: (id: string) => Promise<Blob>;
}

/** Owns backup transport and refresh behavior for the admin backup panel. */
export const useAdminBackupStore = create<AdminBackupState>((set, get) => ({
  backups: [],
  loading: false,
  triggering: false,
  downloadingId: null,

  loadBackups: async () => {
    set({ loading: true });
    try {
      set({ backups: await AdminService.listBackups() });
    } finally {
      set({ loading: false });
    }
  },

  triggerBackup: async () => {
    set({ triggering: true });
    try {
      const backup = await AdminService.triggerBackup();
      await get().loadBackups();
      return backup;
    } finally {
      set({ triggering: false });
    }
  },

  deleteBackup: async (id: string) => {
    await AdminService.deleteBackup(id);
    set((state) => ({
      backups: state.backups.filter((backup) => backup.id !== id),
    }));
  },

  downloadBackup: async (id: string) => {
    set({ downloadingId: id });
    try {
      return await AdminService.downloadBackup(id);
    } finally {
      set((state) =>
        state.downloadingId === id ? { downloadingId: null } : {},
      );
    }
  },
}));
