import { describe, expect, it } from "vitest";
import { transcriptionErrorMessage } from "./transcriptionErrors";

const t = (key: string) => key;

describe("transcriptionErrorMessage", () => {
  it("maps known codes and keeps the provider's details", () => {
    expect(transcriptionErrorMessage(t, "timeout")).toBe("errors.timeout");
    expect(
      transcriptionErrorMessage(t, "provider_error: HTTP 400: bad key"),
    ).toBe("errors.provider_error (HTTP 400: bad key)");
  });

  it("falls back for unknown or missing codes", () => {
    expect(transcriptionErrorMessage(t, "something_new")).toBe(
      "errors.unknown",
    );
    expect(transcriptionErrorMessage(t, null)).toBe("errors.unknown");
  });
});
