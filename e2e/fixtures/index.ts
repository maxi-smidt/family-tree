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
  adminApi: async ({}, use) => {
    const token = await getAdminToken();
    await use(makeApiClient(token));
  },

  adminPage: async ({ page }, use) => {
    // Log in via the UI login form so the SPA's auth store is properly
    // initialised (JWT stored in memory, not just a network cookie).
    await page.goto("/");
    await page.getByLabel(/username/i).fill(ADMIN_USERNAME);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /login|sign in/i }).click();
    // Wait for the authenticated layout (sidebar / main panel appears)
    await page.waitForURL(/\//, { waitUntil: "networkidle" });
    await expect(page.locator("body")).not.toContainText("Login", {
      timeout: 10_000,
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
