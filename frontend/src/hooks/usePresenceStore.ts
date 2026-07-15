import { create } from "zustand";
import {
  PresenceUser,
  PresenceUserDB,
  mapPresenceUser,
} from "@/types/presence";
import { isActiveTree } from "@/hooks/useTreeStore";
import { useAuthStore } from "@/hooks/useAuthStore";

interface PresenceState {
  /** Everyone currently active in the open tree — includes the current user. */
  roster: PresenceUser[];
  setRoster: (treeId: string, users: PresenceUserDB[]) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  roster: [],

  // Guard against a late roster from a tree the user has already left, mirroring
  // the stale-write guard the content stores use.
  setRoster: (treeId, users) => {
    if (!isActiveTree(treeId)) return;
    set({ roster: users.map(mapPresenceUser) });
  },

  clear: () => set({ roster: [] }),
}));

/** Present users other than the current one — the collaborators to surface. */
export const useOtherPresences = (): PresenceUser[] => {
  const roster = usePresenceStore((s) => s.roster);
  const myId = useAuthStore((s) => s.user?.id);
  return roster.filter((u) => u.userId !== myId);
};

/** Other users currently editing `memberId` (empty when nobody else is). */
export const useMemberEditors = (
  memberId: string | undefined,
): PresenceUser[] => {
  const roster = usePresenceStore((s) => s.roster);
  const myId = useAuthStore((s) => s.user?.id);
  if (!memberId) return [];
  return roster.filter(
    (u) => u.userId !== myId && u.editingMemberId === memberId,
  );
};
