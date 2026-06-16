/**
 * Seed helpers — build known tree shapes via the API so feature specs can
 * arrange state quickly without driving the UI.
 */

import { randomUUID } from "crypto";
import type { ApiClient } from "./api";

export interface TreeRecord {
  id: string;
  name: string;
}

export interface MemberRecord {
  id: string;
  firstName?: string | null;
  middleNames?: string | null;
  lastName?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  dateOfDeath?: string | null;
  deceased?: boolean;
  additionalData?: string | null;
  birthplace?: string | null;
  hometown?: string | null;
  isCollapsed?: boolean;
  positionX?: number;
  positionY?: number;
}

export interface RelationRecord {
  from_member_id: string;
  to_member_id: string;
  relation_type: string;
}

export async function createTree(
  api: ApiClient,
  name?: string,
): Promise<TreeRecord> {
  const id = randomUUID();
  const treeName = name ?? `E2E-Tree-${id.slice(0, 8)}`;
  return api.post<TreeRecord>("/trees", { id, name: treeName });
}

export async function deleteTree(
  api: ApiClient,
  treeId: string,
): Promise<void> {
  await api.delete(`/trees/${treeId}`);
}

export async function createMember(
  api: ApiClient,
  treeId: string,
  fields: Partial<MemberRecord> = {},
): Promise<MemberRecord> {
  const id = fields.id ?? randomUUID();
  return api.post<MemberRecord>(`/trees/${treeId}/members`, {
    id,
    firstName: fields.firstName ?? "Test",
    lastName: fields.lastName ?? "Member",
    ...fields,
  });
}

export async function createRelation(
  api: ApiClient,
  treeId: string,
  fromId: string,
  toId: string,
  relationType = "partner",
): Promise<RelationRecord> {
  return api.post<RelationRecord>(`/trees/${treeId}/relations`, {
    from_member_id: fromId,
    to_member_id: toId,
    relation_type: relationType,
  });
}

/**
 * Build a minimal family: two partners (Alice + Bob) and one child (Charlie).
 * Returns the created member ids.
 */
export async function seedMinimalFamily(
  api: ApiClient,
  treeId: string,
): Promise<{ alice: MemberRecord; bob: MemberRecord; charlie: MemberRecord }> {
  const alice = await createMember(api, treeId, {
    firstName: "Alice",
    lastName: "Smith",
    gender: "f",
    dateOfBirth: "1980-01-01",
  } as Partial<MemberRecord> & Record<string, unknown>);

  const bob = await createMember(api, treeId, {
    firstName: "Bob",
    lastName: "Smith",
    gender: "m",
    dateOfBirth: "1978-06-15",
  } as Partial<MemberRecord> & Record<string, unknown>);

  await createRelation(api, treeId, alice.id, bob.id, "partner");

  const charlie = await createMember(api, treeId, {
    firstName: "Charlie",
    lastName: "Smith",
    gender: "m",
    dateOfBirth: "2005-03-20",
  } as Partial<MemberRecord> & Record<string, unknown>);

  await createRelation(api, treeId, alice.id, charlie.id, "parent");

  return { alice, bob, charlie };
}
