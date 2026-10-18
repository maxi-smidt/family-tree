import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemberAvatar } from "./MemberAvatar";

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

describe("MemberAvatar", () => {
  it("rings a photo in the member's gender colour", () => {
    const { container } = render(
      <MemberAvatar
        member={{
          firstName: "Ada",
          lastName: "L",
          gender: "f",
          imageData: PHOTO,
        }}
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.className).toContain("ring-gender-f");
    expect(img.className).toContain("ring-2");
  });

  it("uses the neutral ring for other genders", () => {
    const { container } = render(
      <MemberAvatar
        member={{
          firstName: "Ada",
          lastName: "L",
          gender: "o",
          imageData: PHOTO,
        }}
        size="xl"
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.className).toContain("ring-gender-o");
    expect(img.className).toContain("ring-[3px]");
  });

  it("tints initials without a ring when there is no photo", () => {
    const { container } = render(
      <MemberAvatar
        member={{
          firstName: "Ada",
          lastName: "L",
          gender: "m",
          imageData: null,
        }}
      />,
    );
    const span = container.querySelector("span")!;
    expect(span.textContent).toBe("AL");
    expect(span.className).toContain("bg-gender-m-bg");
    expect(span.className).not.toContain("ring-");
  });
});
