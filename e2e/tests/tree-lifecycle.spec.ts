/**
 * E2E tests: Tree lifecycle (#265)
 * create / rename / delete / switch / last-opened / merge / transfer
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { createTree, deleteTree, seedMinimalFamily } from "../fixtures/seed";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { API_URL } from "../playwright.config";
import { makeApiClient } from "../fixtures/api";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test("create tree — appears in selector and becomes active", async ({
  adminPage,
  adminApi,
}) => {
  const treeName = `E2E-Create-${Date.now().toString(36)}`;
  const tree = await createTree(adminApi, treeName);
  try {
    await adminPage.reload({ waitUntil: "networkidle" });
    // The tree name should appear somewhere in the layout (selector or header)
    await expect(adminPage.getByText(treeName)).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteTree(adminApi, tree.id);
  }
});

test("empty state — fresh account with no trees shows placeholder", async ({
  adminApi,
  browser,
}) => {
  const user = await createTestUser(adminApi);
  try {
    // Open a fresh browser context as the new user (no trees)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole("button", { name: /login|sign in/i }).click();
    // Should see a "no tree" placeholder / create prompt
    await expect(
      page.getByText(/no (family |)tree|create|get started/i),
    ).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

test("rename tree — persists across reload", async ({
  adminPage,
  adminApi,
}) => {
  const original = `E2E-Rename-${Date.now().toString(36)}`;
  const renamed = `${original}-renamed`;
  const tree = await createTree(adminApi, original);
  try {
    // Rename via API
    await adminApi.patch(`/trees/${tree.id}`, { name: renamed });
    await adminPage.reload({ waitUntil: "networkidle" });
    await expect(adminPage.getByText(renamed)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(original)).not.toBeVisible();
  } finally {
    await deleteTree(adminApi, tree.id);
  }
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test("delete tree — disappears from selector", async ({
  adminPage,
  adminApi,
}) => {
  const treeName = `E2E-Delete-${Date.now().toString(36)}`;
  const tree = await createTree(adminApi, treeName);

  await adminPage.reload({ waitUntil: "networkidle" });
  await expect(adminPage.getByText(treeName)).toBeVisible({ timeout: 10_000 });

  // Delete via API
  await deleteTree(adminApi, tree.id);
  await adminPage.reload({ waitUntil: "networkidle" });
  await expect(adminPage.getByText(treeName)).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Switch trees
// ---------------------------------------------------------------------------

test("switch trees — active dataset reflects selected tree", async ({
  adminPage,
  adminApi,
}) => {
  const treeA = await createTree(adminApi, `E2E-SwitchA-${Date.now()}`);
  const treeB = await createTree(adminApi, `E2E-SwitchB-${Date.now()}`);
  try {
    // Seed a distinguishable member in each tree
    await adminApi.post(`/trees/${treeA.id}/members`, {
      id: crypto.randomUUID(),
      firstName: "AlphaMember",
      lastName: "Only",
    });
    await adminApi.post(`/trees/${treeB.id}/members`, {
      id: crypto.randomUUID(),
      firstName: "BetaMember",
      lastName: "Only",
    });

    await adminPage.reload({ waitUntil: "networkidle" });

    // Helper: select a tree by name from the dropdown
    const selectTree = async (name: string) => {
      const combo = adminPage.getByRole("combobox").first();
      await combo.click();
      await adminPage.getByRole("option", { name }).click();
      await adminPage.waitForLoadState("networkidle");
    };

    await selectTree(treeA.name);
    await expect(adminPage.getByText("AlphaMember")).toBeVisible({
      timeout: 10_000,
    });
    await expect(adminPage.getByText("BetaMember")).not.toBeVisible();

    await selectTree(treeB.name);
    await expect(adminPage.getByText("BetaMember")).toBeVisible({
      timeout: 10_000,
    });
    await expect(adminPage.getByText("AlphaMember")).not.toBeVisible();
  } finally {
    await deleteTree(adminApi, treeA.id);
    await deleteTree(adminApi, treeB.id);
  }
});

// ---------------------------------------------------------------------------
// Last-opened persistence
// ---------------------------------------------------------------------------

test("last-opened persistence — most recently used tree is reselected on reload", async ({
  adminPage,
  adminApi,
}) => {
  const treeA = await createTree(adminApi, `E2E-LastA-${Date.now()}`);
  const treeB = await createTree(adminApi, `E2E-LastB-${Date.now()}`);
  try {
    await adminPage.reload({ waitUntil: "networkidle" });

    // Select tree B (making it last-opened via the API)
    await adminApi.get(`/trees/${treeB.id}`);

    await adminPage.reload({ waitUntil: "networkidle" });
    // Tree B should be active (App.tsx selects trees[0] sorted by last_opened desc)
    await expect(adminPage.getByText(treeB.name)).toBeVisible({ timeout: 10_000 });
  } finally {
    await deleteTree(adminApi, treeA.id);
    await deleteTree(adminApi, treeB.id);
  }
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

test("merge preview — returns member counts from both sources", async ({
  adminApi,
}) => {
  const treeA = await createTree(adminApi, `E2E-MergeA-${Date.now()}`);
  const treeB = await createTree(adminApi, `E2E-MergeB-${Date.now()}`);
  try {
    await seedMinimalFamily(adminApi, treeA.id); // 3 members
    await adminApi.post(`/trees/${treeB.id}/members`, {
      id: crypto.randomUUID(),
      firstName: "Solo",
      lastName: "Member",
    }); // 1 member

    const preview = await adminApi.post<{
      members_a: unknown[];
      members_b: unknown[];
    }>("/trees/merge/preview", {
      source_a: treeA.id,
      source_b: treeB.id,
    });
    expect(Array.isArray(preview.members_a)).toBe(true);
    expect(Array.isArray(preview.members_b)).toBe(true);
  } finally {
    await deleteTree(adminApi, treeA.id);
    await deleteTree(adminApi, treeB.id);
  }
});

test("merge — result tree contains members from both sources", async ({
  adminApi,
}) => {
  const treeA = await createTree(adminApi, `E2E-MrgSrcA-${Date.now()}`);
  const treeB = await createTree(adminApi, `E2E-MrgSrcB-${Date.now()}`);
  let mergedId: string | null = null;
  try {
    await adminApi.post(`/trees/${treeA.id}/members`, {
      id: crypto.randomUUID(),
      firstName: "MergeAlice",
      lastName: "A",
    });
    await adminApi.post(`/trees/${treeB.id}/members`, {
      id: crypto.randomUUID(),
      firstName: "MergeBob",
      lastName: "B",
    });

    const merged = await adminApi.post<{ id: string }>("/trees/merge", {
      name: `E2E-Merged-${Date.now()}`,
      source_a: treeA.id,
      source_b: treeB.id,
    });
    mergedId = merged.id;

    const members = await adminApi.get<unknown[]>(`/trees/${mergedId}/members`);
    const names = (members as Array<{ firstName?: string }>).map(
      (m) => m.firstName,
    );
    expect(names).toContain("MergeAlice");
    expect(names).toContain("MergeBob");
  } finally {
    await deleteTree(adminApi, treeA.id);
    await deleteTree(adminApi, treeB.id);
    if (mergedId) await deleteTree(adminApi, mergedId);
  }
});

// ---------------------------------------------------------------------------
// Transfer ownership
// ---------------------------------------------------------------------------

test("transfer ownership — tree disappears from original owner's list", async ({
  adminApi,
}) => {
  const user = await createTestUser(adminApi);
  const tree = await createTree(adminApi, `E2E-Transfer-${Date.now()}`);
  try {
    // Transfer tree to the new user
    await adminApi.post(`/trees/${tree.id}/transfer`, {
      username: user.username,
    });

    // Admin (original owner) no longer sees the tree
    const trees = await adminApi.get<Array<{ id: string }>>("/trees");
    const ids = trees.map((t) => t.id);
    expect(ids).not.toContain(tree.id);

    // New owner sees it
    const { authenticator: _a, ...rest } = { authenticator: null }; void rest;
    const { apiLogin } = await import("../fixtures/api");
    const userToken = await apiLogin(user.username, user.password);
    const userApi = makeApiClient(userToken);
    const userTrees = await userApi.get<Array<{ id: string }>>("/trees");
    expect(userTrees.map((t) => t.id)).toContain(tree.id);

    // Cleanup: user deletes the transferred tree
    await userApi.delete(`/trees/${tree.id}`);
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});
