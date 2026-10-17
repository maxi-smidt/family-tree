import { create } from "zustand";
import {
  PresenceUser,
  PresenceUserDB,
  mapPresenceUser,
} from "@/types/presence";
import { isActiveTree } from "@/hooks/useWorkspaceStore";
import { useAuthStore } from "@/hooks/useAuthStore";

const ACTIVITY_PULSE_MS = 1_500;
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface PresenceState {
  /** Everyone currently active in the open tree — includes the current user. */
  roster: PresenceUser[];
  /** Users whose recent tree mutation should briefly highlight their avatar. */
  recentlyActiveUserIds: string[];
  setRoster: (workspaceId: string, users: PresenceUserDB[]) => void;
  markActivity: (userId: string) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  roster: [],
  recentlyActiveUserIds: [],

  // Guard against a late roster from a tree the user has already left, mirroring
  // the stale-write guard the content stores use.
  setRoster: (workspaceId, users) => {
    if (!isActiveTree(workspaceId)) return;
    set({ roster: users.map(mapPresenceUser) });
  },

  markActivity: (userId) => {
    const previousTimer = activityTimers.get(userId);
    if (previousTimer) clearTimeout(previousTimer);
    set((state) => ({
      recentlyActiveUserIds: state.recentlyActiveUserIds.includes(userId)
        ? state.recentlyActiveUserIds
        : [...state.recentlyActiveUserIds, userId],
    }));
    activityTimers.set(
      userId,
      setTimeout(() => {
        activityTimers.delete(userId);
        set((state) => ({
          recentlyActiveUserIds: state.recentlyActiveUserIds.filter(
            (id) => id !== userId,
          ),
        }));
      }, ACTIVITY_PULSE_MS),
    );
  },

  clear: () => {
    for (const timer of activityTimers.values()) clearTimeout(timer);
    activityTimers.clear();
    set({ roster: [], recentlyActiveUserIds: [] });
  },
}));

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
