import { test, expect } from "../fixtures";
import { createMember, createRelation, createTree } from "../fixtures/seed";
import { loginAs } from "../fixtures/ui";

// These assertions check the graph and the persisted scope, not just that a
// dialog accepted settings or that the correct label appears in navigation.
test("saved views restore section, depth, partner settings and layout", async ({
  page,
  secondApi,
  secondUser,
}) => {
  const workspace = await createTree(secondApi);
  const alice = await createMember(secondApi, workspace.id, {
    firstName: "Alice",
    lastName: "Scoped",
  });
  const bob = await createMember(secondApi, workspace.id, {
    firstName: "Bob",
    lastName: "Outside",
  });
  await createRelation(secondApi, workspace.id, alice.id, bob.id);
  const base = `/workspaces/${workspace.id}`;
  const section = await secondApi.post<{ id: string }>(`${base}/sections`, {
    name: "Alice only",
    root_member_id: alice.id,
  });
  const view = await secondApi.post<{ id: string }>(`${base}/saved-views`, {
    name: "Zero depth",
    focus_member_id: alice.id,
    section_ids: [section.id],
    ancestor_depth: 0,
    descendant_depth: 0,
    include_partners: false,
  });
  await secondApi.patch(`${base}/saved-views/${view.id}/positions`, [
    { node_id: alice.id, position_x: 123, position_y: 456 },
  ]);
  await loginAs(page, secondUser);
  await expect(page.getByLabel("Family tree canvas")).toBeVisible({
    timeout: 15000,
  });
  const graph = page.waitForResponse(
    (response) =>
      response.url().includes("/members/neighborhood") &&
      response.url().includes(`root=${alice.id}`),
  );
  await page.locator("li").filter({ hasText: "Zero depth" }).click();
  const response = await graph;
  const graphBody = await response.json();
  expect(graphBody.members.map((member: { id: string }) => member.id)).toEqual([
    alice.id,
  ]);
  const params = new URL(response.url()).searchParams;
  expect(params.get("up")).toBe("0");
  expect(params.get("down")).toBe("0");
  expect(params.get("partners")).toBe("false");
  expect(params.getAll("sections")).toEqual([section.id]);
  await expect(
    page.locator(`.react-flow__node[data-id="${alice.id}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`.react-flow__node[data-id="${bob.id}"]`),
  ).toHaveCount(0);
  await expect(
    page.locator(`.react-flow__node[data-id="${alice.id}"]`),
  ).toHaveAttribute("style", /translate\(123px, 456px\)/);

  const sectionOnly = await secondApi.post<{ id: string }>(
    `${base}/saved-views`,
    {
      name: "Section without focus",
      section_ids: [section.id],
      ancestor_depth: 0,
      descendant_depth: 0,
      include_partners: false,
    },
  );
  await page.reload();
  await page.locator("li").filter({ hasText: "Section without focus" }).click();
  await expect(
    page.locator(`.react-flow__node[data-id="${alice.id}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`.react-flow__node[data-id="${bob.id}"]`),
  ).toHaveCount(0);
  expect(sectionOnly.id).toBeTruthy();
});

test("content created from a section keeps that section as its origin", async ({
  page,
  secondApi,
  secondUser,
}) => {
  const workspace = await createTree(secondApi);
  const alice = await createMember(secondApi, workspace.id, {
    firstName: "Alice",
    lastName: "Private",
  });
  const base = `/workspaces/${workspace.id}`;
  const section = await secondApi.post<{ id: string }>(`${base}/sections`, {
    name: "Private section",
    root_member_id: alice.id,
  });
  await loginAs(page, secondUser);
  await expect(page.getByLabel("Family tree canvas")).toBeVisible({
    timeout: 15000,
  });
  await page.locator("li").filter({ hasText: "Private section" }).click();
  const member = page.locator(`.react-flow__node[data-id="${alice.id}"]`);
  await member.getByRole("button", { name: "Edit member" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await sheet.getByRole("tab", { name: "Records", exact: true }).click();
  await sheet
    .getByRole("button", { name: "Stories", exact: true })
    .locator("..")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.locator("#title") });
  await dialog.locator("#title").fill("Private story");
  await dialog
    .locator("#content")
    .fill("This belongs to the selected section.");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`${base}/stories`),
  );
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).searchParams.get("origin_section_id")).toBe(
    section.id,
  );
  const story = await response.json();
  const scopes = await secondApi.get<
    Array<{ content_id: string; section_id: string | null }>
  >(`${base}/content-scopes`);
  expect(
    scopes.find((scope) => scope.content_id === story.id)?.section_id,
  ).toBe(section.id);
});
