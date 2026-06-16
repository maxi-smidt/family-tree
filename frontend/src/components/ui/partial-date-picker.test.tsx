import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartialDatePicker } from "./partial-date-picker";

function ControlledPicker({ initialValue }: { initialValue: string | null }) {
  const [value, setValue] = useState(initialValue);

  return (
    <PartialDatePicker
      value={value}
      onChange={setValue}
      placeholder="Pick a date"
    />
  );
}

describe("PartialDatePicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the selected date without opening the popover", () => {
    render(<ControlledPicker initialValue="2025-06-12" />);

    const clearButton = screen.getByRole("button", {
      name: /clear date|datum löschen/i,
    });
    fireEvent.pointerDown(clearButton);
    fireEvent.click(clearButton);

    expect(screen.getByText("Pick a date")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("opens an empty day picker on the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 14, 12));
    render(<ControlledPicker initialValue={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Pick a date/i }));

    const monthSelect = screen.getAllByRole("combobox")[0];
    const yearSelect = screen.getAllByRole("combobox")[1];
    expect(monthSelect).toHaveValue("5");
    expect(yearSelect).toHaveValue("2026");
  });
});
