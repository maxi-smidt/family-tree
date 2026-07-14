import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthenticatedImage } from "./AuthenticatedImage";

vi.mock("@/hooks/useMediaUrl", () => ({
  useMediaUrl: vi.fn(() => null),
}));

describe("AuthenticatedImage", () => {
  it("renders its fallback when protected media cannot be loaded", () => {
    render(
      <AuthenticatedImage
        src="/api/media/tree/image.webp"
        fallback={<span>Image unavailable</span>}
      />,
    );

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
  });
});
