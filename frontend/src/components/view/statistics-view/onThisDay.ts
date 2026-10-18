import { isDeceased, type Member } from "@/types/member";
import type { Event } from "@/types/event";
import type { Story } from "@/types/story";
import {
  getDatePrecision,
  getYear,
  isValidPartialDate,
} from "@/utils/dateUtils";

export const ON_THIS_DAY_WINDOW_DAYS = 7;

export type OnThisDayItemKind =
  "birthday" | "would-turn" | "death-anniversary" | "event" | "story";

export interface OnThisDayItem {
  id: string;
  kind: OnThisDayItemKind;
  date: Date;
  dayOffset: number;
  member?: Member;
  linkedMembers: Member[];
  years?: number;
  eventType?: string;
  title?: string;
  description?: string | null;
}

interface OnThisDayDate {
  date: Date;
  dayOffset: number;
  monthDay: string;
}

function monthDayFromGenealogyDate(
  value: string | null | undefined,
  sortKey?: string | null,
): string | null {
  // Imported GEDCOM dates may be human-readable (for example, "15 JUN 1950")
  // while their sort key is the exact ISO day. Fuzzy dates intentionally have
  // zeroes in the sort key and therefore do not pass this check.
  for (const candidate of [sortKey, value]) {
    if (
      candidate &&
      getDatePrecision(candidate) === "day" &&
      isValidPartialDate(candidate)
    ) {
      return candidate.slice(5);
    }
  }
  return null;
}

function genealogyYear(
  value: string | null | undefined,
  sortKey?: string | null,
): number | null {
  return getYear(sortKey) ?? getYear(value);
}

function createOnThisDayDates(
  referenceDate: Date,
  windowDays: number,
): OnThisDayDate[] {
  return Array.from({ length: windowDays + 1 }, (_, dayOffset) => {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() + dayOffset,
    );
    return {
      date,
      dayOffset,
      monthDay: `${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`,
    };
  });
}

/**
 * Builds the client-side upcoming-date feed without asking the browser to
 * parse genealogy strings. Only exact month-and-day values participate.
 */
export function buildOnThisDayItems(
  members: Member[],
  events: Event[],
  stories: Story[],
  referenceDate = new Date(),
  windowDays = ON_THIS_DAY_WINDOW_DAYS,
): OnThisDayItem[] {
  const datesByMonthDay = new Map(
    createOnThisDayDates(referenceDate, windowDays).map((entry) => [
      entry.monthDay,
      entry,
    ]),
  );
  const membersById = new Map(members.map((member) => [member.id, member]));
  const items: OnThisDayItem[] = [];

  for (const member of members) {
    const birthdayMonthDay = monthDayFromGenealogyDate(
      member.date.birth,
      member.date.birthSort,
    );
    const birthdayDate = birthdayMonthDay
      ? datesByMonthDay.get(birthdayMonthDay)
      : undefined;
    const birthYear = genealogyYear(member.date.birth, member.date.birthSort);
    if (birthdayDate) {
      if (isDeceased(member)) {
        if (birthYear !== null) {
          items.push({
            id: `would-turn:${member.id}:${birthdayDate.dayOffset}`,
            kind: "would-turn",
            date: birthdayDate.date,
            dayOffset: birthdayDate.dayOffset,
            member,
            linkedMembers: [],
            years: birthdayDate.date.getFullYear() - birthYear,
          });
        }
      } else {
        items.push({
          id: `birthday:${member.id}:${birthdayDate.dayOffset}`,
          kind: "birthday",
          date: birthdayDate.date,
          dayOffset: birthdayDate.dayOffset,
          member,
          linkedMembers: [],
          years:
            birthYear === null
              ? undefined
              : birthdayDate.date.getFullYear() - birthYear,
        });
      }
    }

    const deathMonthDay = monthDayFromGenealogyDate(
      member.date.death,
      member.date.deathSort,
    );
    const deathDate = deathMonthDay
      ? datesByMonthDay.get(deathMonthDay)
      : undefined;
    const deathYear = genealogyYear(member.date.death, member.date.deathSort);
    if (deathDate && deathYear !== null) {
      items.push({
        id: `death-anniversary:${member.id}:${deathDate.dayOffset}`,
        kind: "death-anniversary",
        date: deathDate.date,
        dayOffset: deathDate.dayOffset,
        member,
        linkedMembers: [],
        years: deathDate.date.getFullYear() - deathYear,
      });
    }
  }

  for (const event of events) {
    // Birth and death events mirror member vital dates and would otherwise
    // duplicate the birthday and death-anniversary entries above.
    if (["birth", "death"].includes(event.eventType.toLowerCase())) continue;
    const monthDay = monthDayFromGenealogyDate(event.date);
    const date = monthDay ? datesByMonthDay.get(monthDay) : undefined;
    const eventYear = getYear(event.date);
    if (!date) continue;
    items.push({
      id: `event:${event.id}:${date.dayOffset}`,
      kind: "event",
      date: date.date,
      dayOffset: date.dayOffset,
      linkedMembers: event.linkedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((member): member is Member => member !== undefined),
      eventType: event.eventType,
      description: event.description,
      years:
        eventYear === null ? undefined : date.date.getFullYear() - eventYear,
    });
  }

  for (const story of stories) {
    const monthDay = monthDayFromGenealogyDate(story.date);
    const date = monthDay ? datesByMonthDay.get(monthDay) : undefined;
    const storyYear = getYear(story.date);
    if (!date) continue;
    items.push({
      id: `story:${story.id}:${date.dayOffset}`,
      kind: "story",
      date: date.date,
      dayOffset: date.dayOffset,
      linkedMembers: story.linkedMemberIds
        .map((memberId) => membersById.get(memberId))
        .filter((member): member is Member => member !== undefined),
      title: story.title,
      description: story.content,
      years:
        storyYear === null ? undefined : date.date.getFullYear() - storyYear,
    });
  }

  const kindOrder: Record<OnThisDayItemKind, number> = {
    birthday: 0,
    "would-turn": 1,
    "death-anniversary": 2,
    event: 3,
    story: 4,
  };
  return items.sort(
    (a, b) =>
      a.dayOffset - b.dayOffset || kindOrder[a.kind] - kindOrder[b.kind],
  );
}
