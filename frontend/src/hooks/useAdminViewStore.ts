import { create } from "zustand";

interface AdminViewState {
  open: boolean;
  openAdmin: () => void;
  closeAdmin: () => void;
}

export const useAdminViewStore = create<AdminViewState>((set) => ({
  open: false,
  openAdmin: () => set({ open: true }),
  closeAdmin: () => set({ open: false }),
}));
