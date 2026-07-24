import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { SessionExpiryBanner } from "./SessionExpiryBanner";

describe("SessionExpiryBanner", () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: "authenticated",
      sessionExpiringSoon: true,
      sessionRefreshFailed: false,
      reloginRequired: false,
    });
  });

  afterEach(() => {
    useAuthStore.setState({
      status: "unauthenticated",
      sessionExpiringSoon: false,
      sessionRefreshFailed: false,
      reloginRequired: false,
    });
  });

  it("reserves space for the sidebar trigger", () => {
    render(<SessionExpiryBanner />);

    expect(screen.getByRole("alert")).toHaveClass("pl-16");
  });

  it("offers in-place re-login when automatic renewal failed", () => {
    useAuthStore.setState({ sessionRefreshFailed: true });
    render(<SessionExpiryBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in now" }));

    expect(useAuthStore.getState().reloginRequired).toBe(true);
  });
});
