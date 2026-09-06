import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

/**
 * Runs only `tests/migrated/**` (#992) — against the stack booted from
 * `backend/scripts/seed_e2e_migration_fixture.py`'s seeded-v1 data plus
 * `docker-compose.e2e.migrated.yml`, not the ordinary fresh-install stack
 * every other config here targets. See that compose file's header for the
 * full up/seed/up sequence.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./tests/migrated",
  testIgnore: undefined,
  // These tests permanently mutate the one seeded fixture (acknowledging a
  // report, resolving conflicts, widening a grant) — a retry after such a
  // mutation runs against already-changed state (e.g. the Acknowledge
  // button it's looking for is gone) and can never pass. Unlike the rest of
  // the suite, this fixture isn't reseeded between attempts, so retrying is
  // never safe here, in CI or otherwise.
  retries: 0,
});
