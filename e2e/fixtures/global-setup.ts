/**
 * Playwright global setup — runs once before the whole suite.
 *
 * Disables the legal acceptance gate (#519) on the ephemeral E2E stack. The
 * gate is a blocking, non-dismissable dialog after login and is additionally
 * enforced server-side on every write, so leaving it on would break every
 * authenticated functional test. The gate itself is covered by backend and
 * frontend unit tests; here we just get it out of the way.
 */

import { apiLogin, makeApiClient } from "./api";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "./users";

export default async function globalSetup(): Promise<void> {
  // The stack is healthy by the time Playwright starts, but retry briefly in
  // case the admin account is still being seeded.
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const token = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
      await makeApiClient(token).patch("/settings", {
        legal_acceptance_required: false,
      });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    `global-setup: could not disable the legal gate — ${String(lastError)}`,
  );
}
