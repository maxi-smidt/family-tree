/**
 * E2E tests: workspace sections — create/preview, a shared member's edits
 * staying visible across every section they belong to, and delete
 * (including the dependents-blocked path) (#982/#990/#992).
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { ApiClient, TreeRecord, UserRecord } from "../fixtures";
import {
  createMember,
  createRelation,
  createTree,
  deleteTree,
} from "../fixtures/seed";
import { loginAs } from "../fixtures/ui";

const sectionsTest = test.extend<{ ownedTree: TreeRecord }>({
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

async function login(page: Page, user: UserRecord) {
  await loginAs(page, user);
  await expect(page.getByLabel("Family tree canvas")).toBeVisible({
    timeout: 15_000,
  });
}

function memberNode(page: Page, memberId: string) {
  return page.locator(`.react-flow__node[data-id="${memberId}"]`);
}

async function createSection(
  page: Page,
  name: string,
  seedPersonName?: string,
) {
  await page.getByRole("button", { name: "Create section" }).click();
  const dialog = page.getByRole("dialog", { name: "Create section" });
  await dialog.locator("#new-section-name").fill(name);
  if (seedPersonName) {
    await dialog.getByRole("combobox").click();
    await page
      .getByRole("option", { name: new RegExp(seedPersonName) })
      .click();
  }
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

function sectionRow(page: Page, name: string) {
  return page.locator("li").filter({ hasText: name });
}

async function openSectionActions(page: Page, name: string) {
  const row = sectionRow(page, name);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${name}` }).click();
}

async function seedFamily(api: ApiClient, workspaceId: string) {
  const alice = await createMember(api, workspaceId, {
    firstName: "Alice",
    lastName: "Smith",
    gender: "f",
  });
  const bob = await createMember(api, workspaceId, {
    firstName: "Bob",
    lastName: "Smith",
    gender: "m",
  });
  await createRelation(api, workspaceId, alice.id, bob.id, "partner");
  const charlie = await createMember(api, workspaceId, {
    firstName: "Charlie",
    lastName: "Smith",
    gender: "m",
  });
  // relation_type "parent" reads from=child, to=parent (see
  // app/services/workspaces/subtree_selection.py).
  await createRelation(api, workspaceId, charlie.id, alice.id, "parent");
  return { alice, bob, charlie };
}

sectionsTest(
  "create — seeding from a person previews primary/boundary counts and creates the section",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    await seedFamily(secondApi, ownedTree.id);
    await login(page, secondUser);

    await page.getByRole("button", { name: "Create section" }).click();
    const dialog = page.getByRole("dialog", { name: "Create section" });
    await dialog.locator("#new-section-name").fill("Alice Origin");

    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /Alice Smith/ }).click();

    // direct_family is the default: Alice has no parents seeded, so the
    // preview's boundary is her partner + child, and primary is just her.
    await expect(
      dialog.getByText("1 primary members, 2 boundary people"),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    const row = sectionRow(page, "Alice Origin");
    await expect(row).toBeVisible();
    await expect(row.getByText("1", { exact: true })).toBeVisible();
  },
);

sectionsTest(
  "a member shared across sections shows the same edited data in each",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const { alice } = await seedFamily(secondApi, ownedTree.id);
    await login(page, secondUser);

    await createSection(page, "Family A", "Alice Smith");
    await createSection(page, "Family B"); // empty — Alice is added below

    await openSectionActions(page, "Family B");
    await page.getByRole("menuitem", { name: "Edit members" }).click();
    const membersDialog = page.getByRole("dialog", { name: /Members of/ });
    await membersDialog
      .getByPlaceholder("Search this workspace to add someone…")
      .fill("Alice");
    await membersDialog.getByRole("button", { name: /Alice Smith/ }).click();
    await membersDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(membersDialog).not.toBeVisible();

    // Edit Alice while "Family A" is the active section.
    await sectionRow(page, "Family A").click();
    await expect(memberNode(page, alice.id)).toBeVisible();
    await memberNode(page, alice.id)
      .getByRole("button", { name: "Edit member" })
      .click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response
          .url()
          .endsWith(`/api/workspaces/${ownedTree.id}/members/${alice.id}`),
    );
    await sheet.locator("#firstName").fill("Alicia");
    await updateResponse;
    await expect(memberNode(page, alice.id)).toContainText("Alicia");
    await page.keyboard.press("Escape");

    // "Family B" — a different section Alice also belongs to — shows the edit.
    await sectionRow(page, "Family B").click();
    await expect(memberNode(page, alice.id)).toContainText("Alicia");
  },
);

sectionsTest(
  "delete — an empty section deletes; a section with a scoped invitation is blocked",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    await seedFamily(secondApi, ownedTree.id);
    await login(page, secondUser);

    await createSection(page, "Deletable", "Alice Smith");
    await openSectionActions(page, "Deletable");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    let alert = page.getByRole("alertdialog");
    await expect(
      alert.getByText("1 members keep their records", { exact: false }),
    ).toBeVisible();
    await alert.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(alert).not.toBeVisible();
    await expect(
      page.getByText("Deletable", { exact: true }),
    ).not.toBeVisible();

    // A second section with a scoped pending invitation cannot be deleted
    // until that invitation is resolved.
    await createSection(page, "Blocked");
    const sections = await secondApi.get<Array<{ id: string; name: string }>>(
      `/workspaces/${ownedTree.id}/sections`,
    );
    const blockedSection = sections.find((s) => s.name === "Blocked");
    await secondApi.post(`/workspaces/${ownedTree.id}/invitations`, {
      role: "viewer",
      section_id: blockedSection?.id,
    });

    await openSectionActions(page, "Blocked");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    alert = page.getByRole("alertdialog");
    await expect(
      alert.getByText("still holds things that need to be resolved first", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      alert.getByText("1 pending invitation(s)", { exact: false }),
    ).toBeVisible();
    await expect(
      alert.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    await alert.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  },
);
