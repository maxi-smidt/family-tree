import { describe, expect, it } from "vitest";

import { attachmentError } from "./attachmentUtils";

describe("attachmentError", () => {
  it("uses the backend-provided byte limit", () => {
    const file = new File(["four"], "notes.txt", { type: "text/plain" });

    expect(attachmentError(file, 3)).toBe("size");
    expect(attachmentError(file, 4)).toBeNull();
  });

  it("does not duplicate a fallback size limit", () => {
    const file = new File(["content"], "notes.txt", { type: "text/plain" });

    expect(attachmentError(file)).toBeNull();
  });
});
