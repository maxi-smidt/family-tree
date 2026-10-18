/**
 * E2E tests: the maintenance screen shown while the backend's database
 * startup has every ordinary route gated (#1020).
 *
 * The ephemeral e2e stack starts faster than Playwright can observe that
 * state, so this mocks GET /auth/me returning the startup-gate 503 and lets
 * the real frontend render from it — the UI under test is real, only the
 * network is stubbed.
 */

import { expect, test } from "../fixtures";

test("shows the starting screen without a login form", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "startup_in_progress" },
    }),
  );

  await page.goto("/");

  await expect(page.getByText("Starting Family Tree")).toBeVisible();
  await expect(
    page.getByText(
      "The server is starting up. The page continues on its own once it's ready.",
    ),
  ).toBeVisible();
  await expect(page.locator("#username")).toHaveCount(0);
});
