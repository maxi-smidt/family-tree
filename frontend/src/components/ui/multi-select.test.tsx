import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiSelect } from "./multi-select";

// Radix Popover / cmdk rely on APIs jsdom doesn't implement.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const OPTIONS = [
  { label: "Ada Lovelace", value: "1" },
  { label: "Alan Turing", value: "2" },
  { label: "Grace Hopper", value: "3" },
];

beforeEach(() => {
  // @ts-expect-error -- test-only polyfill
  global.ResizeObserver = MockResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.releasePointerCapture = vi.fn();
});

const openMenu = () => fireEvent.click(screen.getByRole("combobox"));

describe("MultiSelect hideSelectedOptions", () => {
  it("keeps already-selected options in the candidate list by default", async () => {
    render(
      <MultiSelect
        options={OPTIONS}
        defaultValue={["1"]}
        onValueChange={vi.fn()}
        hideSelectAll
      />,
    );

    openMenu();
    expect(
      await screen.findByRole("option", { name: /Ada Lovelace/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
  });

  it("drops selected options from the list while keeping them as removable chips", async () => {
    render(
      <MultiSelect
        options={OPTIONS}
        defaultValue={["1"]}
        onValueChange={vi.fn()}
        hideSelectAll
        hideSelectedOptions
      />,
    );

    // The selected member is still reviewable/removable in the trigger.
    expect(
      screen.getByRole("button", { name: /Remove Ada Lovelace/ }),
    ).toBeInTheDocument();

    openMenu();
    // Wait for the list to render, then assert Ada is not among the candidates.
    expect(
      await screen.findByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Grace Hopper/ }),
    ).toBeInTheDocument();
  });

  it("removes an option from the candidate list as soon as it is picked", async () => {
    const onValueChange = vi.fn();
    render(
      <MultiSelect
        options={OPTIONS}
        defaultValue={[]}
        onValueChange={onValueChange}
        hideSelectAll
        hideSelectedOptions
      />,
    );

    openMenu();
    fireEvent.click(await screen.findByRole("option", { name: /Alan Turing/ }));

    expect(onValueChange).toHaveBeenCalledWith(["2"]);
    // The picked option is no longer offered as a candidate.
    expect(
      screen.queryByRole("option", { name: /Alan Turing/ }),
    ).not.toBeInTheDocument();
  });

  it("excludes selected options from search results too", async () => {
    render(
      <MultiSelect
        options={OPTIONS}
        defaultValue={["1"]}
        onValueChange={vi.fn()}
        hideSelectAll
        hideSelectedOptions
      />,
    );

    openMenu();
    await screen.findByRole("option", { name: /Alan Turing/ });
    fireEvent.change(screen.getByPlaceholderText("Search options..."), {
      target: { value: "a" },
    });

    // "Ada" matches "a" but is already selected, so it stays hidden.
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
    // Other "a" matches remain selectable.
    expect(
      screen.getByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Grace Hopper/ }),
    ).toBeInTheDocument();
  });

  it("does not mutate the selected values (UI-only filtering)", async () => {
    const onValueChange = vi.fn();
    render(
      <MultiSelect
        options={OPTIONS}
        defaultValue={["1", "2"]}
        onValueChange={onValueChange}
        hideSelectAll
        hideSelectedOptions
      />,
    );

    // Merely opening the menu must not change the current selection.
    openMenu();
    // Both selected members are hidden, so only Grace remains as a candidate.
    expect(
      await screen.findByRole("option", { name: /Grace Hopper/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Alan Turing/ }),
    ).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
