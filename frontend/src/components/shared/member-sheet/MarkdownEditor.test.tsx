import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { MarkdownEditor } from "./MarkdownEditor";

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
);

function makeRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("MarkdownEditor", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");

    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLTextAreaElement) {
        return makeRect(100, 100);
      }

      if (this.hasAttribute("data-member-sheet-scroll-area")) {
        return makeRect(0, 260);
      }

      return originalGetBoundingClientRect.call(this);
    };

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;

    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        originalScrollHeightDescriptor,
      );
    } else {
      delete (
        HTMLTextAreaElement.prototype as unknown as Record<string, unknown>
      ).scrollHeight;
    }

    vi.restoreAllMocks();
  });

  it("restores the full textarea height after switching back from preview", () => {
    render(
      <div data-member-sheet-scroll-area style={{ paddingBottom: 16 }}>
        <MarkdownEditor
          value={"line one\nline two\nline three"}
          onChange={() => undefined}
        />
      </div>,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveStyle({ height: "144px", overflowY: "auto" });

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Write" }));

    expect(screen.getByRole("textbox")).toHaveStyle({
      height: "144px",
      overflowY: "auto",
    });
  });
});
