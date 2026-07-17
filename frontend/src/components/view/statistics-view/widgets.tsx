import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { BookOpen, Cake, CalendarDays, Flower2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { StatisticsReport } from "@/types/statistics";
import { isDeceased, type Member } from "@/types/member";
import type { Event } from "@/types/event";
import type { Story } from "@/types/story";
import {
  getDatePrecision,
  getYear,
  isValidPartialDate,
  resolveDateLocale,
} from "@/utils/dateUtils";
import { getEventTypeLabel } from "@/types/eventTypes";
import i18n from "@/i18n/i18n";
import { ChartTooltipContent } from "./ChartTooltipContent";

const GENDER_COLORS = {
  male: "var(--color-chart-gender-male)",
  female: "var(--color-chart-gender-female)",
  other: "var(--color-chart-gender-other)",
  unknown: "var(--color-chart-gender-unknown)",
};

const BIRTH_COLOR = "var(--color-chart-birth)";
const DEATH_COLOR = "var(--color-chart-death)";
const NAME_COLOR = "var(--color-chart-birth)";

export interface StatisticsWidgetProps {
  report: StatisticsReport;
  t: (key: string, opts?: Record<string, unknown>) => string;
  members: Member[];
  events: Event[];
  stories: Story[];
  onOpenMember: (memberId: string) => void;
}

export type StatisticsWidgetId =
  | "on-this-day"
  | "gender"
  | "timeline"
  | "lifespan"
  | "first-names"
  | "last-names";

export interface StatisticsWidgetDefinition {
  id: StatisticsWidgetId;
  titleKey: string;
  Component: React.ComponentType<StatisticsWidgetProps>;
}

const ON_THIS_DAY_WINDOW_DAYS = 7;

export type OnThisDayItemKind =
  | "birthday"
  | "would-turn"
  | "death-anniversary"
  | "event"
  | "story";

export interface OnThisDayItem {
  id: string;
  kind: OnThisDayItemKind;
  date: Date;
  dayOffset: number;
  member?: Member;
  linkedMembers: Member[];
  age?: number;
  sourceYear?: number;
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

function createOnThisDayDates(referenceDate: Date): OnThisDayDate[] {
  return Array.from({ length: ON_THIS_DAY_WINDOW_DAYS + 1 }, (_, dayOffset) => {
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
): OnThisDayItem[] {
  const datesByMonthDay = new Map(
    createOnThisDayDates(referenceDate).map((entry) => [entry.monthDay, entry]),
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
            age: birthdayDate.date.getFullYear() - birthYear,
            sourceYear: birthYear,
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
          sourceYear: birthYear ?? undefined,
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
        age: deathDate.date.getFullYear() - deathYear,
        sourceYear: deathYear,
      });
    }
  }

  for (const event of events) {
    // Birth and death events mirror member vital dates and would otherwise
    // duplicate the birthday and death-anniversary entries above.
    if (["birth", "death"].includes(event.eventType.toLowerCase())) continue;
    const monthDay = monthDayFromGenealogyDate(event.date);
    const date = monthDay ? datesByMonthDay.get(monthDay) : undefined;
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
      sourceYear: getYear(event.date) ?? undefined,
    });
  }

  for (const story of stories) {
    const monthDay = monthDayFromGenealogyDate(story.date);
    const date = monthDay ? datesByMonthDay.get(monthDay) : undefined;
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
      sourceYear: getYear(story.date) ?? undefined,
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

function memberDisplayName(member: Member): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ");
}

function OnThisDayWidget({
  members,
  events,
  stories,
  onOpenMember,
  t,
}: StatisticsWidgetProps) {
  const today = new Date();
  const items = buildOnThisDayItems(members, events, stories, today);
  const groupedItems = items.reduce((groups, item) => {
    const group = groups.get(item.dayOffset) ?? [];
    group.push(item);
    groups.set(item.dayOffset, group);
    return groups;
  }, new Map<number, OnThisDayItem[]>());

  return (
    <Card className="flex h-[320px] flex-col p-4">
      <div className="mb-4 shrink-0">
        <h2 className="text-sm font-medium">{t("on-this-day-title")}</h2>
        <p className="text-xs text-muted-foreground">
          {new Intl.DateTimeFormat(resolveDateLocale(), {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          }).format(today)}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("on-this-day-empty")}
          </p>
        ) : (
          <div className="space-y-4">
            {[...groupedItems].map(([dayOffset, dayItems]) => {
              const date = dayItems[0].date;
              const entries = (
                <div className="space-y-1">
                  {dayItems.map((item) => {
                    const Icon =
                      item.kind === "birthday" || item.kind === "would-turn"
                        ? Cake
                        : item.kind === "death-anniversary"
                          ? Flower2
                          : item.kind === "event"
                            ? CalendarDays
                            : BookOpen;
                    const detail =
                      item.kind === "birthday"
                        ? t("on-this-day-birthday")
                        : item.kind === "would-turn"
                          ? t("on-this-day-would-turn", { age: item.age })
                          : item.kind === "death-anniversary"
                            ? t("on-this-day-death-anniversary", {
                                count: item.age,
                              })
                            : item.kind === "event"
                              ? getEventTypeLabel(item.eventType ?? "", i18n.t)
                              : item.title;
                    const sourceYear = item.sourceYear
                      ? ` · ${item.sourceYear}`
                      : "";
                    return (
                      <div
                        key={item.id}
                        className="flex gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          {item.member ? (
                            <p className="leading-5">
                              <button
                                type="button"
                                className="font-medium hover:underline"
                                onClick={() => onOpenMember(item.member!.id)}
                              >
                                {memberDisplayName(item.member)}
                              </button>{" "}
                              <span className="text-muted-foreground">
                                — {detail}
                                {sourceYear}
                              </span>
                            </p>
                          ) : (
                            <p className="truncate font-medium leading-5">
                              {detail}
                              {sourceYear}
                            </p>
                          )}
                          {item.description && (
                            <p className="line-clamp-1 text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                          {item.linkedMembers.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                              {item.linkedMembers.map((member) => (
                                <button
                                  key={member.id}
                                  type="button"
                                  className="text-xs text-primary hover:underline"
                                  onClick={() => onOpenMember(member.id)}
                                >
                                  {memberDisplayName(member)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
              if (dayOffset === 0) {
                return <div key={dayOffset}>{entries}</div>;
              }
              return (
                <section key={dayOffset}>
                  <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {new Intl.DateTimeFormat(resolveDateLocale(), {
                      weekday: "short",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }).format(date)}
                  </h3>
                  {entries}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function GenderChart({ report, t }: StatisticsWidgetProps) {
  const { gender_distribution: g } = report;
  const data = [
    { name: t("gender-male"), value: g.male, color: GENDER_COLORS.male },
    { name: t("gender-female"), value: g.female, color: GENDER_COLORS.female },
    { name: t("gender-other"), value: g.other, color: GENDER_COLORS.other },
    {
      name: t("gender-unknown"),
      value: g.unknown,
      color: GENDER_COLORS.unknown,
    },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("gender-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                hideLabel
                label={label}
                payload={payload}
              />
            )}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

function TimelineChart({ report, t }: StatisticsWidgetProps) {
  const data = report.birth_death_by_decade;
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("timeline-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="decade"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={(name) =>
                  name === "births"
                    ? t("timeline-births")
                    : t("timeline-deaths")
                }
                payload={payload}
              />
            )}
          />
          <Bar
            dataKey="births"
            fill={BIRTH_COLOR}
            radius={[3, 3, 0, 0]}
            name="births"
          />
          <Bar
            dataKey="deaths"
            fill={DEATH_COLOR}
            radius={[3, 3, 0, 0]}
            name="deaths"
          />
          <Legend
            iconType="square"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-foreground">
                {value === "births"
                  ? t("timeline-births")
                  : t("timeline-deaths")}
              </span>
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function LifespanChart({ report, t }: StatisticsWidgetProps) {
  const data = report.lifespan_distribution;
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("lifespan-title")}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="range"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("lifespan-people")}
                payload={payload}
              />
            )}
          />
          <Bar
            dataKey="count"
            fill={BIRTH_COLOR}
            radius={[3, 3, 0, 0]}
            name="count"
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function FirstNamesChart({ report, t }: StatisticsWidgetProps) {
  const data = report.top_first_names.slice(0, 10);
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("first-names-title")}</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(180, data.length * 28 + 40)}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            className="stroke-border"
          />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("names-count")}
                payload={payload}
              />
            )}
          />
          <Bar
            dataKey="count"
            fill={NAME_COLOR}
            radius={[0, 3, 3, 0]}
            name="count"
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function LastNamesChart({ report, t }: StatisticsWidgetProps) {
  const data = report.top_last_names.slice(0, 10);
  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-medium mb-4">{t("last-names-title")}</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(180, data.length * 28 + 40)}
      >
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            className="stroke-border"
          />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            content={({ active, label, payload }) => (
              <ChartTooltipContent
                active={active}
                label={label}
                nameFormatter={() => t("names-count")}
                payload={payload}
              />
            )}
          />
          <Bar
            dataKey="count"
            fill={NAME_COLOR}
            radius={[0, 3, 3, 0]}
            name="count"
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

export const STATISTICS_WIDGETS: StatisticsWidgetDefinition[] = [
  {
    id: "on-this-day",
    titleKey: "on-this-day-title",
    Component: OnThisDayWidget,
  },
  { id: "gender", titleKey: "gender-title", Component: GenderChart },
  { id: "timeline", titleKey: "timeline-title", Component: TimelineChart },
  { id: "lifespan", titleKey: "lifespan-title", Component: LifespanChart },
  {
    id: "first-names",
    titleKey: "first-names-title",
    Component: FirstNamesChart,
  },
  {
    id: "last-names",
    titleKey: "last-names-title",
    Component: LastNamesChart,
  },
];

export const ALL_WIDGET_IDS: StatisticsWidgetId[] = STATISTICS_WIDGETS.map(
  (w) => w.id,
);

export const WIDGET_MAP: Record<
  StatisticsWidgetId,
  StatisticsWidgetDefinition
> = Object.fromEntries(STATISTICS_WIDGETS.map((w) => [w.id, w])) as Record<
  StatisticsWidgetId,
  StatisticsWidgetDefinition
>;
