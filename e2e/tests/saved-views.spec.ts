/**
 * E2E tests: saved views — create, open (re-centers on the focus person),
 * and edit (#1013/#992).
 */

import type { Page } from "@playwright/test";
import { expect, test as base } from "../fixtures";
import type { TreeRecord } from "../fixtures";
import {
  createMember,
  createRelation,
  createTree,
  deleteTree,
} from "../fixtures/seed";
import { loginAs } from "../fixtures/ui";

const test = base.extend<{ ownedTree: TreeRecord }>({
  ownedTree: async ({ secondApi }, use) => {
    const tree = await createTree(secondApi);
    await use(tree);
    try {
      await deleteTree(secondApi, tree.id);
    } catch {
      // The account or tree may already have been removed by the test.
    }
  },
});

async function login(page: Page, user: import("../fixtures").UserRecord) {
  await loginAs(page, user);
  await expect(page.getByLabel("Family tree canvas")).toBeVisible({
    timeout: 15_000,
  });
}

function memberNode(page: Page, memberId: string) {
  return page.locator(`.react-flow__node[data-id="${memberId}"]`);
}

test("create, open, and edit a saved view", async ({
  page,
  secondUser,
  secondApi,
  ownedTree: tree,
}) => {
  const alice = await createMember(secondApi, tree.id, {
    firstName: "Alice",
    lastName: "Connected",
  });
  const bob = await createMember(secondApi, tree.id, {
    firstName: "Bob",
    lastName: "Connected",
  });
  await createRelation(secondApi, tree.id, alice.id, bob.id, "partner");
  // Unrelated to Alice/Bob — focusing on her narrows the canvas down to
  // just herself, which is what makes "opening the view re-centers"
  // observable below.
  const carol = await createMember(secondApi, tree.id, {
    firstName: "Carol",
    lastName: "Standalone",
  });

  await login(page, secondUser);
  // The default unwindowed view has every member resident on the canvas —
  // the focus-person picker only offers members already resident there.
  await expect(memberNode(page, carol.id)).toBeVisible();

  await page.getByRole("button", { name: "Create saved view" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create saved view" });
  await createDialog.locator("#saved-view-name").fill("Carol's View");
  await createDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: /Carol Standalone/ }).click();
  await createDialog
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(createDialog).not.toBeVisible();

  // Creating it opens it immediately: the canvas narrows to Carol alone.
  await expect(memberNode(page, carol.id)).toBeVisible();
  await expect(memberNode(page, alice.id)).toHaveCount(0);
  await expect(
    page.locator("li").filter({ hasText: "Carol's View" }),
  ).toBeVisible();

  // Navigate away, then re-open the saved view — it re-centers again.
  await page.getByText("Explore", { exact: true }).click();
  await expect(memberNode(page, alice.id)).toBeVisible();

  await page.locator("li").filter({ hasText: "Carol's View" }).click();
  await expect(memberNode(page, carol.id)).toBeVisible();
  await expect(memberNode(page, alice.id)).toHaveCount(0);

  // Edit: rename it.
  const row = page.locator("li").filter({ hasText: "Carol's View" });
  await row.hover();
  await row.getByRole("button", { name: "Actions for Carol's View" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit saved view" });
  await expect(editDialog.locator("#saved-view-name")).toHaveValue(
    "Carol's View",
  );
  await editDialog.locator("#saved-view-name").fill("Renamed View");
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editDialog).not.toBeVisible();

  await expect(
    page.locator("li").filter({ hasText: "Renamed View" }),
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Carol's View" }),
  ).toHaveCount(0);
});
