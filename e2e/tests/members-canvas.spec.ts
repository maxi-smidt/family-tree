/**
 * E2E tests: member and relation workflows on the React Flow canvas (#266).
 *
 * API calls arrange isolated tree shapes; assertions and mutations exercise
 * the canvas UI and use stable React Flow node/edge IDs instead of coordinates.
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

interface MemberDetails {
  id: string;
  firstName: string | null;
  middleNames: string | null;
  lastName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  deceased: boolean;
  additionalData: string | null;
  birthplace: string | null;
  hometown: string | null;
  isCollapsed: boolean;
}

interface DiseaseRecord {
  id: string;
  member_id: string;
  name: string;
  notes: string | null;
}

const canvasTest = test.extend<{ ownedTree: TreeRecord }>({
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
  await page.goto("/");
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#username")).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Family tree canvas")).toBeVisible({
    timeout: 15_000,
  });
}

function memberNode(page: Page, memberId: string) {
  return page.locator(`.react-flow__node[data-id="${memberId}"]`);
}

function edge(page: Page, edgeId: string) {
  return page.locator(`.react-flow__edge[data-id="${edgeId}"]`);
}

function unionId(firstId: string, secondId: string) {
  return `union-${[firstId, secondId].sort().join("-")}`;
}

async function getMembers(api: ApiClient, treeId: string) {
  return api.get<MemberDetails[]>(`/trees/${treeId}/members`);
}

canvasTest(
  "adds a canvas node and supports undo and redo",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    await login(page, secondUser);

    await page.getByRole("button", { name: "Add first person" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet.getByText("Edit Member")).toBeVisible();
    await sheet.locator("#firstName").fill("Ada");
    await sheet.locator("#lastName").fill("Lovelace");
    await sheet.getByLabel("Female").click();

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/trees/${ownedTree.id}/members`),
    );
    await sheet.getByRole("button", { name: "Save" }).click();
    const created = (await (await createResponse).json()) as { id: string };

    await expect(memberNode(page, created.id)).toContainText("Ada");
    await expect(memberNode(page, created.id)).toContainText("Lovelace");

    const undo = page.getByRole("button", { name: "Undo (Ctrl+Z)" });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(memberNode(page, created.id)).toHaveCount(0);
    await expect(await getMembers(secondApi, ownedTree.id)).toHaveLength(0);

    const redo = page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" });
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(memberNode(page, created.id)).toBeVisible();
    await expect(await getMembers(secondApi, ownedTree.id)).toHaveLength(1);
  },
);

canvasTest(
  "edits identity, life dates, and biographical fields",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const member = await createMember(secondApi, ownedTree.id, {
      firstName: "Before",
      lastName: "Edit",
      positionX: 400,
      positionY: 250,
    });
    await login(page, secondUser);

    await memberNode(page, member.id)
      .getByRole("button", { name: "Edit member" })
      .click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.locator("#firstName").fill("After");
    await sheet.locator("#middleNames").fill("Grace");
    await sheet.locator("#lastName").fill("Hopper");
    await sheet.getByLabel("Female").click();

    await sheet.getByRole("tab", { name: "Life" }).click();
    await sheet.locator("#birthplace").fill("New York");
    await sheet.locator("#hometown").fill("Arlington");

    const birthField = sheet
      .locator('[data-slot="field"]')
      .filter({ hasText: "Date of Birth" });
    await birthField.getByRole("button").click();
    let popover = page.locator('[data-slot="popover-content"]');
    await popover.getByRole("button", { name: "Y", exact: true }).click();
    await popover.getByRole("button", { name: "2020", exact: true }).click();

    await sheet.getByRole("switch").click();
    const deathField = sheet
      .locator('[data-slot="field"]')
      .filter({ hasText: "Date of Death" });
    await deathField.getByRole("button").click();
    popover = page.locator('[data-slot="popover-content"]');
    await popover.getByRole("button", { name: "Y", exact: true }).click();
    await popover.getByRole("button", { name: "2024", exact: true }).click();

    await sheet.locator("#additionalData").fill("Compiler pioneer");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response
          .url()
          .endsWith(`/api/trees/${ownedTree.id}/members/${member.id}`),
    );
    await sheet.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    await expect(memberNode(page, member.id)).toContainText("After");
    await expect(memberNode(page, member.id)).toContainText("Hopper");
    await expect(memberNode(page, member.id)).toContainText("2020");
    await expect(memberNode(page, member.id)).toContainText("2024");

    const saved = (await getMembers(secondApi, ownedTree.id))[0];
    expect(saved).toMatchObject({
      firstName: "After",
      middleNames: "Grace",
      lastName: "Hopper",
      gender: "f",
      dateOfBirth: "2020",
      dateOfDeath: "2024",
      deceased: true,
      additionalData: "Compiler pioneer",
      birthplace: "New York",
      hometown: "Arlington",
    });
  },
);

canvasTest(
  "renders partner and parent relations and removes their edges",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const partnerA = await createMember(secondApi, ownedTree.id, {
      firstName: "Partner",
      lastName: "One",
      positionX: 100,
      positionY: 150,
    });
    const partnerB = await createMember(secondApi, ownedTree.id, {
      firstName: "Partner",
      lastName: "Two",
      positionX: 650,
      positionY: 150,
    });
    const parent = await createMember(secondApi, ownedTree.id, {
      firstName: "Parent",
      lastName: "Person",
      gender: "m",
      positionX: 250,
      positionY: 450,
    });
    const child = await createMember(secondApi, ownedTree.id, {
      firstName: "Child",
      lastName: "Person",
      positionX: 250,
      positionY: 700,
    });
    await createRelation(
      secondApi,
      ownedTree.id,
      partnerA.id,
      partnerB.id,
      "partner",
    );
    await createRelation(
      secondApi,
      ownedTree.id,
      child.id,
      parent.id,
      "parent",
    );

    await login(page, secondUser);

    const partnerUnion = unionId(partnerA.id, partnerB.id);
    await expect(memberNode(page, partnerUnion)).toBeVisible();
    await expect(edge(page, `ue:${partnerUnion}:left`)).toHaveCount(1);
    await expect(edge(page, `ue:${partnerUnion}:right`)).toHaveCount(1);
    await expect(edge(page, `e:${parent.id}:${child.id}`)).toHaveCount(1);

    await secondApi.delete(
      `/trees/${ownedTree.id}/relations?from_member_id=${child.id}` +
        `&to_member_id=${parent.id}&relation_type=parent`,
    );
    await page.reload();
    await expect(edge(page, `e:${parent.id}:${child.id}`)).toHaveCount(0);
    await expect(memberNode(page, child.id)).toBeVisible();

    await secondApi.delete(
      `/trees/${ownedTree.id}/relations?from_member_id=${partnerA.id}` +
        `&to_member_id=${partnerB.id}&relation_type=partner`,
    );
    await page.reload();
    await expect(memberNode(page, partnerUnion)).toHaveCount(0);
    await expect(memberNode(page, partnerA.id)).toBeVisible();
    await expect(memberNode(page, partnerB.id)).toBeVisible();
  },
);

canvasTest(
  "deleting a member removes its node and dependent edge",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const parent = await createMember(secondApi, ownedTree.id, {
      firstName: "Delete",
      lastName: "Parent",
      gender: "m",
      positionX: 350,
      positionY: 200,
    });
    const child = await createMember(secondApi, ownedTree.id, {
      firstName: "Keep",
      lastName: "Child",
      positionX: 350,
      positionY: 500,
    });
    await createRelation(
      secondApi,
      ownedTree.id,
      child.id,
      parent.id,
      "parent",
    );
    await login(page, secondUser);

    const parentNode = memberNode(page, parent.id);
    await expect(edge(page, `e:${parent.id}:${child.id}`)).toHaveCount(1);
    await parentNode.click();
    const remove = page.getByRole("button", {
      name: "Remove selected person",
    });
    await expect(remove).toBeEnabled();
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "Delete Member" });
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(parentNode).toHaveCount(0);
    await expect(edge(page, `e:${parent.id}:${child.id}`)).toHaveCount(0);
    await expect(memberNode(page, child.id)).toBeVisible();
  },
);

canvasTest(
  "collapse and expand persist while hiding and restoring descendants",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const parent = await createMember(secondApi, ownedTree.id, {
      firstName: "Collapse",
      lastName: "Parent",
      gender: "f",
      positionX: 350,
      positionY: 200,
    });
    const child = await createMember(secondApi, ownedTree.id, {
      firstName: "Hidden",
      lastName: "Child",
      positionX: 350,
      positionY: 500,
    });
    await createRelation(
      secondApi,
      ownedTree.id,
      child.id,
      parent.id,
      "parent",
    );
    await login(page, secondUser);

    const parentNode = memberNode(page, parent.id);
    const childNode = memberNode(page, child.id);
    await parentNode.click();
    const collapse = page.getByRole("button", { name: "Collapse children" });
    await expect(collapse).toBeEnabled();
    const collapseResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/trees/${ownedTree.id}/members/collapsed`),
    );
    await collapse.click();
    await collapseResponse;
    await expect(childNode).toBeHidden();
    expect(
      (await getMembers(secondApi, ownedTree.id)).find(
        (candidate) => candidate.id === parent.id,
      )?.isCollapsed,
    ).toBe(true);

    await page.reload();
    await expect(childNode).toBeHidden();
    await parentNode.click();
    const expand = page.getByRole("button", { name: "Expand all children" });
    await expect(expand).toBeEnabled();
    const expandResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/trees/${ownedTree.id}/members/collapsed`),
    );
    await expand.click();
    await expandResponse;
    await expect(childNode).toBeVisible();
    expect(
      (await getMembers(secondApi, ownedTree.id)).find(
        (candidate) => candidate.id === parent.id,
      )?.isCollapsed,
    ).toBe(false);
  },
);

canvasTest(
  "adds, edits, and deletes a genetic condition through the UI",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const member = await createMember(secondApi, ownedTree.id, {
      firstName: "Disease",
      lastName: "Record",
      positionX: 400,
      positionY: 250,
    });
    await login(page, secondUser);

    await memberNode(page, member.id)
      .getByRole("button", { name: "Edit member" })
      .click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.getByRole("tab", { name: "Records" }).click();
    const diseases = sheet
      .locator('[data-slot="item"]')
      .filter({ hasText: "Genetic Conditions" });
    await diseases.getByRole("button", { name: "Add", exact: true }).click();

    let dialog = page.getByRole("dialog", { name: "Add Condition" });
    await dialog.locator("#name").fill("Hemophilia");
    await dialog.locator("#notes").fill("Initial note");
    const addResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/trees/${ownedTree.id}/diseases`),
    );
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    const added = (await (await addResponse).json()) as DiseaseRecord;
    await expect(diseases).toContainText("Hemophilia");

    await diseases.getByRole("button", { name: "Edit Condition" }).click();
    dialog = page.getByRole("dialog", { name: "Edit Condition" });
    await dialog.locator("#name").fill("Hemophilia A");
    await dialog.locator("#notes").fill("Updated note");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response
          .url()
          .endsWith(`/api/trees/${ownedTree.id}/diseases/${added.id}`),
    );
    await dialog.getByRole("button", { name: "Update" }).click();
    await updateResponse;
    await expect(diseases).toContainText("Hemophilia A");
    await expect(diseases).toContainText("Updated note");

    await diseases.getByRole("button", { name: "Delete Condition" }).click();
    dialog = page.getByRole("alertdialog", { name: "Delete Condition" });
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response
          .url()
          .endsWith(`/api/trees/${ownedTree.id}/diseases/${added.id}`),
    );
    await dialog.getByRole("button", { name: "Delete" }).click();
    await deleteResponse;
    await expect(diseases).not.toContainText("Hemophilia A");
    expect(
      await secondApi.get<DiseaseRecord[]>(`/trees/${ownedTree.id}/diseases`),
    ).toHaveLength(0);
  },
);

canvasTest(
  "locating a hidden member expands ancestors and highlights the node",
  async ({ page, secondUser, secondApi, ownedTree }) => {
    const parent = await createMember(secondApi, ownedTree.id, {
      firstName: "Search",
      lastName: "Parent",
      gender: "f",
      isCollapsed: true,
      positionX: 350,
      positionY: 200,
    });
    const child = await createMember(secondApi, ownedTree.id, {
      firstName: "Target",
      lastName: "Person",
      positionX: 350,
      positionY: 500,
    });
    await createRelation(
      secondApi,
      ownedTree.id,
      child.id,
      parent.id,
      "parent",
    );
    await login(page, secondUser);

    const childNode = memberNode(page, child.id);
    await expect(childNode).toBeHidden();
    await page.getByPlaceholder("Search members…").fill("Target");
    const expandAncestorResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response
          .url()
          .endsWith(`/api/trees/${ownedTree.id}/members/${parent.id}`),
    );
    await page.getByPlaceholder("Search members…").press("Enter");
    await expandAncestorResponse;

    await expect(childNode).toBeVisible();
    await expect(childNode.locator(".ring-4")).toBeVisible();
    expect(
      (await getMembers(secondApi, ownedTree.id)).find(
        (candidate) => candidate.id === parent.id,
      )?.isCollapsed,
    ).toBe(false);
  },
);
