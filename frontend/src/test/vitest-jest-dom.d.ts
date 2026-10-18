// Vitest 5 changed `Assertion` to `Assertion<R, T>`, so the
// `Assertion<T>` augmentation shipped in `@testing-library/jest-dom/vitest`
// (7.0.1) no longer merges and the jest-dom matchers lose their types.
// Augment Vitest's own `Matchers` extension point instead; drop this file once
// jest-dom ships Vitest 5 typings.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}
