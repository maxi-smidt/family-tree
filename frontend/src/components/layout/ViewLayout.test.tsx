import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ViewLayout } from "./ViewLayout";

describe("ViewLayout", () => {
  it("provides a full-height flex column for tab content", () => {
    const { getByTestId } = render(
      <ViewLayout title="Example">
        <div data-testid="content">Content</div>
      </ViewLayout>,
    );

    const contentArea = getByTestId("content").parentElement;

    expect(contentArea).toHaveClass("flex", "flex-1", "flex-col", "min-h-0");
    expect(contentArea?.parentElement).toHaveClass("flex-1");
  });
});
