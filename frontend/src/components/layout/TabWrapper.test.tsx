import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";
import { TabWrapper } from "./TabWrapper";

describe("TabWrapper", () => {
  it("provides a full-height flex column for the active tab panel", () => {
    render(
      <Tabs value="empty">
        <TabWrapper value="empty">
          <div>Empty content</div>
        </TabWrapper>
      </Tabs>,
    );

    expect(screen.getByText("Empty content").parentElement).toHaveClass(
      "flex",
      "flex-1",
      "flex-col",
      "min-h-0",
    );
  });
});
