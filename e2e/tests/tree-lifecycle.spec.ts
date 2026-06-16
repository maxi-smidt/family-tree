/**
 * #265 - Tree lifecycle: create / rename / delete / switch / last-opened /
 * merge / transfer.
 *
 * UI cases use a fresh account so parallel workers cannot perturb tree ordering
 * through the shared admin account. API assertions verify the persisted result
 * behind each user-visible transition.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { apiLogin, makeApiClient } from "../fixtures/api";
import type { ApiClient } from "../fixtures/api";
import { createMember, createTree, deleteTree } from "../fixtures/seed";
import type { TreeRecord } from "../fixtures/seed";
import { createTestUser, deleteTestUser } from "../fixtures/users";

interface LoginUser {
  username: string;
  password: string;
}

interface TreeListItem extends TreeRecord {
  role: string;
  last_opened?: string | null;
}

interface MergePreview {
  total_members: number;
  merged_count: number;
  duplicates: unknown[];
}

interface MemberName {
  firstName?: string | null;
  lastName?: string | null;
}

async function loginAs(page: Page, user: LoginUser): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#username")).not.toBeVisible({ timeout: 15_000 });
}

async function selectTree(page: Page, name: string): Promise<void> {
  const selector = page.locator('[data-testid="tree-selector"]');
  await expect(selector).toBeVisible({ timeout: 15_000 });
  await selector.click();

  const option = page.getByRole("option").filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(selector).toContainText(name, { timeout: 15_000 });
}

async function openTreeManagement(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Tree Management", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tree Management", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

async function cleanupTrees(
  api: ApiClient,
  treeIds: Array<string | undefined>,
): Promise<void> {
  for (const treeId of treeIds) {
    if (!treeId) continue;
    try {
      await deleteTree(api, treeId);
    } catch {
      // A UI delete or ownership transfer may already have removed access.
    }
  }
}

test("empty state and create: a new tree becomes active and persists", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const treeName = `Lifecycle-Create-${crypto.randomUUID().slice(0, 8)}`;
  let created: TreeListItem | undefined;

  try {
    await loginAs(page, secondUser);

    await expect(page.getByText("No Trees Yet", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const createButton = page.getByRole("button", {
      name: "Create Tree",
      exact: true,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/trees"),
    );
    await page.locator("#databaseName").fill(treeName);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    created = (await createResponse.json()) as TreeListItem;

    await expect(page.getByText("No Trees Yet", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      treeName,
      { timeout: 15_000 },
    );

    const trees = await secondApi.get<TreeListItem[]>("/trees");
    expect(trees.find((tree) => tree.id === created?.id)).toMatchObject({
      name: treeName,
      role: "owner",
    });
  } finally {
    await cleanupTrees(secondApi, [created?.id]);
  }
});

test("rename: the selector updates and the name survives reload", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const original = `Lifecycle-Rename-${crypto.randomUUID().slice(0, 8)}`;
  const renamed = `${original}-Updated`;
  const tree = await createTree(secondApi, original);

  try {
    await loginAs(page, secondUser);
    await openTreeManagement(page);

    const row = page.getByRole("row").filter({ hasText: original });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();

    const renameResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith(`/api/trees/${tree.id}`),
    );
    const nameInput = page.getByRole("textbox");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(renamed);
    await nameInput.press("Enter");

    const renameResponse = await renameResponsePromise;
    expect(renameResponse.ok()).toBe(true);
    expect((await renameResponse.json()) as TreeListItem).toMatchObject({
      id: tree.id,
      name: renamed,
    });

    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      renamed,
      { timeout: 15_000 },
    );

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      renamed,
      { timeout: 15_000 },
    );

    const persisted = await secondApi.get<TreeListItem>(`/trees/${tree.id}`);
    expect(persisted.name).toBe(renamed);
  } finally {
    await cleanupTrees(secondApi, [tree.id]);
  }
});

test("delete: the active tree disappears and another tree is selected", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const removed = await createTree(
    secondApi,
    `Lifecycle-Delete-${crypto.randomUUID().slice(0, 8)}`,
  );
  const fallback = await createTree(
    secondApi,
    `Lifecycle-Fallback-${crypto.randomUUID().slice(0, 8)}`,
  );

  try {
    await loginAs(page, secondUser);
    await openTreeManagement(page);

    const row = page.getByRole("row").filter({ hasText: removed.name });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Remove tree" });
    await expect(dialog).toBeVisible();
    await dialog.locator("#databaseName").fill(removed.name);

    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname.endsWith(`/api/trees/${removed.id}`),
    );
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    expect((await deleteResponsePromise).status()).toBe(204);

    await expect(row).toHaveCount(0);
    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      fallback.name,
      { timeout: 15_000 },
    );

    const trees = await secondApi.get<TreeListItem[]>("/trees");
    expect(trees.some((tree) => tree.id === removed.id)).toBe(false);
    expect(trees.some((tree) => tree.id === fallback.id)).toBe(true);
  } finally {
    await cleanupTrees(secondApi, [removed.id, fallback.id]);
  }
});

test("switch: selecting another tree swaps the visible member dataset", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const treeA = await createTree(
    secondApi,
    `Lifecycle-Switch-A-${crypto.randomUUID().slice(0, 8)}`,
  );
  const treeB = await createTree(
    secondApi,
    `Lifecycle-Switch-B-${crypto.randomUUID().slice(0, 8)}`,
  );
  await createMember(secondApi, treeA.id, {
    firstName: "LifecycleAlpha",
    lastName: "Only",
  });
  await createMember(secondApi, treeB.id, {
    firstName: "LifecycleBravo",
    lastName: "Only",
  });

  try {
    await loginAs(page, secondUser);

    await selectTree(page, treeA.name);
    await page.getByRole("tab", { name: "List", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "LifecycleAlpha", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("cell", { name: "LifecycleBravo", exact: true }),
    ).toHaveCount(0);

    await selectTree(page, treeB.name);
    await expect(
      page.getByRole("cell", { name: "LifecycleBravo", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("cell", { name: "LifecycleAlpha", exact: true }),
    ).toHaveCount(0);
  } finally {
    await cleanupTrees(secondApi, [treeA.id, treeB.id]);
  }
});

test("last-opened: the most recently selected tree is restored after reload", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const treeA = await createTree(
    secondApi,
    `Lifecycle-Last-A-${crypto.randomUUID().slice(0, 8)}`,
  );
  const treeB = await createTree(
    secondApi,
    `Lifecycle-Last-B-${crypto.randomUUID().slice(0, 8)}`,
  );

  try {
    await loginAs(page, secondUser);
    await selectTree(page, treeA.name);

    await expect
      .poll(async () => {
        const trees = await secondApi.get<TreeListItem[]>("/trees");
        return trees[0]?.id;
      })
      .toBe(treeA.id);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      treeA.name,
      { timeout: 15_000 },
    );
  } finally {
    await cleanupTrees(secondApi, [treeA.id, treeB.id]);
  }
});

test("merge: the wizard previews and creates the union of both trees", async ({
  page,
  secondUser,
  secondApi,
}) => {
  const sourceA = await createTree(
    secondApi,
    `Lifecycle-Merge-A-${crypto.randomUUID().slice(0, 8)}`,
  );
  const sourceB = await createTree(
    secondApi,
    `Lifecycle-Merge-B-${crypto.randomUUID().slice(0, 8)}`,
  );
  const mergedName = `Lifecycle-Merged-${crypto.randomUUID().slice(0, 8)}`;
  let merged: TreeRecord | undefined;

  await createMember(secondApi, sourceA.id, {
    firstName: "Anders",
    lastName: "Aaberg",
  });
  await createMember(secondApi, sourceA.id, {
    firstName: "Astrid",
    lastName: "Aaberg",
  });
  await createMember(secondApi, sourceB.id, {
    firstName: "Bjorn",
    lastName: "Bakke",
  });

  try {
    await loginAs(page, secondUser);
    await openTreeManagement(page);
    await page.getByRole("button", { name: "Merge", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Merge Trees" });
    await expect(dialog).toBeVisible();
    const sourceSelectors = dialog.getByRole("combobox");

    await sourceSelectors.nth(0).click();
    await page.getByRole("option").filter({ hasText: sourceA.name }).click();

    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/trees/merge/preview"),
    );
    await sourceSelectors.nth(1).click();
    await page.getByRole("option").filter({ hasText: sourceB.name }).click();

    const previewResponse = await previewResponsePromise;
    expect(previewResponse.ok()).toBe(true);
    expect((await previewResponse.json()) as MergePreview).toEqual({
      total_members: 3,
      merged_count: 3,
      duplicates: [],
    });
    await expect(
      dialog.getByText("No Duplicates", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await dialog.locator("#new-db-name").fill(mergedName);
    const mergeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/trees/merge"),
    );
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();

    const mergeResponse = await mergeResponsePromise;
    expect(mergeResponse.status()).toBe(201);
    merged = (await mergeResponse.json()) as TreeRecord;

    await expect(page.locator('[data-testid="tree-selector"]')).toContainText(
      mergedName,
      { timeout: 15_000 },
    );

    const members = await secondApi.get<MemberName[]>(
      `/trees/${merged.id}/members`,
    );
    const names = members
      .map((member) => `${member.firstName} ${member.lastName}`)
      .sort();
    expect(names).toEqual(["Anders Aaberg", "Astrid Aaberg", "Bjorn Bakke"]);
  } finally {
    await cleanupTrees(secondApi, [sourceA.id, sourceB.id, merged?.id]);
  }
});

test("transfer: a friend becomes owner and the original owner loses access", async ({
  adminApi,
  secondUser,
  secondApi,
}) => {
  const recipient = await createTestUser(adminApi);
  let recipientApi: ApiClient | undefined;
  const tree = await createTree(
    secondApi,
    `Lifecycle-Transfer-${crypto.randomUUID().slice(0, 8)}`,
  );

  try {
    recipientApi = makeApiClient(
      await apiLogin(recipient.username, recipient.password),
    );

    await secondApi.post("/friends/requests", {
      username: recipient.username,
    });
    await recipientApi.post(`/friends/${secondUser.id}/accept`);

    const access = await secondApi.post<
      Array<{ user_id: string; username: string; role: string }>
    >(`/trees/${tree.id}/transfer`, {
      username: recipient.username,
    });
    expect(access).toContainEqual(expect.objectContaining({
      user_id: recipient.id,
      username: recipient.username,
      role: "owner",
    }));

    const recipientTrees = await recipientApi.get<TreeListItem[]>("/trees");
    expect(recipientTrees.find((item) => item.id === tree.id)).toMatchObject({
      name: tree.name,
      role: "owner",
    });

    const previousOwnerTrees = await secondApi.get<TreeListItem[]>("/trees");
    expect(previousOwnerTrees.some((item) => item.id === tree.id)).toBe(false);
  } finally {
    if (recipientApi) await cleanupTrees(recipientApi, [tree.id]);
    await cleanupTrees(secondApi, [tree.id]);
    await cleanupTrees(adminApi, [tree.id]);
    await deleteTestUser(adminApi, recipient.id);
  }
});
