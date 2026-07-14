/**
 * E2E tests: Sharing, invitations & public viewer (#267)
 * Permission enforcement — viewer cannot edit, server-side 403s asserted.
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { createMember } from "../fixtures/seed";
import { API_URL } from "../playwright.config";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Share as viewer
// ---------------------------------------------------------------------------

test("viewer — can read tree, write request is 403", async ({
  adminApi,
  secondUser,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-ShareViewer");
  await createMember(adminApi, tree.id, {
    firstName: "Shared",
    lastName: "Member",
  });

  // Share with second user as viewer
  await adminApi.post(`/trees/${tree.id}/access`, {
    username: secondUser.username,
    role: "viewer",
  });

  // Viewer can list members (readable)
  const members = await secondApi.get<unknown[]>(`/trees/${tree.id}/members`);
  expect(Array.isArray(members)).toBe(true);
  expect(members.length).toBeGreaterThan(0);

  // Viewer cannot add a member (writable endpoint → 403)
  const addRes = await fetch(`${API_URL}/trees/${tree.id}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secondApi.token}`,
    },
    body: JSON.stringify({
      id: randomUUID(),
      firstName: "Intruder",
      lastName: "X",
    }),
  });
  expect(addRes.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Share as editor
// ---------------------------------------------------------------------------

test("editor — can add a member, owner sees it", async ({
  adminApi,
  secondUser,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-ShareEditor");

  // Share with editor role
  await adminApi.post(`/trees/${tree.id}/access`, {
    username: secondUser.username,
    role: "editor",
  });

  // Editor adds a member
  const newId = randomUUID();
  await secondApi.post(`/trees/${tree.id}/members`, {
    id: newId,
    firstName: "EditorAdded",
    lastName: "Member",
  });

  // Owner sees it
  const members = await adminApi.get<Array<{ id: string; firstName?: string }>>(
    `/trees/${tree.id}/members`,
  );
  expect(members.find((m) => m.firstName === "EditorAdded")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Revoke access
// ---------------------------------------------------------------------------

test("revoke access — tree disappears from recipient's list and reads 403", async ({
  adminApi,
  secondUser,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-RevokeAccess");

  await adminApi.post(`/trees/${tree.id}/access`, {
    username: secondUser.username,
    role: "editor",
  });

  // Confirm visible before revoke
  let userTrees = await secondApi.get<Array<{ id: string }>>("/trees");
  expect(userTrees.map((t) => t.id)).toContain(tree.id);

  // Revoke
  await adminApi.delete(`/trees/${tree.id}/access/${secondUser.id}`);

  // No longer visible
  userTrees = await secondApi.get<Array<{ id: string }>>("/trees");
  expect(userTrees.map((t) => t.id)).not.toContain(tree.id);

  // Direct read is now 403
  const readRes = await fetch(`${API_URL}/trees/${tree.id}/members`, {
    headers: { Authorization: `Bearer ${secondApi.token}` },
  });
  expect(readRes.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Share candidates
// ---------------------------------------------------------------------------

test("share candidates — eligible users listed, owner excluded", async ({
  adminApi,
  secondUser,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Candidates");
  const admin = await adminApi.get<{ id: string; username: string }>(
    "/auth/me",
  );

  await adminApi.post("/friends/requests", {
    username: secondUser.username,
  });
  await secondApi.post(`/friends/${admin.id}/accept`);

  const candidates = await adminApi.get<Array<{ username: string }>>(
    `/trees/${tree.id}/access/candidates`,
  );
  const names = candidates.map((c) => c.username);
  // Second user (not yet shared) is a candidate
  expect(names).toContain(secondUser.username);
  // Owner (admin) is NOT a candidate
  expect(names).not.toContain(admin.username);
});

// ---------------------------------------------------------------------------
// Invitation link
// ---------------------------------------------------------------------------

test("invite link — accept grants access", async ({
  adminApi,
  secondUser,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-InviteLink");

  // Create an invitation
  const invitation = await adminApi.post<{ token: string }>(
    `/trees/${tree.id}/invitations`,
    { role: "viewer", expires_in_days: 7 },
  );
  expect(invitation.token).toBeTruthy();

  // Second user accepts the invitation
  const acceptRes = await fetch(
    `${API_URL}/invites/${invitation.token}/accept`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secondApi.token}`,
      },
    },
  );
  expect(acceptRes.ok).toBe(true);

  // Tree is now accessible
  const userTrees = await secondApi.get<Array<{ id: string }>>("/trees");
  expect(userTrees.map((t) => t.id)).toContain(tree.id);
});

test("revoked invite — accept returns 409", async ({
  adminApi,
  secondApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-RevokedInvite");
  const invitation = await adminApi.post<{ id: string; token: string }>(
    `/trees/${tree.id}/invitations`,
    { role: "viewer" },
  );

  // Revoke immediately
  await adminApi.delete(`/trees/${tree.id}/invitations/${invitation.id}`);

  // Accept should fail
  const acceptRes = await fetch(
    `${API_URL}/invites/${invitation.token}/accept`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secondApi.token}`,
      },
    },
  );
  expect(acceptRes.status).toBe(409);
});

// ---------------------------------------------------------------------------
// Public tree
// ---------------------------------------------------------------------------

test("public tree — unauthenticated visitor can read members", async ({
  adminApi,
  browser,
  seedTree,
}) => {
  const tree = await seedTree("E2E-PublicTree");
  await createMember(adminApi, tree.id, {
    firstName: "PublicPerson",
    lastName: "X",
  });

  // Make tree public
  await adminApi.patch(`/trees/${tree.id}/public`, { public_role: "viewer" });

  // Unauthenticated request to members (public endpoint)
  const res = await fetch(`${API_URL}/trees/${tree.id}/members`);
  expect(res.ok).toBe(true);
  const members = (await res.json()) as Array<{ firstName?: string }>;
  expect(members.find((m) => m.firstName === "PublicPerson")).toBeTruthy();

  // Restore to private
  await adminApi.patch(`/trees/${tree.id}/public`, { public_role: null });
  void browser;
});

test("public tree link — anonymous visitor loads photos and custom relations", async ({
  adminApi,
  page,
  seedTree,
}) => {
  const tree = await seedTree("E2E-PublicTreeMedia");
  const customRelationId = `public-e2e-${randomUUID().slice(0, 8)}`;
  const imageData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const first = await createMember(adminApi, tree.id, {
    firstName: "PublicPhoto",
    lastName: "Person",
    imageData,
  });
  const second = await createMember(adminApi, tree.id, {
    firstName: "PublicRelation",
    lastName: "Person",
  });
  await adminApi.post("/admin/relation-types", {
    id: customRelationId,
    label: "Public E2E relation",
    color: "#123456",
  });
  await adminApi.post(`/trees/${tree.id}/relations`, {
    from_member_id: first.id,
    to_member_id: second.id,
    relation_type: customRelationId,
  });
  await adminApi.patch(`/trees/${tree.id}/public`, { public_role: "viewer" });

  const relationTypesResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/relation-types"),
  );
  const mediaResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/media/${tree.id}/`) &&
      response.status() === 200,
  );
  await page.goto(`/#public=${tree.id}`);

  await expect(page.getByRole("heading", { name: tree.name })).toBeVisible();
  const relationTypes = await relationTypesResponse;
  expect(relationTypes.status()).toBe(200);
  expect(
    (await relationTypes.json()) as Array<{ id: string }>,
  ).toContainEqual(expect.objectContaining({ id: customRelationId }));
  await mediaResponse;

  // Remove the custom registry entry before fixture teardown deletes the tree.
  await adminApi.delete(
    `/trees/${tree.id}/relations?from_member_id=${first.id}&to_member_id=${second.id}&relation_type=${customRelationId}`,
  );
  await adminApi.delete(`/admin/relation-types/${customRelationId}`);
});

test("public tree link — password-protected anonymous visitor can unlock", async ({
  adminApi,
  page,
  seedTree,
}) => {
  const tree = await seedTree("E2E-ProtectedPublicTree");
  await createMember(adminApi, tree.id, {
    firstName: "ProtectedPublicPerson",
    lastName: "X",
  });
  await adminApi.patch(`/trees/${tree.id}/public`, { public_role: "viewer" });
  const passwordResponse = await fetch(
    `${API_URL}/trees/${tree.id}/public/password`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminApi.token}`,
      },
      body: JSON.stringify({ password: "public-password" }),
    },
  );
  expect(passwordResponse.ok).toBe(true);

  await page.goto(`/#public=${tree.id}`);
  await expect(page.getByText("Password required")).toBeVisible();
  await page.locator('input[type="password"]').fill("public-password");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page.getByRole("heading", { name: tree.name })).toBeVisible();
});

test("public tree link — signed-in visitor opens the linked tree normally", async ({
  adminApi,
  adminPage,
  seedTree,
}) => {
  const tree = await seedTree("E2E-SignedInPublicTree");
  await createMember(adminApi, tree.id, {
    firstName: "SignedInPublicPerson",
    lastName: "X",
  });
  await adminApi.patch(`/trees/${tree.id}/public`, { public_role: "viewer" });

  // The fixture has already loaded the SPA while signing in. Navigate away so
  // the public URL is handled as a fresh link visit rather than a hash-only
  // in-page navigation.
  await adminPage.goto("about:blank");
  await adminPage.goto(`/#public=${tree.id}`);

  await expect(adminPage.getByText("SignedInPublicPerson")).toBeVisible();
  await expect(
    adminPage.getByText("Read-only view — log in to explore the full interactive tree."),
  ).not.toBeVisible();
});

test("public tree disabled — unauthenticated read returns 403", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-PrivateTree");

  // Ensure private (never published)
  const res = await fetch(`${API_URL}/trees/${tree.id}/members`);
  // Anonymous request without a token should be 401 or 403
  expect([401, 403]).toContain(res.status);
});
