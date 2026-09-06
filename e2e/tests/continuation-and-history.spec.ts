/**
 * E2E tests: inline generation expansion inside a focused section, and
 * browser back/forward restoring the previous focus (#989/#992).
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
import { loginAs, searchWorkspaceAndSelect } from "../fixtures/ui";

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

test("expand next generation reveals an ancestor outside the default depth window", async ({
  page,
  secondUser,
  secondApi,
  ownedTree: tree,
}) => {
  // A vertical chain 4 generations above the focus. The default windowed
  // neighborhood only reaches 3 generations up/down from the focus, so
  // "ancestor" (4 up) starts outside it and only appears once expanded.
  const ancestor = await createMember(secondApi, tree.id, {
    firstName: "Ancestor",
    lastName: "Chain",
  });
  const gen1 = await createMember(secondApi, tree.id, {
    firstName: "Gen1",
    lastName: "Chain",
  });
  const gen2 = await createMember(secondApi, tree.id, {
    firstName: "Gen2",
    lastName: "Chain",
  });
  const gen3 = await createMember(secondApi, tree.id, {
    firstName: "Gen3",
    lastName: "Chain",
  });
  const focus = await createMember(secondApi, tree.id, {
    firstName: "Focus",
    lastName: "Chain",
  });
  await createRelation(secondApi, tree.id, gen1.id, ancestor.id, "parent");
  await createRelation(secondApi, tree.id, gen2.id, gen1.id, "parent");
  await createRelation(secondApi, tree.id, gen3.id, gen2.id, "parent");
  await createRelation(secondApi, tree.id, focus.id, gen3.id, "parent");

  await login(page, secondUser);

  await searchWorkspaceAndSelect(page, "Focus Chain", /Focus Chain/);

  await expect(memberNode(page, focus.id)).toBeVisible();
  await expect(memberNode(page, gen3.id)).toBeVisible();
  await expect(memberNode(page, gen2.id)).toBeVisible();
  await expect(memberNode(page, gen1.id)).toBeVisible();
  await expect(memberNode(page, ancestor.id)).toHaveCount(0);

  await page.getByRole("button", { name: "Expand next generation" }).click();
  await expect(memberNode(page, ancestor.id)).toBeVisible();
});

test("browser back/forward restores the previously focused section", async ({
  page,
  secondUser,
  secondApi,
  ownedTree: tree,
}) => {
  const alice = await createMember(secondApi, tree.id, {
    firstName: "Alice",
    lastName: "History",
  });
  const bob = await createMember(secondApi, tree.id, {
    firstName: "Bob",
    lastName: "History",
  });

  await login(page, secondUser);

  for (const name of ["Alice History", "Bob History"]) {
    await page.getByRole("button", { name: "Create section" }).click();
    const dialog = page.getByRole("dialog", { name: "Create section" });
    await dialog
      .locator("#new-section-name")
      .fill(name.startsWith("Alice") ? "Alice Section" : "Bob Section");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }

  await page.locator("li").filter({ hasText: "Alice Section" }).click();
  await expect(memberNode(page, alice.id)).toBeVisible();
  await expect(memberNode(page, bob.id)).toHaveCount(0);

  await page.locator("li").filter({ hasText: "Bob Section" }).click();
  await expect(memberNode(page, bob.id)).toBeVisible();
  await expect(memberNode(page, alice.id)).toHaveCount(0);

  await page.goBack();
  await expect(memberNode(page, alice.id)).toBeVisible();
  await expect(memberNode(page, bob.id)).toHaveCount(0);

  await page.goForward();
  await expect(memberNode(page, bob.id)).toBeVisible();
  await expect(memberNode(page, alice.id)).toHaveCount(0);
});
