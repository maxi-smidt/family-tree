import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BookOpen, CalendarDays } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/shared/Meter";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { memberFullName } from "@/components/shared/MemberChip";
import type { LifeSpan, NameCount, StatisticsReport } from "@/types/statistics";
import type { Member } from "@/types/member";
import type { Event } from "@/types/event";
import type { Story } from "@/types/story";
import { getEventTypeLabel } from "@/types/eventTypes";
import { resolveDateLocale } from "@/utils/dateUtils";
import i18n from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { ChartTooltipContent } from "./ChartTooltipContent";
import { buildOnThisDayItems, type OnThisDayItem } from "./onThisDay";

type T = (key: string, opts?: Record<string, unknown>) => string;

const GENDER_COLORS = {
  male: "var(--color-chart-gender-male)",
  female: "var(--color-chart-gender-female)",
  other: "var(--color-chart-gender-other)",
  unknown: "var(--color-chart-gender-unknown)",
};
const BIRTH_COLOR = "var(--color-chart-birth)";
const DEATH_COLOR = "var(--color-chart-death)";

/** How far ahead "Coming up" looks, and how many entries it lists. */
const UPCOMING_WINDOW_DAYS = 60;
const UPCOMING_LIMIT = 5;

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Births and deaths by decade                                              */
/* ------------------------------------------------------------------------ */

export function DecadeChartCard({
  report,
  t,
  className,
}: {
  report: StatisticsReport;
  t: T;
  className?: string;
}) {
  // The report lists only decades with data; fill the gaps so the x-axis is
  // continuous and an empty decade reads as zero rather than disappearing.
  const data = useMemo(() => {
    const rows = report.birth_death_by_decade;
    if (rows.length === 0) return rows;
    const byStart = new Map(rows.map((r) => [parseInt(r.decade, 10), r]));
    const starts = [...byStart.keys()].filter((n) => !Number.isNaN(n));
    if (starts.length !== rows.length) return rows;
    const first = Math.min(...starts);
    const last = Math.max(...starts);
    const filled = [];
    for (let y = first; y <= last; y += 10) {
      filled.push(byStart.get(y) ?? { decade: `${y}s`, births: 0, deaths: 0 });
    }
    return filled;
  }, [report.birth_death_by_decade]);
  const busiest = useMemo(
    () =>
      data.reduce<(typeof data)[number] | null>(
        (best, d) => (!best || d.births > best.births ? d : best),
        null,
      ),
    [data],
  );
  if (data.length === 0) return null;

  const decadeName = (decade: string) =>
    t("decade", { year: decade.replace(/s$/, "") });
  const shortDecade = (decade: string) =>
    data.length > 12 ? decade.replace(/s$/, "") : `'${decade.slice(2, 4)}`;

  return (
    <Card className={cn("min-h-80", className)}>
      <CardHeader>
        <CardTitle>
          <h2>{t("timeline-title")}</h2>
        </CardTitle>
        <CardDescription>{t("timeline-hint")}</CardDescription>
        <CardAction className="flex gap-4">
          <LegendKey color={BIRTH_COLOR} label={t("timeline-births")} />
          <LegendKey color={DEATH_COLOR} label={t("timeline-deaths")} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="min-h-52 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="decade"
                tickFormatter={shortDecade}
                tick={{ fontSize: 11.5, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-input)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11.5, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)", opacity: 0.6 }}
                content={({ active, label, payload }) => (
                  <ChartTooltipContent
                    active={active}
                    label={
                      typeof label === "string" ? decadeName(label) : label
                    }
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
                name="births"
                fill={BIRTH_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={16}
              />
              <Bar
                dataKey="deaths"
                name="deaths"
                fill={DEATH_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {busiest && busiest.births > 0 && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {t("timeline-busiest", {
              decade: decadeName(busiest.decade),
              count: busiest.births,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Gender + coming up                                                        */
/* ------------------------------------------------------------------------ */

function GenderBar({ report, t }: { report: StatisticsReport; t: T }) {
  const g = report.gender_distribution;
  const data = [
    { key: "male", name: t("gender-male"), value: g.male },
    { key: "female", name: t("gender-female"), value: g.female },
    { key: "other", name: t("gender-other"), value: g.other },
    { key: "unknown", name: t("gender-unknown"), value: g.unknown },
  ].filter((d) => d.value > 0);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;
  return (
    <div>
      <div
        role="img"
        aria-label={data.map((d) => `${d.name}: ${d.value}`).join(", ")}
        className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {data.map((d) => (
          <span
            key={d.key}
            style={{
              flexGrow: d.value,
              backgroundColor:
                GENDER_COLORS[d.key as keyof typeof GENDER_COLORS],
            }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <li
            key={d.key}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{
                backgroundColor:
                  GENDER_COLORS[d.key as keyof typeof GENDER_COLORS],
              }}
            />
            {d.name}
            <b className="font-semibold text-foreground tabular-nums">
              {d.value}
            </b>
            <span className="tabular-nums">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function upcomingTitle(item: OnThisDayItem, t: T): string {
  const name = item.member
    ? item.member.firstName || memberFullName(item.member)
    : "";
  switch (item.kind) {
    case "birthday":
      return item.years !== undefined
        ? t("upcoming-birthday", { name, age: item.years })
        : t("upcoming-birthday-unknown", { name });
    case "would-turn":
      return t("upcoming-would-turn", { name, age: item.years });
    case "death-anniversary":
      return t("upcoming-death-anniversary", { name, count: item.years });
    case "event":
      return `${getEventTypeLabel(item.eventType ?? "", i18n.t)} · ${t("on-this-day-years-ago", { count: item.years })}`;
    case "story":
      return item.title ?? "";
  }
}

function UpcomingList({
  members,
  events,
  stories,
  onOpenMember,
  t,
}: {
  members: Member[];
  events: Event[];
  stories: Story[];
  onOpenMember: (memberId: string) => void;
  t: T;
}) {
  const items = useMemo(
    () =>
      buildOnThisDayItems(
        members,
        events,
        stories,
        new Date(),
        UPCOMING_WINDOW_DAYS,
      ).slice(0, UPCOMING_LIMIT),
    [members, events, stories],
  );
  const locale = resolveDateLocale();
  const dateFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const relFmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (items.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {t("upcoming-empty")}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => {
        const member = item.member ?? item.linkedMembers[0];
        const title = upcomingTitle(item, t);
        const Icon = item.kind === "story" ? BookOpen : CalendarDays;
        const body = (
          <>
            {item.member ? (
              <MemberAvatar
                member={item.member}
                size="sm"
                className={cn(item.kind !== "birthday" && "opacity-75")}
              />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold">
                {title}
              </span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {dateFmt.format(item.date)}
                {!item.member &&
                  item.linkedMembers.length > 0 &&
                  ` · ${item.linkedMembers.map((m) => m.firstName).join(", ")}`}
              </span>
            </span>
            <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
              {relFmt.format(item.dayOffset, "day")}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            {member ? (
              <button
                type="button"
                onClick={() => onOpenMember(member.id)}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function GenderUpcomingCard({
  report,
  members,
  events,
  stories,
  onOpenMember,
  t,
  className,
}: {
  report: StatisticsReport;
  members: Member[];
  events: Event[];
  stories: Story[];
  onOpenMember: (memberId: string) => void;
  t: T;
  className?: string;
}) {
  const g = report.gender_distribution;
  const recorded = g.male + g.female + g.other;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{t("gender-title")}</h2>
        </CardTitle>
        <CardDescription>
          {t("gender-description", { count: recorded })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <GenderBar report={report} t={t} />
        <div className="border-t pt-4">
          <h3 className="text-sm font-bold">{t("upcoming-title")}</h3>
          <p className="mb-1 text-[13px] text-muted-foreground">
            {t("upcoming-description", { count: UPCOMING_WINDOW_DAYS })}
          </p>
          <UpcomingList
            members={members}
            events={events}
            stories={stories}
            onOpenMember={onOpenMember}
            t={t}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Lives lived                                                               */
/* ------------------------------------------------------------------------ */

export function LivesLivedCard({
  report,
  onOpenMember,
  t,
  className,
}: {
  report: StatisticsReport;
  onOpenMember: (memberId: string) => void;
  t: T;
  className?: string;
}) {
  const lives = report.longest_lives ?? [];
  if (lives.length === 0) return null;

  const end = new Date().getFullYear();
  const minBirth = Math.min(...lives.map((l) => l.birth_year));
  const span0 = end - minBirth;
  const step = span0 > 250 ? 100 : 50;
  const start = Math.floor(minBirth / step) * step;
  const span = Math.max(1, end - start);
  const ticks: number[] = [];
  for (let y = start; y < end - step / 3; y += step) ticks.push(y);
  const pct = (year: number) => ((year - start) / span) * 100;
  const truncated = report.members_with_death_date > lives.length;

  const nameOf = (l: LifeSpan) =>
    [l.first_name, l.last_name].filter(Boolean).join(" ");

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{t("lives-title")}</h2>
        </CardTitle>
        <CardDescription>
          {truncated
            ? t("lives-description-longest", {
                count: lives.length,
                start,
              })
            : t("lives-description", { start })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {lives.map((life) => {
            const name = nameOf(life);
            return (
              <li
                key={life.member_id}
                className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.75rem] items-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => onOpenMember(life.member_id)}
                  className="truncate rounded-sm text-left text-[13px] font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  title={name}
                >
                  {name}
                </button>
                <div
                  className="relative h-2.5 rounded-full bg-muted"
                  title={`${life.birth_year} – ${life.death_year}`}
                >
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: `${pct(life.birth_year)}%`,
                      width: `${Math.max(1, pct(life.death_year) - pct(life.birth_year))}%`,
                      backgroundColor: DEATH_COLOR,
                    }}
                  />
                </div>
                <span className="text-right text-[12.5px] text-muted-foreground tabular-nums">
                  {t("lives-age", { count: life.age })}
                </span>
              </li>
            );
          })}
        </ul>
        <div
          aria-hidden="true"
          className="mt-3 grid grid-cols-[minmax(0,7.5rem)_1fr_2.75rem] gap-3"
        >
          <span />
          <div className="relative h-4 text-[11.5px] text-muted-foreground tabular-nums">
            {ticks.map((y) => (
              <span
                key={y}
                className="absolute -translate-x-1/2 first:translate-x-0"
                style={{ left: `${pct(y)}%` }}
              >
                {y}
              </span>
            ))}
            <span className="absolute right-0">{t("lives-today")}</span>
          </div>
          <span />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Ranked lists (birthplaces, names)                                         */
/* ------------------------------------------------------------------------ */

function RankedList({ items }: { items: NameCount[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.name}>
          <Meter
            label={item.name}
            valueLabel={
              <span className="font-semibold text-foreground">
                {item.count}
              </span>
            }
            value={item.count / max}
          />
        </li>
      ))}
    </ul>
  );
}

export function RankedCard({
  title,
  description,
  items,
  className,
}: {
  title: string;
  description?: string;
  items: NameCount[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <RankedList items={items} />
      </CardContent>
    </Card>
  );
}

/** First and family names side by side; a column only shows recurring names. */
export function NamesCard({
  first,
  last,
  t,
  className,
}: {
  first: NameCount[];
  last: NameCount[];
  t: T;
  className?: string;
}) {
  const columns = [
    { key: "first", title: t("first-names-title"), items: first },
    { key: "last", title: t("last-names-title"), items: last },
  ].filter((c) => c.items.length > 0);
  if (columns.length === 0) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{t("names-title")}</h2>
        </CardTitle>
        <CardDescription>{t("names-description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {columns.map((c) => (
          <section key={c.key}>
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {c.title}
            </h3>
            <RankedList items={c.items} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Completeness                                                              */
/* ------------------------------------------------------------------------ */

export function CompletenessCard({
  report,
  stories,
  t,
  onReview,
  className,
}: {
  report: StatisticsReport;
  stories: Story[];
  t: T;
  onReview?: () => void;
  className?: string;
}) {
  const total = report.total_members;
  const withStory = useMemo(
    () => new Set(stories.flatMap((s) => s.linkedMemberIds)).size,
    [stories],
  );
  const rows = [
    { key: "birth-dates", n: report.members_with_birth_date },
    { key: "birthplaces", n: report.members_with_birthplace ?? 0 },
    { key: "stories", n: Math.min(withStory, total) },
    { key: "photos", n: report.members_with_photo ?? 0 },
  ];
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{t("completeness-title")}</h2>
        </CardTitle>
        <CardDescription>{t("completeness-description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {rows.map((row) => {
          const ratio = total ? row.n / total : 0;
          return (
            <Meter
              key={row.key}
              label={t(`completeness-${row.key}`)}
              valueLabel={`${row.n} / ${total}`}
              value={ratio}
              tone={ratio < 0.25 ? "warning" : "primary"}
            />
          );
        })}
        {onReview && (
          <Button
            variant="outline"
            size="sm"
            className="mt-auto self-start"
            onClick={onReview}
          >
            {t("completeness-review")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
