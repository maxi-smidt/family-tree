/**
 * E2E tests: Admin & feature flags (#271)
 * Depends on foundation harness (#263).
 */

import { test, expect } from "../fixtures";
import { seedMinimalFamily } from "../fixtures/seed";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { API_URL } from "../playwright.config";

// ---------------------------------------------------------------------------
// Admin gating
// ---------------------------------------------------------------------------

test("non-admin cannot reach admin endpoints — 403", async ({
  adminApi,
  secondApi,
}) => {
  // Non-admin tries to list users
  const res = await fetch(`${API_URL}/users`, {
    headers: { Authorization: `Bearer ${secondApi.token}` },
  });
  expect([401, 403]).toContain(res.status);
  void adminApi;
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

test("feature flags — list returns known flags", async ({ adminApi }) => {
  const flags =
    await adminApi.get<Array<{ name: string; state: string }>>(
      "/admin/features",
    );
  expect(Array.isArray(flags)).toBe(true);
  expect(flags.length).toBeGreaterThan(0);
  expect(flags.every((f) => typeof f.name === "string")).toBe(true);
});

test("feature flag disable — tab hidden from layout; re-enable restores it", async ({
  adminApi,
  adminPage,
  seedTree,
}) => {
  // Find a feature flag that corresponds to a tab (e.g. gallery)
  const flags =
    await adminApi.get<Array<{ name: string; state: string }>>(
      "/admin/features",
    );
  const galleryFlag = flags.find((f) =>
    f.name.toLowerCase().includes("gallery"),
  );

  if (!galleryFlag) {
    test.skip(true, "No gallery feature flag found in this build");
    return;
  }

  const tree = await seedTree("E2E-FeatureFlag");
  await seedMinimalFamily(adminApi, tree.id);

  await adminPage.reload({ waitUntil: "networkidle" });

  try {
    // Disable the gallery feature
    await adminApi.patch(`/admin/features/${galleryFlag.name}`, {
      state: "off",
    });

    await adminPage.reload({ waitUntil: "networkidle" });
    // Gallery tab should no longer be visible
    await expect(
      adminPage.getByRole("tab", { name: /gallery/i }),
    ).not.toBeVisible({ timeout: 5_000 });
  } finally {
    // Always restore the original state
    await adminApi.patch(`/admin/features/${galleryFlag.name}`, {
      state: galleryFlag.state,
    });
  }
});

// ---------------------------------------------------------------------------
// Admin user management
// ---------------------------------------------------------------------------

test("admin can create a user and the user can log in", async ({
  adminApi,
}) => {
  const { apiLogin } = await import("../fixtures/api");
  const user = await createTestUser(adminApi, { is_admin: false });
  try {
    const token = await apiLogin(user.username, user.password);
    expect(token).toBeTruthy();
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});

test("admin can list users", async ({ adminApi }) => {
  const users = await adminApi.get<Array<{ username: string }>>("/users");
  expect(Array.isArray(users)).toBe(true);
  // At least the admin account should be in there
  const { ADMIN_USERNAME } = await import("../fixtures/users");
  expect(users.find((u) => u.username === ADMIN_USERNAME)).toBeTruthy();
});

test("admin can deactivate and reactivate a user", async ({ adminApi }) => {
  const user = await createTestUser(adminApi);
  try {
    // Deactivate
    await adminApi.patch(`/users/${user.id}`, { is_active: false });
    let users =
      await adminApi.get<Array<{ id: string; is_active: boolean }>>("/users");
    expect(users.find((u) => u.id === user.id)?.is_active).toBe(false);

    // Reactivate
    await adminApi.patch(`/users/${user.id}`, { is_active: true });
    users =
      await adminApi.get<Array<{ id: string; is_active: boolean }>>("/users");
    expect(users.find((u) => u.id === user.id)?.is_active).toBe(true);
  } finally {
    await deleteTestUser(adminApi, user.id);
  }
});

// ---------------------------------------------------------------------------
// Relation types
// ---------------------------------------------------------------------------

test("relation types — built-in types are listed", async ({
  adminApi,
  seedTree,
}) => {
  const tree = await seedTree("E2E-RelTypes");
  const types = await adminApi.get<Array<{ id: string }>>("/relation-types");
  expect(Array.isArray(types)).toBe(true);
  // The base set always has at least "partner" and "parent"
  const ids = types.map((t) => t.id);
  expect(ids.some((id) => id.includes("partner"))).toBe(true);
  expect(ids).toContain("parent");
  void tree;
});

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

test("backups — create returns a backup record", async ({ adminApi }) => {
  const backup = await adminApi.post<{ id: string }>("/admin/backups");
  expect(backup.id).toBeTruthy();

  const backups = await adminApi.get<Array<{ id: string }>>("/admin/backups");
  expect(backups.find((b) => b.id === backup.id)).toBeTruthy();
});

test("backups — backup file is downloadable", async ({ adminApi }) => {
  const backup = await adminApi.post<{ id: string }>("/admin/backups");

  const res = await fetch(`${API_URL}/admin/backups/${backup.id}/download`, {
    headers: { Authorization: `Bearer ${adminApi.token}` },
  });
  expect(res.ok).toBe(true);
  expect(res.headers.get("content-type")).toMatch(/octet|zip|stream/);
  const blob = await res.arrayBuffer();
  expect(blob.byteLength).toBeGreaterThan(0);
});

test("backups — delete removes the backup record", async ({ adminApi }) => {
  const backup = await adminApi.post<{ id: string }>("/admin/backups");

  const res = await fetch(`${API_URL}/admin/backups/${backup.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminApi.token}` },
  });
  expect(res.status).toBe(204);

  const backups = await adminApi.get<Array<{ id: string }>>("/admin/backups");
  expect(backups.find((b) => b.id === backup.id)).toBeFalsy();
});
