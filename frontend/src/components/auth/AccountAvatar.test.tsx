import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountAvatar, profileInitials } from "./AccountAvatar";

vi.mock("@/components/ui/AuthenticatedImage", () => ({
  AuthenticatedImage: ({
    src,
    fallback,
  }: {
    src: string | null | undefined;
    fallback: ReactNode;
  }) => (src ? <img alt="" src={src} /> : fallback),
}));

describe("AccountAvatar", () => {
  it("prefers a profile image over the name fallback", () => {
    render(
      <AccountAvatar
        user={{
          first_name: "Ada",
          last_name: "Lovelace",
          profile_image_url: "/api/auth/profile/image/photo.webp",
        }}
      />,
    );

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "/api/auth/profile/image/photo.webp",
    );
    expect(screen.queryByTestId("account-initials")).not.toBeInTheDocument();
  });

  it("uses initials only when both profile names are available", () => {
    render(
      <AccountAvatar
        user={{
          first_name: "Ada",
          last_name: "Lovelace",
          profile_image_url: null,
        }}
      />,
    );

    expect(screen.getByTestId("account-initials")).toHaveTextContent("AL");
    expect(screen.queryByTestId("account-avatar-icon")).not.toBeInTheDocument();
  });

  it("uses the generic icon without a complete profile name", () => {
    render(
      <AccountAvatar
        user={{ first_name: "Ada", last_name: null, profile_image_url: null }}
      />,
    );

    expect(screen.getByTestId("account-avatar-icon")).toBeInTheDocument();
  });

  it("trims names before deriving initials", () => {
    expect(profileInitials(" Ada ", " Lovelace ")).toBe("AL");
    expect(profileInitials("Ada", null)).toBeNull();
  });
});
