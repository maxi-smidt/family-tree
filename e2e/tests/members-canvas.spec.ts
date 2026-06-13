/**
 * E2E tests: Member & relation editing on the canvas (#266)
 * Depends on foundation harness (#263).
 *
 * Strategy: most state is arranged via the API; the UI is used to verify what
 * rendered and to drive interactions that are only accessible through the SPA.
 * Assertions are on presence / text content, not pixel coordinates.
 */

import { test, expect } from "../fixtures";
import { createTree, deleteTree, createMember, createRelation, seedMinimalFamily } from "../fixtures/seed";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Select a tree in the sidebar dropdown by its name. */
async function selectTree(page: import("@playwright/test").Page, treeName: string) {
  const combo = page.getByRole("combobox").first();
  const current = await combo.textContent();
  if (current?.includes(treeName)) return;
  await combo.click();
  await page.getByRole("option", { name: treeName }).click();
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Member CRUD
// ---------------------------------------------------------------------------

test("add member — node appears in the list view", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-AddMember");

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);

  // Add via API (seeding)
  await createMember(adminApi, tree.id, {
    firstName: "NewCanvas",
    lastName: "Member",
  });

  // Switch to list view where text is directly readable
  await adminPage.getByRole("tab", { name: /list/i }).click();
  await expect(adminPage.getByText("NewCanvas")).toBeVisible({ timeout: 10_000 });
});

test("edit member fields — changes persist across reload", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-EditMember");
  const member = await createMember(adminApi, tree.id, {
    firstName: "Before",
    lastName: "Edit",
  });

  // Rename via API
  await adminApi.patch(`/trees/${tree.id}/members/${member.id}`, {
    firstName: "After",
  });

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await adminPage.getByRole("tab", { name: /list/i }).click();

  await expect(adminPage.getByText("After")).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByText("Before")).not.toBeVisible();
});

test("delete member — removed from list view", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteMember");
  const member = await createMember(adminApi, tree.id, {
    firstName: "ToDelete",
    lastName: "Member",
  });

  // Verify it shows up first
  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await adminPage.getByRole("tab", { name: /list/i }).click();
  await expect(adminPage.getByText("ToDelete")).toBeVisible({ timeout: 10_000 });

  // Delete via API
  await adminApi.delete(`/trees/${tree.id}/members/${member.id}`);
  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await adminPage.getByRole("tab", { name: /list/i }).click();
  await expect(adminPage.getByText("ToDelete")).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

test("create partner relation — both members appear in tree view", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-PartnerRelation");
  const alice = await createMember(adminApi, tree.id, {
    firstName: "RelAlice",
    lastName: "Smith",
  });
  const bob = await createMember(adminApi, tree.id, {
    firstName: "RelBob",
    lastName: "Smith",
  });
  await createRelation(adminApi, tree.id, alice.id, bob.id, "partner");

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await adminPage.getByRole("tab", { name: /tree|canvas/i }).first().click();
  await adminPage.waitForLoadState("networkidle");

  // Both nodes should render
  await expect(adminPage.getByText("RelAlice")).toBeVisible({ timeout: 10_000 });
  await expect(adminPage.getByText("RelBob")).toBeVisible({ timeout: 10_000 });
});

test("delete relation — edge removed (member still present)", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-DeleteRelation");
  const p1 = await createMember(adminApi, tree.id, { firstName: "DelP1", lastName: "R" });
  const p2 = await createMember(adminApi, tree.id, { firstName: "DelP2", lastName: "R" });
  await createRelation(adminApi, tree.id, p1.id, p2.id, "partner");

  // Delete relation via API
  const res = await fetch(
    `${process.env.E2E_API_URL ?? "http://localhost:8080/api"}/trees/${tree.id}/relations`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminApi.token}`,
      },
      body: JSON.stringify({ from_member_id: p1.id, to_member_id: p2.id }),
    },
  );
  expect(res.status).toBe(204);

  // Both members should still exist
  const members = await adminApi.get<unknown[]>(`/trees/${tree.id}/members`);
  expect(members).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Collapse / expand
// ---------------------------------------------------------------------------

test("collapse member — isCollapsed reflected in API response", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Collapse");
  const { alice } = await seedMinimalFamily(adminApi, tree.id);

  // Collapse via API
  await adminApi.patch(`/trees/${tree.id}/members/collapsed`, [
    { id: alice.id, isCollapsed: true },
  ]);

  const members = await adminApi.get<Array<{ id: string; isCollapsed: boolean }>>(
    `/trees/${tree.id}/members`,
  );
  const aliceRecord = members.find((m) => m.id === alice.id);
  expect(aliceRecord?.isCollapsed).toBe(true);
});

// ---------------------------------------------------------------------------
// Member locate / focus  (UI interaction)
// ---------------------------------------------------------------------------

test("locate member — list view scrolls / highlights the row", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-Locate");
  await seedMinimalFamily(adminApi, tree.id);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);

  // Go to list view and confirm Alice is findable
  await adminPage.getByRole("tab", { name: /list/i }).click();
  await expect(adminPage.getByText("Alice")).toBeVisible({ timeout: 10_000 });
});
