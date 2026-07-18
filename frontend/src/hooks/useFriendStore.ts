import { create } from "zustand";
import { FriendService } from "@/services/FriendService";
import { Friend, UserSearchResult } from "@/types/friend";

interface FriendState {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
  loading: boolean;
  /** Refresh accepted friends, including their protected profile-image URLs. */
  loadFriends: () => Promise<void>;
  /** Lightweight refresh of just the incoming-request count (for the badge). */
  loadIncoming: () => Promise<void>;
  /** Full refresh of friends + pending requests (for the dialog). */
  loadAll: () => Promise<void>;
  search: (q: string) => Promise<UserSearchResult[]>;
  sendRequest: (username: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  decline: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  clear: () => void;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  loading: false,

  loadFriends: async () => {
    const friends = await FriendService.listFriends();
    set({ friends });
  },

  loadIncoming: async () => {
    const incoming = await FriendService.listIncoming();
    set({ incoming });
  },

  loadAll: async () => {
    set({ loading: true });
    try {
      const [friends, incoming, outgoing] = await Promise.all([
        FriendService.listFriends(),
        FriendService.listIncoming(),
        FriendService.listOutgoing(),
      ]);
      set({ friends, incoming, outgoing });
    } finally {
      set({ loading: false });
    }
  },

  search: (q) => FriendService.search(q),

  sendRequest: async (username) => {
    await FriendService.sendRequest(username);
    await get().loadAll();
  },

  accept: async (userId) => {
    await FriendService.accept(userId);
    await get().loadAll();
  },

  decline: async (userId) => {
    await FriendService.decline(userId);
    await get().loadAll();
  },

  remove: async (userId) => {
    await FriendService.remove(userId);
    await get().loadAll();
  },

  block: async (userId) => {
    await FriendService.block(userId);
    await get().loadAll();
  },

  unblock: async (userId) => {
    await FriendService.unblock(userId);
    await get().loadAll();
  },

  clear: () => set({ friends: [], incoming: [], outgoing: [] }),
}));

/** Reactive selector for the incoming-request badge count. */
export const useIncomingFriendCount = (): number =>
  useFriendStore((s) => s.incoming.length);
