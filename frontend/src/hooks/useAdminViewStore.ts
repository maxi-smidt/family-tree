import { create } from "zustand";

interface AdminViewState {
  open: boolean;
  backupTick: number;
  purgeTick: number;
  openAdmin: () => void;
  closeAdmin: () => void;
  bumpBackupTick: () => void;
  bumpPurgeTick: () => void;
}

export const useAdminViewStore = create<AdminViewState>((set) => ({
  open: false,
  backupTick: 0,
  purgeTick: 0,
  openAdmin: () => set({ open: true }),
  closeAdmin: () => set({ open: false }),
  bumpBackupTick: () => set((s) => ({ backupTick: s.backupTick + 1 })),
  bumpPurgeTick: () => set((s) => ({ purgeTick: s.purgeTick + 1 })),
}));
