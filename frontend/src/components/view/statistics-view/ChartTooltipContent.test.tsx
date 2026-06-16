import { render, screen } from "@testing-library/react";
import type { TooltipPayload } from "recharts";
import { describe, expect, it } from "vitest";
import { ChartTooltipContent } from "./ChartTooltipContent";

const payload: TooltipPayload = [
  {
    color: "#7c3aed",
    dataKey: "births",
    graphicalItemId: "births",
    name: "births",
    value: 12,
  },
];

describe("ChartTooltipContent", () => {
  it("renders themed chart data with formatted labels", () => {
    const { container } = render(
      <ChartTooltipContent
        active
        label={1900}
        nameFormatter={() => "Births"}
        payload={payload}
        valueFormatter={(value) => `${value} people`}
      />,
    );

    expect(screen.getByText("1900")).toBeInTheDocument();
    expect(screen.getByText("Births")).toBeInTheDocument();
    expect(screen.getByText("12 people")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(
      "border",
      "bg-popover",
      "text-popover-foreground",
      "shadow-md",
    );
  });

  it("stays hidden without active chart data", () => {
    const { container, rerender } = render(
      <ChartTooltipContent active={false} payload={payload} />,
    );

    expect(container).toBeEmptyDOMElement();

    rerender(<ChartTooltipContent active payload={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
