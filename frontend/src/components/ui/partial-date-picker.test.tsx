import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartialDatePicker } from "./partial-date-picker";
import { formatDate } from "@/utils/dateUtils";

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
    fireEvent.click(clearButton);

    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("shows the value as editable text in the locale's numeric format", () => {
    render(<ControlledPicker initialValue="2025-06-12" />);

    expect(screen.getByRole("textbox")).toHaveValue(formatDate("2025-06-12"));
  });

  it("opens an empty day picker on the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 14, 12));
    render(<ControlledPicker initialValue={null} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /open date picker|datumsauswahl öffnen/i,
      }),
    );

    const monthSelect = screen.getAllByRole("combobox")[0];
    const yearSelect = screen.getAllByRole("combobox")[1];
    expect(monthSelect).toHaveValue("5");
    expect(yearSelect).toHaveValue("2026");
  });

  it("parses typed dates into the internal partial-date format", () => {
    const onChange = vi.fn();
    render(
      <PartialDatePicker
        value={null}
        onChange={onChange}
        placeholder="Pick a date"
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2019" } });

    expect(onChange).toHaveBeenLastCalledWith("2019");
  });

  it("clears the value when the text is emptied", () => {
    const onChange = vi.fn();
    render(
      <PartialDatePicker
        value="2019-03-04"
        onChange={onChange}
        placeholder="Pick a date"
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
