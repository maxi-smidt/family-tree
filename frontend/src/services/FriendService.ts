import { api } from "@/services/api";
import { Friend, UserSearchResult } from "@/types/friend";

/** Thin HTTP client for the friends API. Stores call these; components don't. */
export const FriendService = {
  listFriends(): Promise<Friend[]> {
    return api.get<Friend[]>("/friends");
  },

  listIncoming(): Promise<Friend[]> {
    return api.get<Friend[]>("/friends/incoming");
  },

  listOutgoing(): Promise<Friend[]> {
    return api.get<Friend[]>("/friends/outgoing");
  },

  search(q: string): Promise<UserSearchResult[]> {
    return api.get<UserSearchResult[]>("/friends/search", { q });
  },

  sendRequest(username: string): Promise<Friend> {
    return api.post<Friend>("/friends/requests", { username });
  },

  accept(userId: string): Promise<Friend> {
    return api.post<Friend>(`/friends/${userId}/accept`, {});
  },

  decline(userId: string): Promise<void> {
    return api.post<void>(`/friends/${userId}/decline`, {});
  },

  remove(userId: string): Promise<void> {
    return api.del<void>(`/friends/${userId}`);
  },

  block(userId: string): Promise<void> {
    return api.post<void>(`/friends/${userId}/block`, {});
  },

  unblock(userId: string): Promise<void> {
    return api.del<void>(`/friends/${userId}/block`);
  },
};
