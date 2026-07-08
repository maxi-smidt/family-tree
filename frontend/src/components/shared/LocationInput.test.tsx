import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n/i18n";
import { LocationInput } from "./LocationInput";

// GeocodeHint reaches for the active tree and hits TreeService; stub it so the
// test focuses on input wiring rather than the network preview.
vi.mock("./GeocodeHint", () => ({
  GeocodeHint: ({
    location,
    enabled,
  }: {
    location: string | null | undefined;
    enabled?: boolean;
  }) => (
    <div data-testid="geocode-hint" data-enabled={String(enabled ?? true)}>
      {location}
    </div>
  ),
}));

describe("LocationInput", () => {
  it("renders the current value", () => {
    render(<LocationInput value="Berlin" onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("Berlin");
  });

  it("coerces null value to an empty string", () => {
    render(<LocationInput value={null} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("calls onChange with the new string", () => {
    const onChange = vi.fn();
    render(<LocationInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Paris" },
    });
    expect(onChange).toHaveBeenCalledWith("Paris");
  });

  it("forwards the location and enabled flag to the geocode hint", () => {
    render(
      <LocationInput value="Rome" onChange={() => {}} geocodeEnabled={false} />,
    );
    const hint = screen.getByTestId("geocode-hint");
    expect(hint).toHaveTextContent("Rome");
    expect(hint).toHaveAttribute("data-enabled", "false");
  });

  it("renders trailing content next to the input", () => {
    render(
      <LocationInput
        value="Vienna"
        onChange={() => {}}
        trailing={<button>remove</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "remove" })).toBeInTheDocument();
  });
});
