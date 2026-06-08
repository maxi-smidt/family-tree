import { describe, expect, it } from "vitest";
import { mapActivityFromDB, ActivityDB } from "./activity";

const baseRow: ActivityDB = {
  id: "a1",
  tree_id: "t1",
  actor_id: "u1",
  actor_username: "alice",
  action: "create",
  target_type: "member",
  target_id: "m1",
  target_label: "Ada Doe",
  created_at: "2024-01-01T12:00:00Z",
};

describe("mapActivityFromDB", () => {
  it("maps all fields to camelCase", () => {
    const result = mapActivityFromDB(baseRow);
    expect(result.id).toBe("a1");
    expect(result.treeId).toBe("t1");
    expect(result.actorId).toBe("u1");
    expect(result.actorUsername).toBe("alice");
    expect(result.action).toBe("create");
    expect(result.targetType).toBe("member");
    expect(result.targetId).toBe("m1");
    expect(result.targetLabel).toBe("Ada Doe");
    expect(result.createdAt).toBe("2024-01-01T12:00:00Z");
  });

  it("passes through null optional fields", () => {
    const row: ActivityDB = {
      ...baseRow,
      actor_id: null,
      actor_username: null,
      target_id: null,
      target_label: null,
    };
    const result = mapActivityFromDB(row);
    expect(result.actorId).toBeNull();
    expect(result.actorUsername).toBeNull();
    expect(result.targetId).toBeNull();
    expect(result.targetLabel).toBeNull();
  });
});
