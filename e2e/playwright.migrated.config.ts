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
});
