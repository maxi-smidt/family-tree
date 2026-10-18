import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "@/hooks/useEventStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { createMember } from "@/types/member";
import type { Event } from "@/types/event";
import type { Story } from "@/types/story";
import { TimelineView } from "./TimelineView";

// Closed editors are unrelated to chronology. Keep the real view, stores,
// cards, date formatting and list rendering so a sorting regression is visible.
vi.mock("./EventDialog", () => ({ EventDialog: () => null }));
vi.mock("@/components/shared/member-sheet/StoryDialog", () => ({
  StoryDialog: () => null,
}));

function event(id: string, date: string): Event {
  return {
    id,
    eventType: "marriage",
    linkedMemberIds: [],
    date,
    location: id,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    documentIds: [],
  };
}

function story(title: string, date: string | null): Story {
  return {
    id: title,
    title,
    date,
    content: "",
    linkedMemberIds: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    documentIds: [],
  };
}

describe("TimelineView chronology", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ isReady: true, selectedTree: undefined });
    useMemberStore.setState({ members: [] });
    useEventStore.setState({ events: [], initialized: true });
    useStoryStore.setState({ stories: [], initialized: true });
  });

  it("renders events, stories and member vitals newest-first across partial dates, with undated content last", () => {
    useMemberStore.setState({
      members: [
        {
          ...createMember({ x: 0, y: 0 }),
          id: "member",
          firstName: "Vital",
          lastName: "Person",
          date: { birth: "2000-01-15", death: null },
        },
      ],
    });
    useEventStore.setState({
      events: [
        event("Year event", "2000"),
        event("Newest event", "2024-01-01"),
      ],
    });
    useStoryStore.setState({
      stories: [story("Undated story", null), story("Month story", "2000-01")],
    });

    render(<TimelineView />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    [
      "Newest event",
      "Vital Person",
      "Month story",
      "Year event",
      "Undated story",
    ].forEach((label, index) => expect(items[index]).toHaveTextContent(label));
  });
});
