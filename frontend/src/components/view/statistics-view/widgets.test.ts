import { describe, expect, it } from "vitest";
import { createMember, type Member } from "@/types/member";
import type { Event } from "@/types/event";
import type { Story } from "@/types/story";
import { buildOnThisDayItems } from "./widgets";

function makeMember(overrides: Partial<Member>): Member {
  return {
    ...createMember({ x: 0, y: 0 }),
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: "event-1",
    linkedMemberIds: [],
    eventType: "marriage",
    date: "2010-06-21",
    location: null,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    documentIds: [],
    ...overrides,
  };
}

function makeStory(overrides: Partial<Story>): Story {
  return {
    id: "story-1",
    linkedMemberIds: [],
    title: "A family memory",
    content: "A remembered day.",
    date: "2010-06-22",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    documentIds: [],
    ...overrides,
  };
}

describe("buildOnThisDayItems", () => {
  const referenceDate = new Date(2026, 5, 15);

  it("includes living birthdays plus deceased milestones on their exact dates", () => {
    const living = makeMember({
      id: "living",
      date: { birth: "1990-06-15", death: null },
    });
    const deceased = makeMember({
      id: "deceased",
      deceased: true,
      // Imported GEDCOM values retain their original wording. The exact
      // month/day comes from the genealogy sort keys, not Date parsing.
      date: {
        birth: "16 JUN 1950",
        death: "17 JUN 2020",
        birthSort: "1950-06-16",
        deathSort: "2020-06-17",
      },
    });

    const items = buildOnThisDayItems(
      [living, deceased],
      [],
      [],
      referenceDate,
    );

    expect(items).toMatchObject([
      {
        kind: "birthday",
        dayOffset: 0,
        member: { id: "living" },
        sourceYear: 1990,
      },
      {
        kind: "would-turn",
        dayOffset: 1,
        member: { id: "deceased" },
        age: 76,
        sourceYear: 1950,
      },
      {
        kind: "death-anniversary",
        dayOffset: 2,
        member: { id: "deceased" },
        age: 6,
        sourceYear: 2020,
      },
    ]);
  });

  it("skips dates without an exact month and day", () => {
    const partial = makeMember({
      id: "partial",
      date: { birth: "1990-06", death: null },
    });
    const approximate = makeMember({
      id: "approximate",
      date: {
        birth: "ABT 1980",
        death: null,
        birthSort: "1980-00-00",
      },
    });

    const items = buildOnThisDayItems(
      [partial, approximate],
      [makeEvent({ date: "2010-06" })],
      [makeStory({ date: "2010" })],
      referenceDate,
    );

    expect(items).toEqual([]);
  });

  it("includes upcoming events and stories while avoiding duplicate vital events", () => {
    const member = makeMember({ id: "member-1" });
    const items = buildOnThisDayItems(
      [member],
      [
        makeEvent({ id: "marriage", linkedMemberIds: [member.id] }),
        makeEvent({ id: "birth", eventType: "birth", date: "2010-06-21" }),
        makeEvent({ id: "outside-window", date: "2010-06-23" }),
      ],
      [
        makeStory({ id: "story", linkedMemberIds: [member.id] }),
        makeStory({ id: "outside-story", date: "2010-06-23" }),
      ],
      referenceDate,
    );

    expect(items).toMatchObject([
      {
        kind: "event",
        dayOffset: 6,
        eventType: "marriage",
        sourceYear: 2010,
        linkedMembers: [{ id: "member-1" }],
      },
      {
        kind: "story",
        dayOffset: 7,
        title: "A family memory",
        sourceYear: 2010,
        linkedMembers: [{ id: "member-1" }],
      },
    ]);
  });
});
