/**
 * E2E tests: a collaborator who only holds migration-created section-scoped
 * grants sees exactly their sections, and widening a grant from the
 * migration report expands that to the whole workspace (#992/#993).
 *
 * `test.describe.serial` — the widen step run partway through deliberately
 * mutates shared backend state (the grant), so the "before" and "after"
 * visibility checks must run in this order on one worker.
 */

import {
  EXTRA_SECTION_NAME,
  RIGHT_SECTION_NAME,
  WORKSPACE_NAME,
  expect,
  test,
} from "../../fixtures/migrated";
import { API_URL } from "../../playwright.config";

test.describe.serial("scoped collaborator visibility and widening", () => {
  let workspaceId: string;
  let extraSectionId: string;

  test("collaborator sees only their two granted sections, not Extra", async ({
    collabPage: page,
    owner1Api,
  }) => {
    const workspaces =
      await owner1Api.get<Array<{ id: string; name: string }>>("/workspaces");
    const workspace = workspaces.find((w) => w.name === WORKSPACE_NAME);
    expect(workspace).toBeTruthy();
    workspaceId = workspace!.id;

    const sections = await owner1Api.get<Array<{ id: string; name: string }>>(
      `/workspaces/${workspaceId}/sections`,
    );
    extraSectionId = sections.find((s) => s.name === EXTRA_SECTION_NAME)!.id;
    expect(extraSectionId).toBeTruthy();

    const nav = page.getByLabel("Workspace navigation");
    await expect(
      nav.locator("li").filter({ hasText: WORKSPACE_NAME }),
    ).toBeVisible();
    await expect(
      nav.locator("li").filter({ hasText: RIGHT_SECTION_NAME }),
    ).toBeVisible();
    await expect(
      nav.locator("li").filter({ hasText: EXTRA_SECTION_NAME }),
    ).toHaveCount(0);
  });

  test("collaborator's API access mirrors the UI: Extra's members are unreachable", async ({
    collabApi,
  }) => {
    const res = await fetch(
      `${API_URL}/workspaces/${workspaceId}/sections/${extraSectionId}/members`,
      { headers: { Authorization: `Bearer ${collabApi.token}` } },
    );
    // 404, not 403: a section outside the caller's grants doesn't even
    // confirm its own existence to them.
    expect(res.status).toBe(404);
  });

  test("owner widens the collaborator's Left-section grant to full workspace access", async ({
    owner1Page: page,
  }) => {
    await page.getByRole("tab", { name: /Migration Review/ }).click();
    await expect(
      page.getByRole("heading", { name: "Migration Review" }),
    ).toBeVisible();

    const grantRow = page
      .locator("li")
      .filter({ hasText: "viewer access, limited to one section" });
    await grantRow
      .getByRole("button", { name: "Widen to full access" })
      .click();

    const widenDialog = page.getByRole("dialog", { name: "Widen access?" });
    await expect(widenDialog).toBeVisible();
    await widenDialog
      .getByRole("button", { name: "Widen access", exact: true })
      .click();
    await expect(widenDialog.getByText("After: whole workspace")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(widenDialog).not.toBeVisible();

    await expect(grantRow.getByText("Widened", { exact: true })).toBeVisible();
  });

  test("collaborator now sees the Extra section too", async ({
    collabPage: page,
  }) => {
    await expect(
      page
        .getByLabel("Workspace navigation")
        .locator("li")
        .filter({ hasText: EXTRA_SECTION_NAME }),
    ).toBeVisible();
  });
});
