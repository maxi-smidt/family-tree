/**
 * Fixtures for the seeded-migrated-stack suite (`tests/migrated/**`, #992).
 *
 * Unlike the rest of the e2e suite, these tests run against a stack that was
 * booted from `backend/scripts/seed_e2e_migration_fixture.py`'s v1-shaped
 * data and has already gone through the real startup migration — see
 * `docker-compose.e2e.migrated.yml` and `playwright.migrated.config.ts`.
 * There is nothing to seed here: the users, workspace, sections, grants,
 * public links, conflicts, and saved view all already exist. The constants
 * below mirror that script's — keep both in sync.
 */

import { test as base, expect } from "@playwright/test";
import { apiLogin, makeApiClient } from "./api";
import type { ApiClient } from "./api";
import { loginAs } from "./ui";

export { expect };
export type { ApiClient };

export const OWNER1 = {
  username: "e2e-migrated-owner1",
  password: "e2e-migrated-owner1-pw",
};
export const OWNER2 = {
  username: "e2e-migrated-owner2",
  password: "e2e-migrated-owner2-pw",
};
export const COLLABORATOR = {
  username: "e2e-migrated-collab",
  password: "e2e-migrated-collab-pw",
};

export const WORKSPACE_NAME = "E2E Migration Left"; // the merge survivor
export const RIGHT_SECTION_NAME = "E2E Migration Right";
export const EXTRA_SECTION_NAME = "E2E Migration Extra";
export const SOLO_WORKSPACE_NAME = "E2E Migration Solo";
export const CROSS_A_WORKSPACE_NAME = "E2E Migration CrossA";
export const COMBO_VIEW_NAME = "E2E Migration Combo";
export const DROPPED_VIEW_NAME = "E2E Migration Dropped Combo";

type MigratedFixtures = {
  owner1Page: import("@playwright/test").Page;
  owner2Page: import("@playwright/test").Page;
  collabPage: import("@playwright/test").Page;
  owner1Api: ApiClient;
  collabApi: ApiClient;
};

export const test = base.extend<MigratedFixtures>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("i18nextLng", "en");
      } catch {
        /* ignore storage errors */
      }
    });
    // Suppress the onboarding tour so its overlay does not block interactions.
    await page.route("**/api/users/me/preferences/tutorial", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { completed: true } });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/sse/events*", (route) => route.abort());
    await use(page);
  },

  owner1Page: async ({ page }, use) => {
    await loginAs(page, OWNER1);
    await use(page);
  },

  owner2Page: async ({ page }, use) => {
    await loginAs(page, OWNER2);
    await use(page);
  },

  collabPage: async ({ page }, use) => {
    await loginAs(page, COLLABORATOR);
    await use(page);
  },

  owner1Api: async ({}, use) => {
    const token = await apiLogin(OWNER1.username, OWNER1.password);
    await use(makeApiClient(token));
  },

  collabApi: async ({}, use) => {
    const token = await apiLogin(COLLABORATOR.username, COLLABORATOR.password);
    await use(makeApiClient(token));
  },
});
