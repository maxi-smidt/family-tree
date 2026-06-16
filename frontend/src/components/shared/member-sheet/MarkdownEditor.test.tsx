import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { MarkdownEditor } from "./MarkdownEditor";

const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
);

describe("MarkdownEditor", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");

    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
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

  it("grows to the full textarea height after switching back from preview", () => {
    render(
      <MarkdownEditor
        value={"line one\nline two\nline three"}
        onChange={() => undefined}
      />,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveStyle({ height: "240px", overflowY: "hidden" });

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Write" }));

    expect(screen.getByRole("textbox")).toHaveStyle({
      height: "240px",
      overflowY: "hidden",
    });
  });
});
