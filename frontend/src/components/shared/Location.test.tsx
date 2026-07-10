import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n/i18n";
import { Location } from "./Location";

describe("Location", () => {
  it("renders the location text", () => {
    render(<Location location="Vienna, Austria" />);
    expect(screen.getByText("Vienna, Austria")).toBeInTheDocument();
  });

  it("renders a label prefix when provided", () => {
    render(<Location location="Vienna" label="Birthplace" />);
    expect(screen.getByText("Birthplace:")).toBeInTheDocument();
  });

  it("renders a decorative, non-interactive pin by default", () => {
    render(<Location location="Vienna" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the pin as a button and fires onShowOnMap when clicked", () => {
    const onShowOnMap = vi.fn();
    render(<Location location="Vienna" onShowOnMap={onShowOnMap} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onShowOnMap).toHaveBeenCalledOnce();
  });

  it("uses a custom showOnMapLabel for the interactive pin", () => {
    render(
      <Location
        location="Vienna"
        onShowOnMap={() => {}}
        showOnMapLabel="Open map"
      />,
    );
    expect(screen.getByRole("button", { name: "Open map" })).toBeInTheDocument();
  });

  it("renders trailing content after the location", () => {
    render(<Location location="Vienna" trailing={<span>(1990 – 1995)</span>} />);
    expect(screen.getByText("(1990 – 1995)")).toBeInTheDocument();
  });
});
