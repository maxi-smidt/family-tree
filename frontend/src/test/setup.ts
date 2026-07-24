import "@testing-library/jest-dom";
import { beforeEach, vi } from "vitest";
import i18n from "@/i18n/i18n";

// jsdom implements neither ResizeObserver nor pointer capture, both of which
// Radix components (Select, cmdk command palette) rely on.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-only polyfill
global.ResizeObserver = MockResizeObserver;

Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.setPointerCapture = vi.fn();

// i18n defaults to "de" outside a browser with a stored preference; pin every
// test to "en" so assertions on rendered copy are deterministic.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
