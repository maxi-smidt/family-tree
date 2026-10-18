import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContinuationControls } from "./ContinuationControls";

describe("ContinuationControls", () => {
  it("renders nothing when there is nothing to expand, continue, or reset", () => {
    const { container } = renderWithProviders(
      <ContinuationControls
        continuations={[]}
        atBudget={false}
        canExpandGeneration={false}
        onExpandGeneration={vi.fn()}
        onLoadMore={vi.fn()}
        onReset={vi.fn()}
      />,
      { reactFlow: true },
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a named continuation and advances the cursor when clicked", () => {
    const onLoadMore = vi.fn();
    renderWithProviders(
      <ContinuationControls
        continuations={[
          { section_id: "sec-1", section_name: "North America", remaining_count: 42 },
        ]}
        atBudget={false}
        canExpandGeneration={false}
        onExpandGeneration={vi.fn()}
        onLoadMore={onLoadMore}
        onReset={vi.fn()}
      />,
      { reactFlow: true },
    );

    const button = screen.getByText(/North America/);
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows the budget-reached message and hides expansion controls once the cap is hit", () => {
    const onReset = vi.fn();
    renderWithProviders(
      <ContinuationControls
        continuations={[{ section_id: null, section_name: null, remaining_count: 5 }]}
        atBudget={true}
        canExpandGeneration={true}
        onExpandGeneration={vi.fn()}
        onLoadMore={vi.fn()}
        onReset={onReset}
      />,
      { reactFlow: true },
    );

    expect(screen.queryByText(/more people/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("offers to expand the next generation when depth is not yet maxed", () => {
    const onExpandGeneration = vi.fn();
    renderWithProviders(
      <ContinuationControls
        continuations={[]}
        atBudget={false}
        canExpandGeneration={true}
        onExpandGeneration={onExpandGeneration}
        onLoadMore={vi.fn()}
        onReset={vi.fn()}
      />,
      { reactFlow: true },
    );

    fireEvent.click(screen.getByRole("button", { name: /expand next generation/i }));
    expect(onExpandGeneration).toHaveBeenCalledTimes(1);
  });
});
