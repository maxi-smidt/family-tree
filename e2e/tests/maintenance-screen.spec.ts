/**
 * E2E tests: the maintenance screen shown while the startup v1->v2 migration
 * has every ordinary route gated (#1020/#992).
 *
 * The ephemeral e2e stack is a fresh install, so it never actually runs a
 * migration — a real one would also complete faster than Playwright can
 * observe it, making the "in progress" state unreachable and any wait for it
 * flaky by construction. Instead this mocks the two endpoints the screen
 * itself talks to (GET /auth/me and GET /health/migration) so the real
 * frontend code renders from a controlled, deterministic response — the UI
 * under test is real, only the network is stubbed.
 */

import { expect, test } from "../fixtures";

async function mockStartupInProgress(
  page: import("@playwright/test").Page,
  migrationStatus: Record<string, unknown>,
) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "startup_in_progress" },
    }),
  );
  await page.route("**/api/health/migration", (route) =>
    route.fulfill({ status: 200, json: migrationStatus }),
  );
}

test("shows upgrade progress without a login form", async ({ page }) => {
  await mockStartupInProgress(page, {
    status: "migrating",
    run_id: "run-1",
    phase_heartbeat_at: null,
    failure_code: null,
    phase_index: 2,
    phase_count: 5,
  });

  await page.goto("/");

  await expect(page.getByText("Upgrading Family Tree")).toBeVisible();
  await expect(page.getByText("Migrating your data…")).toBeVisible();
  await expect(page.getByText("Step 3 of 5")).toBeVisible();
  await expect(page.locator("#username")).toHaveCount(0);
});

test("a failed migration shows a generic contact-admin message, not operator detail", async ({
  page,
}) => {
  await mockStartupInProgress(page, {
    status: "failed",
    run_id: "run-1",
    phase_heartbeat_at: null,
    failure_code: "SomeInternalExceptionType",
    phase_index: 3,
    phase_count: 5,
  });

  await page.goto("/");

  await expect(page.getByText("Upgrading Family Tree")).toBeVisible();
  await expect(
    page.getByText(
      "The upgrade needs attention. Please contact your administrator.",
    ),
  ).toBeVisible();
  await expect(page.getByText("SomeInternalExceptionType")).toHaveCount(0);
  await expect(page.locator("#username")).toHaveCount(0);
});
