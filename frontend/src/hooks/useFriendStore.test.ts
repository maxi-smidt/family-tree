import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFriendStore } from "./useFriendStore";
import { FriendService } from "@/services/FriendService";
import { Friend } from "@/types/friend";

vi.mock("@/services/FriendService");

function friend(
  id: string,
  direction: Friend["direction"] = "outgoing",
): Friend {
  return {
    user_id: id,
    username: id,
    full_name: null,
    status: direction === "incoming" ? "pending" : "accepted",
    direction,
    created_at: "2026-01-01T00:00:00Z",
    responded_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useFriendStore.setState({
    friends: [],
    incoming: [],
    outgoing: [],
    loading: false,
  });
  vi.mocked(FriendService.listFriends).mockResolvedValue([friend("bob")]);
  vi.mocked(FriendService.listIncoming).mockResolvedValue([
    friend("carol", "incoming"),
  ]);
  vi.mocked(FriendService.listOutgoing).mockResolvedValue([]);
});

describe("useFriendStore", () => {
  it("loadAll populates friends, incoming and outgoing", async () => {
    await useFriendStore.getState().loadAll();
    const state = useFriendStore.getState();
    expect(state.friends.map((f) => f.user_id)).toEqual(["bob"]);
    expect(state.incoming.map((f) => f.user_id)).toEqual(["carol"]);
    expect(state.outgoing).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("loadIncoming refreshes only the badge source", async () => {
    await useFriendStore.getState().loadIncoming();
    expect(FriendService.listIncoming).toHaveBeenCalledTimes(1);
    expect(FriendService.listFriends).not.toHaveBeenCalled();
    expect(useFriendStore.getState().incoming).toHaveLength(1);
  });

  it("sendRequest calls the service then reloads everything", async () => {
    vi.mocked(FriendService.sendRequest).mockResolvedValue(friend("dave"));
    await useFriendStore.getState().sendRequest("dave");
    expect(FriendService.sendRequest).toHaveBeenCalledWith("dave");
    expect(FriendService.listFriends).toHaveBeenCalledTimes(1);
  });

  it("accept and remove reload state through the service", async () => {
    vi.mocked(FriendService.accept).mockResolvedValue(friend("carol"));
    vi.mocked(FriendService.remove).mockResolvedValue(undefined);
    await useFriendStore.getState().accept("carol");
    await useFriendStore.getState().remove("bob");
    expect(FriendService.accept).toHaveBeenCalledWith("carol");
    expect(FriendService.remove).toHaveBeenCalledWith("bob");
    expect(FriendService.listFriends).toHaveBeenCalledTimes(2);
  });

  it("search delegates to the service without mutating state", async () => {
    vi.mocked(FriendService.search).mockResolvedValue([
      {
        user_id: "x",
        username: "xavier",
        full_name: null,
        status: null,
        direction: null,
      },
    ]);
    const results = await useFriendStore.getState().search("xav");
    expect(results).toHaveLength(1);
    expect(useFriendStore.getState().friends).toEqual([]);
  });
});
