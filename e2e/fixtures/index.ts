/**
 * Playwright custom fixture set.
 *
 * Import `test` and `expect` from this file (not from @playwright/test directly)
 * to get the extended fixtures.
 *
 * Provided fixtures
 * -----------------
 * adminApi      ApiClient logged in as the E2E admin account
 * adminPage     Page already authenticated as admin (storage-state injected)
 * secondUser    A throwaway UserRecord provisioned for the test; auto-cleaned up
 * secondApi     ApiClient logged in as secondUser
 * seedTree      Helper: creates a new tree for the test and deletes it afterward
 */

import { test as base, expect } from "@playwright/test";
import { apiLogin, makeApiClient } from "./api";
import type { ApiClient } from "./api";
import { getAdminToken, createTestUser, deleteTestUser } from "./users";
import type { UserRecord } from "./users";
import { createTree, deleteTree } from "./seed";
import type { TreeRecord } from "./seed";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "./users";

export { expect };
export type { ApiClient, UserRecord, TreeRecord };

type E2EFixtures = {
  adminApi: ApiClient;
  adminPage: import("@playwright/test").Page;
  secondUser: UserRecord;
  secondApi: ApiClient;
  seedTree: (name?: string) => Promise<TreeRecord>;
};

export const test = base.extend<E2EFixtures>({
  // The SPA reads its language from localStorage and otherwise defaults to
  // German; force English so locale-dependent text selectors are reliable.
  // (Playwright's `locale` option only sets navigator.language, which the app
  // ignores.) Applies to every test's `page`, including `adminPage`.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("i18nextLng", "en");
      } catch {
        /* ignore storage errors */
      }
    });
    // Suppress the onboarding tour so its overlay does not block test interactions.
    await page.route("**/api/users/me/preferences/tutorial", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { completed: true } });
      } else {
        await route.continue();
      }
    });
    await use(page);
  },

  adminApi: async ({}, use) => {
    const token = await getAdminToken();
    await use(makeApiClient(token));
  },

  adminPage: async ({ page }, use) => {
    // Log in via the UI login form so the SPA's auth store is properly
    // initialised (JWT stored in memory, not just a network cookie).
    // Use ID selectors — label text is locale-dependent (e.g. "Benutzername" in DE).
    await page.goto("/");
    await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
    await page.locator("#username").fill(ADMIN_USERNAME);
    await page.locator("#password").fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    // Wait for the login form to disappear (auth store transitions to "authenticated")
    await expect(page.locator("#username")).not.toBeVisible({
      timeout: 15_000,
    });
    await use(page);
  },

  secondUser: async ({ adminApi }, use) => {
    const user = await createTestUser(adminApi);
    await use(user);
    // Teardown: remove the account (best-effort)
    try {
      await deleteTestUser(adminApi, user.id);
    } catch {
      // ignore — the user may have been deleted by the test itself
    }
  },

  secondApi: async ({ secondUser }, use) => {
    const token = await apiLogin(secondUser.username, secondUser.password);
    await use(makeApiClient(token));
  },

  seedTree: async ({ adminApi }, use) => {
    const created: TreeRecord[] = [];
    const factory = async (name?: string): Promise<TreeRecord> => {
      const tree = await createTree(adminApi, name);
      created.push(tree);
      return tree;
    };
    await use(factory);
    // Teardown: delete all trees created during the test
    for (const tree of created) {
      try {
        await deleteTree(adminApi, tree.id);
      } catch {
        // already deleted by the test
      }
    }
  },
});
