import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMemberSheetSectionsStore } from "@/hooks/useMemberSheetSectionsStore";
import { RecordSectionCard } from "./RecordSectionCard";

afterEach(() => {
  useMemberSheetSectionsStore.setState({ collapsedSections: {} });
  localStorage.removeItem("ft-member-sheet-sections");
});

describe("RecordSectionCard", () => {
  it("collapses and re-expands its body via the header toggle", () => {
    render(
      <RecordSectionCard sectionId="events" title="Life Events">
        <p>Event body</p>
      </RecordSectionCard>,
    );

    const toggle = screen.getByRole("button", { name: "Life Events" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Event body")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Event body")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Event body")).toBeInTheDocument();
  });

  it("keeps header actions visible regardless of collapsed state", () => {
    render(
      <RecordSectionCard
        sectionId="documents"
        title="Documents"
        headerActions={<button type="button">Add</button>}
      >
        <p>Document body</p>
      </RecordSectionCard>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.queryByText("Document body")).not.toBeInTheDocument();
  });

  it("shares collapsed state across mounts by section id", () => {
    const { unmount } = render(
      <RecordSectionCard sectionId="stories" title="Stories">
        <p>Story body</p>
      </RecordSectionCard>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    unmount();

    render(
      <RecordSectionCard sectionId="stories" title="Stories">
        <p>Story body</p>
      </RecordSectionCard>,
    );

    expect(screen.getByRole("button", { name: "Stories" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Story body")).not.toBeInTheDocument();
  });
});
