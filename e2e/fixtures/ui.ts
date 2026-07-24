/**
 * Shared UI interaction helpers used across multiple spec files.
 *
 * Plain exported functions rather than fixtures: the caller already has a
 * `page` (from any fixture) and, for `loginAs`, supplies which user to log in
 * as — there's no single fixed value to bake into a fixture the way
 * `adminPage` bakes in the admin account.
 */

import { expect, type Page } from "@playwright/test";

export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * Log in via the UI login form so the SPA's auth store is properly
 * initialised (JWT stored in memory, not just a network cookie).
 * Uses ID selectors — label text is locale-dependent (e.g. "Benutzername" in DE).
 */
export async function loginAs(
  page: Page,
  user: LoginCredentials,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator('button[type="submit"]').click();
  // Wait for the login form to disappear (auth store transitions to "authenticated")
  await expect(page.locator("#username")).not.toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Open the tree selector and pick the tree with the given name. No-ops if
 * that tree is already selected (e.g. after a reload that auto-restores the
 * last-opened tree).
 */
export async function selectTree(page: Page, name: string): Promise<void> {
  const selector = page.locator('[data-testid="tree-selector"]');
  await expect(selector).toBeVisible({ timeout: 15_000 });
  if ((await selector.textContent())?.includes(name)) return;
  await selector.click();
  const option = page.getByRole("option").filter({ hasText: name });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(selector).toContainText(name, { timeout: 15_000 });
}
