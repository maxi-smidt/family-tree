/**
 * E2E tests: the migration report and review checklist an owner sees after
 * the v1->v2 startup migration ran (#992). Runs against the stack built by
 * `backend/scripts/seed_e2e_migration_fixture.py` + `docker-compose.e2e.
 * migrated.yml` — see `playwright.migrated.config.ts`.
 */

import {
  COMBO_VIEW_NAME,
  DROPPED_VIEW_NAME,
  expect,
  test,
} from "../../fixtures/migrated";

async function openMigrationReview(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: /Migration Review/ }).click();
  await expect(
    page.getByRole("heading", { name: "Migration Review" }),
  ).toBeVisible();
}

test("owner sees workspace mappings, access changes, and converted/dropped views", async ({
  owner1Page: page,
}) => {
  await openMigrationReview(page);

  // Workspace mappings: the survivor and each absorbed tree.
  await expect(page.getByText("became this workspace").first()).toBeVisible();
  await expect(page.getByText("moved into a section").first()).toBeVisible();

  // Access changes: two scoped grants (different roles) + two scoped public
  // links, each independently narrowed.
  await expect(
    page.getByText("viewer access, limited to one section"),
  ).toBeVisible();
  await expect(
    page.getByText("editor access, limited to one section"),
  ).toBeVisible();
  await expect(
    page.getByText("A public link was narrowed to one section"),
  ).toHaveCount(2);

  // Views: one converted to a saved view, one dropped (spanned workspaces).
  await expect(page.getByText(COMBO_VIEW_NAME)).toBeVisible();
  await expect(page.getByText(DROPPED_VIEW_NAME)).toBeVisible();
});

test("acknowledging the report persists across reload", async ({
  owner1Page: page,
}) => {
  await openMigrationReview(page);

  const acknowledgeButton = page.getByRole("button", {
    name: "Acknowledge",
    exact: true,
  });
  await expect(acknowledgeButton).toBeVisible();
  await acknowledgeButton.click();
  await expect(page.getByText("Acknowledged").first()).toBeVisible();

  await page.reload();
  await openMigrationReview(page);
  await expect(page.getByText("Acknowledged").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acknowledge", exact: true }),
  ).toHaveCount(0);
});

test("review checklist: resolving a duplicate-person conflict and dismissing a possible match survive reload", async ({
  owner1Page: page,
}) => {
  await openMigrationReview(page);
  await page.getByRole("tab", { name: "Review checklist" }).click();

  // Matches by kind alone (not also "Pending") — resolving moves the card
  // from the pending list to the resolved history further down the same
  // page, and the fixture has exactly one of each kind throughout.
  const duplicateCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Duplicate person" });
  await expect(duplicateCard.getByText("First name")).toBeVisible();
  await duplicateCard
    .getByRole("button", { name: "Resolve", exact: true })
    .click();
  await expect(
    duplicateCard.getByText("Resolved", { exact: true }),
  ).toBeVisible();

  const matchCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Possible match" });
  const actionSelect = matchCard.getByRole("combobox").last();
  await actionSelect.click();
  await page.getByRole("option", { name: "Dismiss" }).click();
  await matchCard.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(matchCard.getByText("Dismissed", { exact: true })).toBeVisible();

  await page.reload();
  await openMigrationReview(page);
  await page.getByRole("tab", { name: "Review checklist" }).click();
  await expect(page.getByText("No pending review items.")).toBeVisible();
  await expect(
    page.getByText("Resolved", { exact: true }).first(),
  ).toBeVisible();
});

test("a second owner never sees the first owner's report", async ({
  owner2Page: page,
}) => {
  await openMigrationReview(page);
  await expect(page.getByText(COMBO_VIEW_NAME)).toHaveCount(0);
  await expect(
    page.getByText("viewer access, limited to one section"),
  ).toHaveCount(0);
});
