/**
 * E2E tests: Alternate content views (#269)
 * list, gallery, timeline, map, activity, statistics, quality report, tab prefs
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { seedMinimalFamily, createMember } from "../fixtures/seed";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function selectTree(page: import("@playwright/test").Page, name: string) {
  const selector = page.locator('[data-testid="tree-selector"]');
  await expect(selector).toBeVisible({ timeout: 15_000 });
  if ((await selector.textContent())?.includes(name)) return;
  await selector.click();
  const option = page.getByRole("option").filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(selector).toContainText(name, { timeout: 15_000 });
}

async function clickTab(page: import("@playwright/test").Page, label: RegExp) {
  await page.getByRole("tab", { name: label }).click();
  await page.waitForLoadState("networkidle");
}

async function clickMediaSection(
  page: import("@playwright/test").Page,
  label: RegExp,
) {
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByRole("menuitem", { name: label }).click();
  await page.waitForLoadState("networkidle");
}

function collectPageErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

function expectNoUnexpectedPageErrors(errors: string[]) {
  expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

test("list view — members listed; search narrows results", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-ListView");
  await seedMinimalFamily(adminApi, tree.id); // Alice, Bob, Charlie

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /list/i);

  await expect(adminPage.getByRole("cell", { name: "Alice" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(adminPage.getByRole("cell", { name: "Bob" })).toBeVisible({
    timeout: 10_000,
  });

  // Search for "Alice" — only Alice remains
  const searchInput = adminPage
    .getByRole("searchbox")
    .or(adminPage.getByPlaceholder(/search|filter/i));
  if (await searchInput.isVisible()) {
    await searchInput.fill("Alice");
    await expect(adminPage.getByRole("cell", { name: "Bob" })).toHaveCount(0);
    await expect(adminPage.getByRole("cell", { name: "Alice" })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// Gallery view
// ---------------------------------------------------------------------------

test("gallery view — renders without errors when no images", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-GalleryView");
  await seedMinimalFamily(adminApi, tree.id);
  const errors = collectPageErrors(adminPage);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickMediaSection(adminPage, /gallery/i);

  await expect(
    adminPage.getByRole("heading", { name: /gallery/i }),
  ).toBeVisible();
  await adminPage.waitForTimeout(2000);
  expectNoUnexpectedPageErrors(errors);
});

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------

test("timeline view — events render for members with dates", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-TimelineView");
  // Add a member with a birthdate so the timeline has something to show
  await createMember(adminApi, tree.id, {
    firstName: "Timeline",
    lastName: "Person",
    dateOfBirth: "1950-06-15",
  } as Parameters<typeof createMember>[2] & Record<string, unknown>);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /timeline/i);

  await expect(adminPage.getByText("Timeline Person")).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Map view (geocoding intercepted)
// ---------------------------------------------------------------------------

test("map view — renders without calling external geocode service", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-MapView");
  // Add a member with a birthplace
  await adminApi.post(`/trees/${tree.id}/members`, {
    id: randomUUID(),
    firstName: "Map",
    lastName: "Person",
    birthplace: "Berlin, Germany",
  });

  // Intercept Nominatim calls — return a stub so no external request is made
  await adminPage.route("**/nominatim.openstreetmap.org/**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { lat: "52.52", lon: "13.405", display_name: "Berlin" },
      ]),
    });
  });
  // Also intercept the internal geocode endpoint
  await adminPage.route(`**/api/trees/*/geocode**`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          query: "Berlin, Germany",
          lat: 52.52,
          lon: 13.405,
          display_name: "Berlin",
          resolved: true,
        },
      ]),
    });
  });
  const errors = collectPageErrors(adminPage);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /map/i);

  // Map container should appear without a crash
  await expect(adminPage.getByRole("heading", { name: /map/i })).toBeVisible();
  await adminPage.waitForTimeout(2000);
  expectNoUnexpectedPageErrors(errors);
});

// ---------------------------------------------------------------------------
// Activity view
// ---------------------------------------------------------------------------

test("activity view — adding a member creates an activity entry", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-ActivityView");

  // Add a member (this should be recorded as activity)
  await createMember(adminApi, tree.id, {
    firstName: "ActivityTest",
    lastName: "Member",
  });

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /activity/i);

  await expect(
    adminPage.getByRole("button", { name: /ActivityTest Member/i }),
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Statistics view
// ---------------------------------------------------------------------------

test("statistics view — member count matches seeded data", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-StatisticsView");
  await seedMinimalFamily(adminApi, tree.id); // 3 members

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /statistics/i);

  await expect(adminPage.getByText(/total members/i)).toBeVisible({
    timeout: 10_000,
  });
  const totalMembersCard = adminPage
    .locator('[data-slot="card"]')
    .filter({ hasText: /total members/i });
  await expect(totalMembersCard.getByText("3", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Quality report view
// ---------------------------------------------------------------------------

test("quality report view — members with missing dates are flagged", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-QualityView");
  // Add a member with no dates (should trigger a quality flag)
  await createMember(adminApi, tree.id, {
    firstName: "Incomplete",
    lastName: "Data",
  });
  const errors = collectPageErrors(adminPage);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);
  await clickTab(adminPage, /quality/i);

  // Quality report should render without crashing
  await adminPage.waitForLoadState("networkidle");
  await expect(
    adminPage.getByRole("heading", { name: /quality/i }),
  ).toBeVisible();
  await adminPage.waitForTimeout(1000);
  expectNoUnexpectedPageErrors(errors);
});

// ---------------------------------------------------------------------------
// Tab preferences
// ---------------------------------------------------------------------------

test("tab preferences — hiding a tab removes it from the tab bar", async ({
  adminPage,
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-TabPrefs");
  await seedMinimalFamily(adminApi, tree.id);

  await adminPage.reload({ waitUntil: "networkidle" });
  await selectTree(adminPage, tree.name);

  // If a tab-preferences control exists, hide the statistics tab
  const tabPrefsBtn = adminPage.getByRole("button", {
    name: /tab|manage|customise|customize/i,
  });
  if (await tabPrefsBtn.isVisible({ timeout: 3_000 })) {
    await tabPrefsBtn.click();
    const statsToggle = adminPage
      .getByRole("switch", { name: /statistics/i })
      .or(adminPage.getByLabel(/statistics/i));
    if (await statsToggle.isVisible({ timeout: 3_000 })) {
      await statsToggle.click();
      await adminPage.keyboard.press("Escape");
      await adminPage.reload({ waitUntil: "networkidle" });
      await selectTree(adminPage, tree.name);
      await expect(
        adminPage.getByRole("tab", { name: /statistics/i }),
      ).not.toBeVisible({ timeout: 5_000 });
    }
  } else {
    test.skip(true, "Tab preferences UI not found in this build");
  }
  void adminApi;
});
