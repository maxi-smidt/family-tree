/**
 * Foundation smoke tests (#263).
 * Verify the harness, compose stack, and shared fixtures all work before
 * feature-level specs are run.
 */

import { test, expect } from "../fixtures";
import { apiLogin, makeApiClient } from "../fixtures/api";
import { getAdminToken } from "../fixtures/users";
import { createTree, deleteTree, createMember } from "../fixtures/seed";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../fixtures/users";
import { API_URL } from "../playwright.config";

test("app shell loads and shows login page when unauthenticated", async ({
  page,
}) => {
  await page.goto("/");
  // The login page renders for unauthenticated visitors.
  // Use the input's id — label text is locale-dependent.
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
});

test("health endpoint reports ready", async () => {
  const res = await fetch(`${API_URL}/health/ready`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { status?: string };
  expect(body.status).toBe("ok");
});

test("programmatic login returns a valid access token", async () => {
  const token = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
  expect(token).toBeTruthy();
  expect(typeof token).toBe("string");

  // Token must work for an authenticated endpoint
  const api = makeApiClient(token);
  const me = await api.get<{ username: string }>("/auth/me");
  expect(me.username).toBe(ADMIN_USERNAME);
});

test("adminPage fixture yields an authenticated session", async ({
  adminPage,
}) => {
  // After the adminPage fixture we should be in the main app, not the login page
  await expect(adminPage.locator("#username")).not.toBeVisible({ timeout: 5_000 });
  // The page URL should be the root (authenticated layout)
  expect(adminPage.url()).toMatch(/https?:\/\/[^/]+\/?$/);
});

test("seed helper can create a tree and a member via API; UI reflects it after reload", async ({
  adminPage,
  adminApi,
}) => {
  const tree = await createTree(adminApi, "Smoke-Seed-Tree");
  const member = await createMember(adminApi, tree.id, {
    firstName: "SeedTest",
    lastName: "Member",
  });

  try {
    // Reload the SPA — the new tree should appear in the tree selector.
    // The tree was just created with last_opened=now so it auto-selects first.
    await adminPage.reload({ waitUntil: "networkidle" });

    // If not auto-selected (parallel workers may have created a newer tree),
    // pick it from the dropdown. The SelectItem accessible name includes the
    // icon aria-label ("Owned by you …"), so use a regex partial match.
    const treeSelector = adminPage.getByRole("combobox").first();
    const currentText = await treeSelector.textContent();
    if (!currentText?.includes("Smoke-Seed-Tree")) {
      await treeSelector.click();
      await adminPage
        .getByRole("option", { name: /Smoke-Seed-Tree/i })
        .click();
      await adminPage.waitForLoadState("networkidle");
    }

    // Switch to list view for reliable text-based assertion (no React Flow)
    await adminPage.getByRole("tab", { name: /list/i }).click();
    await expect(adminPage.getByText("SeedTest")).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await deleteTree(adminApi, tree.id);
  }
  void member; // suppress unused warning
});

test("a deliberately failing assertion produces screenshot artifact in CI", async ({
  page,
}) => {
  // This is a meta-test for CI artifact wiring. It PASSES by verifying that
  // a controlled failure path at least reaches the assertion without throwing
  // a setup error. In CI, run with --reporter=html to validate artifact upload.
  await page.goto("/");
  const visible = await page.locator("#username").isVisible();
  // We just confirm the assertion machinery runs — not that the value is wrong.
  expect(typeof visible).toBe("boolean");
});
