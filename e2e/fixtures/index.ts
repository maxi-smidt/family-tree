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
import { loginAs } from "./ui";

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
    // The realtime SSE stream (/api/sse/events) holds an HTTP connection open for
    // the life of the page, which prevents Playwright's `networkidle` from ever
    // settling and hangs every `waitUntil: "networkidle"` navigation. Abort it so
    // those waits resolve; the realtime client is covered by unit tests, not E2E.
    await page.route("**/api/sse/events*", (route) => route.abort());
    // E2E images always use the Dockerfile's default `dev` version. Treat it
    // as already acknowledged so the release-notes modal cannot obscure
    // unrelated UI scenarios; the modal itself is covered by frontend tests.
    await page.route("**/api/users/me/preferences/whats-new", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { last_read_version: "dev" } });
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
    await loginAs(page, { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
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
