import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function ControlledEditor({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <div data-testid="sheet-scroll" style={{ height: 120, overflowY: "auto" }}>
      <MarkdownEditor value={value} onChange={setValue} />
    </div>
  );
}

describe("MarkdownEditor", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLTextAreaElement) {
        return makeRect(0, 240);
      }

      if (this.getAttribute("data-testid") === "sheet-scroll") {
        return makeRect(0, 120);
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

  it("keeps the sheet scrolled toward the caret while typing", () => {
    render(<ControlledEditor initialValue={"line one\nline two"} />);

    const scrollContainer = screen.getByTestId("sheet-scroll");
    const textarea = screen.getByRole("textbox");
    scrollContainer.scrollTop = 80;
    textarea.focus();

    const nextValue = [
      "line one",
      "line two",
      "line three",
      "line four",
      "line five",
      "line six",
      "line seven",
      "line eight",
      "line nine",
      "line ten",
    ].join("\n");

    fireEvent.change(textarea, {
      target: {
        value: nextValue,
        selectionStart: nextValue.length,
        selectionEnd: nextValue.length,
      },
    });

    expect(textarea).toHaveStyle({ height: "240px", overflowY: "hidden" });
    expect(scrollContainer.scrollTop).toBeGreaterThan(80);
  });
});
