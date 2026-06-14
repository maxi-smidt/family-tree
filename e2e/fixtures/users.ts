/**
 * User provisioning helpers.
 *
 * The admin account is the seeded FIRST_ADMIN_* account; credentials come from
 * the environment so they match the compose stack.
 * A "second user" is provisioned on-demand via the admin /users API so sharing
 * and permission tests can exercise two-actor flows.
 */

import { randomUUID } from "crypto";
import { apiLogin, makeApiClient } from "./api";
import type { ApiClient } from "./api";

export const ADMIN_USERNAME =
  process.env.E2E_ADMIN_USERNAME ?? "e2e-admin";
export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password";

export interface UserRecord {
  id: string;
  username: string;
  password: string;
}

export async function getAdminToken(): Promise<string> {
  return apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
}

export async function getAdminClient(): Promise<ApiClient> {
  const token = await getAdminToken();
  return makeApiClient(token);
}

/**
 * Create a throwaway local account via the admin API and return its credentials.
 * Caller is responsible for deleting the user during teardown if desired.
 */
export async function createTestUser(
  adminApi: ApiClient,
  overrides: Partial<{ username: string; password: string; is_admin: boolean }> = {},
): Promise<UserRecord> {
  const suffix = randomUUID().slice(0, 8);
  const username = overrides.username ?? `e2e-user-${suffix}`;
  const password = overrides.password ?? `E2EPass-${suffix}!`;

  const user = await adminApi.post<{ id: string; username: string }>(
    "/users",
    {
      username,
      password,
      email: `${username}@example.com`,
      full_name: `E2E ${username}`,
      is_admin: overrides.is_admin ?? false,
    },
  );

  return { id: user.id, username, password };
}

/**
 * Delete a user via the admin API (soft-delete).
 */
export async function deleteTestUser(
  adminApi: ApiClient,
  userId: string,
): Promise<void> {
  await adminApi.delete(`/users/${userId}`);
}
