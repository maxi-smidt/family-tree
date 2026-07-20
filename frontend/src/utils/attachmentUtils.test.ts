import { describe, expect, it } from "vitest";

import { attachmentError, getBaseName } from "./attachmentUtils";

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

describe("getBaseName", () => {
  it("strips a simple extension", () => {
    expect(getBaseName("IMG_1234.jpg")).toBe("IMG_1234");
  });

  it("strips only the last extension", () => {
    expect(getBaseName("photo.raw.jpg")).toBe("photo.raw");
  });

  it("keeps names without an extension untouched", () => {
    expect(getBaseName("README")).toBe("README");
  });

  it("treats a leading-dot dotfile as having no extension", () => {
    expect(getBaseName(".gitignore")).toBe(".gitignore");
  });

  it("trims surrounding whitespace before stripping", () => {
    expect(getBaseName("  photo.jpg  ")).toBe("photo");
  });
});
