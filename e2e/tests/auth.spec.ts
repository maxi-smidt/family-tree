/**
 * E2E tests: Authentication & account management (#264)
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { apiLogin } from "../fixtures/api";
import { createTestUser, deleteTestUser, ADMIN_USERNAME, ADMIN_PASSWORD } from "../fixtures/users";
import { API_URL } from "../playwright.config";

// ---------------------------------------------------------------------------
// Login / Logout
// ---------------------------------------------------------------------------

test("login success — valid credentials land on the authenticated layout", async ({
  page,
}) => {
  await page.goto("/");
  // Use id-based selectors — label text is locale-dependent (e.g. "Benutzername" in DE)
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
  await page.locator("#username").fill(ADMIN_USERNAME);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Login form should disappear once authenticated
  await expect(page.locator("#username")).not.toBeVisible({ timeout: 10_000 });
});

test("login failure — wrong password shows error, stays on login page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });
  await page.locator("#username").fill(ADMIN_USERNAME);
  await page.locator("#password").fill("definitely-wrong-password");
  await page.locator('button[type="submit"]').click();
  // Login form stays visible
  await expect(page.locator("#username")).toBeVisible({ timeout: 5_000 });
  // An error toast appears — English locale forced in playwright.config.ts
  await expect(
    page.getByText(/incorrect|invalid|wrong|unauthorized/i),
  ).toBeVisible({ timeout: 5_000 });
});

test("logout — returns to login page and clears the session", async ({
  adminPage,
}) => {
  // The UserMenu trigger is a button whose text is the admin username
  await adminPage.getByRole("button", { name: ADMIN_USERNAME }).click();
  // "Log out" from t("auth.user-menu.logout")
  await adminPage.getByRole("menuitem", { name: /log out/i }).click();
  // Should land back on login (login form visible again)
  await expect(adminPage.locator("#username")).toBeVisible({ timeout: 10_000 });

  // A protected API call should now 401
  const res = await adminPage.request.get("/api/auth/me");
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

test("registration — new user can register and then log in", async ({
  page,
}) => {
  // Confirm registration is enabled via the config endpoint
  const configRes = await fetch(`${API_URL}/auth/config`);
  const config = (await configRes.json()) as { allow_self_registration: boolean };
  if (!config.allow_self_registration) {
    test.skip(true, "ALLOW_SELF_REGISTRATION is off for this stack");
    return;
  }

  await page.goto("/");
  await expect(page.locator("#username")).toBeVisible({ timeout: 15_000 });

  const suffix = Date.now().toString(36);
  const newUsername = `reg-${suffix}`;
  const newPassword = `RegPass-${suffix}!`;

  // The toggle is a type="button" (not a tab or link); text: "Need an account? Register"
  await page
    .locator('button[type="button"]')
    .filter({ hasText: /register/i })
    .click();

  await page.locator("#username").fill(newUsername);
  await page.locator("#password").fill(newPassword);
  // Email field (optional in this form)
  const emailField = page.locator("#email");
  if (await emailField.isVisible()) await emailField.fill(`${newUsername}@e2e.invalid`);

  await page.locator('button[type="submit"]').click();

  // Should now be authenticated (login form gone)
  await expect(page.locator("#username")).not.toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

test("change password — new password works; old password does not", async ({
  adminApi,
  page,
}) => {
  // Provision a throwaway user
  const user = await createTestUser(adminApi);
  const newPassword = `NewPass-${Date.now().toString(36)}!`;

  try {
    // Change via API (covers POST /api/auth/password)
    const token = await apiLogin(user.username, user.password);
    const res = await fetch(`${API_URL}/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        current_password: user.password,
        new_password: newPassword,
      }),
    });
    expect(res.status).toBeLessThan(300);

    // New password works
    const newToken = await apiLogin(user.username, newPassword);
    expect(newToken).toBeTruthy();

    // Old password fails
    await expect(apiLogin(user.username, user.password)).rejects.toThrow();
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
  void page;
});

// ---------------------------------------------------------------------------
// TOTP two-factor auth
// ---------------------------------------------------------------------------

test("2FA — setup + enable + login challenge + disable", async ({
  adminApi,
}) => {
  const { authenticator } = await import("otplib");
  const user = await createTestUser(adminApi);

  try {
    const token = await apiLogin(user.username, user.password);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    // 1. Setup: get the TOTP secret + QR code
    const setupRes = await fetch(`${API_URL}/auth/2fa/setup`, {
      method: "POST",
      headers,
    });
    expect(setupRes.ok).toBe(true);
    const setup = (await setupRes.json()) as {
      secret: string;
      otpauth_url: string;
    };
    expect(setup.secret).toBeTruthy();

    // 2. Enable: supply a valid TOTP code
    const code = authenticator.generate(setup.secret);
    const enableRes = await fetch(`${API_URL}/auth/2fa/enable`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
    });
    expect(enableRes.ok).toBe(true);
    const enabled = (await enableRes.json()) as { totp_enabled: boolean };
    expect(enabled.totp_enabled).toBe(true);

    // 3. Login now requires TOTP: the login response has totp_required=true
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: user.password }),
    });
    expect(loginRes.ok).toBe(true);
    const loginData = (await loginRes.json()) as {
      totp_required: boolean;
      totp_session_token: string;
    };
    expect(loginData.totp_required).toBe(true);
    expect(loginData.totp_session_token).toBeTruthy();

    // 4. A bad TOTP code is rejected
    const badTotpRes = await fetch(`${API_URL}/auth/totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_token: loginData.totp_session_token,
        code: "000000",
      }),
    });
    expect(badTotpRes.status).toBe(401);

    // 5. A valid TOTP code completes login
    const validCode = authenticator.generate(setup.secret);
    const totpRes = await fetch(`${API_URL}/auth/totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_token: loginData.totp_session_token,
        code: validCode,
      }),
    });
    expect(totpRes.ok).toBe(true);
    const totpData = (await totpRes.json()) as { access_token?: string };
    expect(totpData.access_token).toBeTruthy();

    // 6. Disable 2FA
    const freshToken = totpData.access_token!;
    const disableRes = await fetch(`${API_URL}/auth/2fa/disable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshToken}`,
      },
      body: JSON.stringify({
        password: user.password,
        code: authenticator.generate(setup.secret),
      }),
    });
    expect(disableRes.status).toBe(204);

    // 7. Password-only login works again
    const restoredToken = await apiLogin(user.username, user.password);
    expect(restoredToken).toBeTruthy();
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});

// ---------------------------------------------------------------------------
// Account deletion & restoration
// ---------------------------------------------------------------------------

test("delete account — account cannot log in after deletion", async ({
  adminApi,
}) => {
  const user = await createTestUser(adminApi);
  try {
    const token = await apiLogin(user.username, user.password);
    const deleteRes = await fetch(`${API_URL}/auth/delete-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: user.password }),
    });
    expect(deleteRes.ok).toBe(true);

    // Login should now be refused
    await expect(apiLogin(user.username, user.password)).rejects.toThrow();
  } finally {
    // Admin hard-delete to ensure teardown even if restoration is not tested
    try {
      await adminApi.delete(`/users/${user.id}`);
    } catch { /* already gone */ }
  }
});

test("restore account — account can log in again after restoration", async ({
  adminApi,
}) => {
  const user = await createTestUser(adminApi);
  try {
    const token = await apiLogin(user.username, user.password);

    // Delete
    await fetch(`${API_URL}/auth/delete-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: user.password }),
    });

    // Restore
    const restoreRes = await fetch(`${API_URL}/auth/restore-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: user.password }),
    });
    expect(restoreRes.ok).toBe(true);
    const restored = (await restoreRes.json()) as { access_token?: string };
    expect(restored.access_token).toBeTruthy();
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});
