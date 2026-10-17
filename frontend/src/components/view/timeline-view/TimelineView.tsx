import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  CalendarDays,
  ListCollapse,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { EventDialog } from "./EventDialog";
import { Event } from "@/types/event";
import { Story } from "@/types/story";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { Member } from "@/types/member";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTranslation } from "react-i18next";
import { comparePartialDates, formatDate, getYear } from "@/utils/dateUtils";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import {
  useTimelineSettings,
  type TimelineSortOrder,
} from "@/hooks/useTimelineSettings";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { StoryDialog } from "@/components/shared/member-sheet/StoryDialog";
import { ContentCard } from "@/components/shared/content/ContentCard";
import { SearchInput } from "@/components/shared/SearchInput";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { MemberPicker } from "@/components/shared/member-sheet/MemberPicker";

interface VitalEvent {
  kind: "vital";
  id: string;
  member: Member;
  type: "birth" | "death";
  date: string;
}

type TypeFilter = "all" | "birth" | "death" | "event" | "story";

type TimelineItem =
  | { kind: "event"; data: Event }
  | { kind: "story"; data: Story }
  | { kind: "vital"; data: VitalEvent };

/** Rail-dot colour per entry type; matches the filter chips. */
const DOT: Record<Exclude<TypeFilter, "all">, string> = {
  birth: "bg-chart-birth",
  death: "bg-muted-foreground",
  event: "bg-warning",
  story: "bg-gender-f",
};

const itemType = (item: TimelineItem): Exclude<TypeFilter, "all"> =>
  item.kind === "vital" ? item.data.type : item.kind;

function TimelineSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, group) => (
        <div key={group} className="space-y-4">
          <Skeleton className="h-6 w-24" />
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-start gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-0.5 size-2.5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export const TimelineView = () => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "timeline-view.view",
  });
  const { members } = useMemberStore();
  const {
    events,
    removeEvent,
    refreshEvents,
    initialized: eventsInitialized,
  } = useEventStore();
  const {
    stories,
    removeStory,
    refreshStories,
    initialized: storiesInitialized,
  } = useStoryStore();
  const isReady = useWorkspaceStore((state) => state.isReady);
  const canWrite = useWorkspaceStore((s) => s.selectedTree?.role !== "viewer");
  const setMapFocus = useNavigationStore((s) => s.setMapFocus);
  const navigateTo = useNavigationStore((s) => s.navigateTo);

  useDeferredStoreLoad(eventsInitialized, refreshEvents);
  useDeferredStoreLoad(storiesInitialized, refreshStories);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [isStoryDialogOpen, setIsStoryDialogOpen] = useState(false);
  const [storyToDelete, setStoryToDelete] = useState<Story | null>(null);
  const { showDetails, setShowDetails, sortOrder, setSortOrder } =
    useTimelineSettings();
  const groupRefs = useRef(new Map<string, HTMLElement>());

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  const getMemberName = (memberId: string) => {
    const member = membersById.get(memberId);
    return member
      ? `${member.firstName} ${member.lastName}`
      : t("member-fallback");
  };

  /** "Josef & Maria" for couples, the full name for one, a count for more. */
  const linkedTitle = (memberIds: string[]) => {
    const linked = memberIds
      .map((id) => membersById.get(id))
      .filter((m): m is Member => !!m);
    if (linked.length === 0) return "";
    if (linked.length === 1)
      return `${linked[0].firstName} ${linked[0].lastName}`;
    if (linked.length === 2)
      return `${linked[0].firstName} & ${linked[1].firstName}`;
    return t("linked-people", { count: linked.length });
  };

  // Member vitals that aren't already recorded as birth/death events.
  const vitalEvents = useMemo(() => {
    const vitals: VitalEvent[] = [];
    for (const member of members) {
      const hasBirthEvent = events.some(
        (e) => e.eventType === "birth" && e.linkedMemberIds.includes(member.id),
      );
      if (!hasBirthEvent && member.date.birth) {
        vitals.push({
          kind: "vital",
          id: `birth-${member.id}`,
          member,
          type: "birth",
          date: member.date.birth,
        });
      }
      const hasDeathEvent = events.some(
        (e) => e.eventType === "death" && e.linkedMemberIds.includes(member.id),
      );
      if (!hasDeathEvent && member.date.death) {
        vitals.push({
          kind: "vital",
          id: `death-${member.id}`,
          member,
          type: "death",
          date: member.date.death,
        });
      }
    }
    return vitals;
  }, [members, events]);

  const allItems = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [
      ...events.map((e) => ({ kind: "event" as const, data: e })),
      ...stories.map((story) => ({ kind: "story" as const, data: story })),
      ...vitalEvents.map((v) => ({ kind: "vital" as const, data: v })),
    ];
    return items;
  }, [events, stories, vitalEvents]);

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = {
      all: allItems.length,
      birth: 0,
      death: 0,
      event: 0,
      story: 0,
    };
    for (const item of allItems) {
      // Recorded birth/death events count with the vitals.
      const type =
        item.kind === "event" &&
        (item.data.eventType === "birth" || item.data.eventType === "death")
          ? item.data.eventType
          : itemType(item);
      counts[type] += 1;
    }
    return counts;
  }, [allItems]);

  const timelineItems = useMemo((): TimelineItem[] => {
    const query = searchQuery.trim().toLowerCase();
    const names = (ids: string[]) =>
      ids
        .map((id) => membersById.get(id))
        .filter((m): m is Member => !!m)
        .map((m) => `${m.firstName} ${m.lastName}`)
        .join(" ")
        .toLowerCase();
    const filtered = allItems.filter((item) => {
      if (typeFilter !== "all") {
        const type =
          item.kind === "event" &&
          (item.data.eventType === "birth" || item.data.eventType === "death")
            ? item.data.eventType
            : itemType(item);
        if (type !== typeFilter) return false;
      }
      if (selectedMemberId) {
        const ids =
          item.kind === "vital"
            ? [item.data.member.id]
            : item.data.linkedMemberIds;
        if (!ids.includes(selectedMemberId)) return false;
      }
      if (!query) return true;
      if (item.kind === "event") {
        const e = item.data;
        return (
          e.eventType.toLowerCase().includes(query) ||
          getEventTypeLabel(e.eventType, i18n.t)
            .toLowerCase()
            .includes(query) ||
          !!e.location?.toLowerCase().includes(query) ||
          !!e.description?.toLowerCase().includes(query) ||
          names(e.linkedMemberIds).includes(query)
        );
      }
      if (item.kind === "story") {
        const st = item.data;
        return (
          st.title.toLowerCase().includes(query) ||
          st.content.toLowerCase().includes(query) ||
          names(st.linkedMemberIds).includes(query)
        );
      }
      const v = item.data;
      return (
        t(v.type).toLowerCase().includes(query) ||
        `${v.member.firstName} ${v.member.lastName}`
          .toLowerCase()
          .includes(query) ||
        !!v.member.birthplace?.toLowerCase().includes(query)
      );
    });
    const dir = sortOrder === "oldest" ? 1 : -1;
    // Undated entries always sink to the end, whatever the direction.
    return filtered.sort((a, b) => {
      if (!a.data.date !== !b.data.date) return a.data.date ? -1 : 1;
      return dir * comparePartialDates(a.data.date, b.data.date);
    });
  }, [
    allItems,
    typeFilter,
    selectedMemberId,
    searchQuery,
    sortOrder,
    membersById,
    i18n.t,
    t,
  ]);

  // Group consecutive entries by decade (the list is already sorted).
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: TimelineItem[] }[] = [];
    for (const item of timelineItems) {
      const year = getYear(item.data.date);
      const key =
        year === null ? "undated" : String(Math.floor(year / 10) * 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else
        out.push({
          key,
          label: key === "undated" ? t("undated") : t("decade", { year: key }),
          items: [item],
        });
    }
    return out;
  }, [timelineItems, t]);

  const range = useMemo(() => {
    const years = allItems
      .map((i) => getYear(i.data.date))
      .filter((y): y is number => y !== null);
    return years.length ? Math.min(...years) : null;
  }, [allItems]);

  const handleAddEvent = () => {
    setEditingEvent(null);
    setIsEventDialogOpen(true);
  };

  // Cross-view "show on map" (#554): jump to the Map view focused on this
  // event's location. Passing the first linked member (if any) gives a more
  // focused view (e.g. selects them so their life path draws), but is purely
  // optional context — the location itself is the primary target.
  const handleShowEventOnMap = (event: Event) => {
    if (!event.location) return;
    setMapFocus({
      location: event.location,
      memberId: event.linkedMemberIds[0],
    });
    navigateTo("map-view");
  };

  const handleDeleteEvent = async () => {
    if (eventToDelete) {
      await removeEvent(eventToDelete.id);
      setEventToDelete(null);
    }
  };

  const handleDeleteStory = async () => {
    if (storyToDelete) {
      await removeStory(storyToDelete.id);
      setStoryToDelete(null);
    }
  };

  const shortDate = (date: string | null) =>
    date ? formatDate(date) || date : "—";

  const avatars = (ids: string[]) => (
    <span className="flex w-14 shrink-0 justify-end -space-x-1.5 pt-0.5">
      {ids
        .map((id) => membersById.get(id))
        .filter((m): m is Member => !!m)
        .slice(0, 3)
        .map((m) => (
          <MemberAvatar
            key={m.id}
            member={m}
            size="xs"
            className="ring-2 ring-background"
          />
        ))}
    </span>
  );

  const entryActions = (
    onEdit: () => void,
    onDelete: () => void,
    kind: "event" | "story",
  ) =>
    canWrite ? (
      <span className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t(kind === "event" ? "edit-event" : "edit-story")}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t(kind === "event" ? "delete-event" : "delete-story")}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </span>
    ) : undefined;

  const renderEntry = (item: TimelineItem) => {
    if (item.kind === "vital") {
      const v = item.data;
      const name = `${v.member.firstName} ${v.member.lastName}`;
      const birthYear = getYear(v.member.date.birth);
      const deathYear = getYear(v.member.date.death);
      const place =
        v.type === "birth" ? v.member.birthplace : v.member.cemetery;
      return (
        <div className="flex items-start gap-3 py-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {t(v.type === "birth" ? "vital-born" : "vital-died", { name })}
            </p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {[
                t(v.type),
                place,
                v.type === "death" && birthYear !== null && deathYear !== null
                  ? t("aged", { count: deathYear - birthYear })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {avatars([v.member.id])}
        </div>
      );
    }
    if (item.kind === "event") {
      const e = item.data;
      const who = linkedTitle(e.linkedMemberIds);
      const typeLabel = getEventTypeLabel(e.eventType, i18n.t);
      return (
        <div className="group flex items-start gap-3">
          <ContentCard
            icon={getEventTypeInfo(e.eventType).icon}
            title={who || typeLabel}
            metadata={
              who ? (
                <span className="truncate text-[12.5px] text-muted-foreground">
                  · {typeLabel}
                </span>
              ) : undefined
            }
            location={e.location}
            onShowLocationOnMap={() => handleShowEventOnMap(e)}
            description={e.description}
            expanded={showDetails || undefined}
            collapsible={!showDetails}
            className="min-w-0 flex-1 rounded-xl px-4 py-3 shadow-xs hover:bg-card"
            actions={entryActions(
              () => {
                setEditingEvent(e);
                setIsEventDialogOpen(true);
              },
              () => setEventToDelete(e),
              "event",
            )}
          />
          {avatars(e.linkedMemberIds)}
        </div>
      );
    }
    const st = item.data;
    return (
      <div className="group flex items-start gap-3">
        <ContentCard
          icon={BookOpen}
          title={st.title}
          metadata={
            st.linkedMemberIds.length > 0 ? (
              <span className="truncate text-[12.5px] text-muted-foreground">
                · {st.linkedMemberIds.map(getMemberName).join(", ")}
              </span>
            ) : undefined
          }
          description={st.content}
          expanded={showDetails || undefined}
          collapsible={!showDetails}
          className="min-w-0 flex-1 rounded-xl px-4 py-3 shadow-xs hover:bg-card"
          actions={entryActions(
            () => {
              setEditingStory(st);
              setIsStoryDialogOpen(true);
            },
            () => setStoryToDelete(st),
            "story",
          )}
        />
        {avatars(st.linkedMemberIds)}
      </div>
    );
  };

  const filtersActive =
    !!searchQuery || !!selectedMemberId || typeFilter !== "all";

  return (
    <ViewLayout
      title={t("title")}
      subtitle={
        isReady && range !== null
          ? t("subtitle", { from: range, count: allItems.length })
          : undefined
      }
      action={
        canWrite ? (
          <Button onClick={handleAddEvent}>
            <Plus />
            {t("add-event")}
          </Button>
        ) : undefined
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="chip"
            size="sm"
            spacing={2}
            value={typeFilter}
            onValueChange={(v) => v && setTypeFilter(v as TypeFilter)}
            aria-label={t("type-filter")}
            className="flex-wrap"
          >
            {(["all", "birth", "death", "event", "story"] as const).map(
              (key) => (
                <ToggleGroupItem key={key} value={key}>
                  {key !== "all" && (
                    <span
                      aria-hidden="true"
                      className={cn("size-2 rounded-full", DOT[key])}
                    />
                  )}
                  {t(`chip.${key}`)}
                  <span className="tabular-nums opacity-60">
                    {typeCounts[key]}
                  </span>
                </ToggleGroupItem>
              ),
            )}
          </ToggleGroup>
          <SearchInput
            size="sm"
            containerClassName="w-full sm:w-52"
            placeholder={t("search-placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
          />
          <div className="hidden flex-1 lg:block" />
          <div className="w-44">
            <MemberPicker
              members={members}
              value={selectedMemberId}
              onChange={setSelectedMemberId}
              placeholder={t("all-members")}
              noResultsText={t("no-member")}
              icon={<UserRound className="size-4 text-muted-foreground" />}
            />
          </div>
          <Select
            value={sortOrder}
            onValueChange={(v) => setSortOrder(v as TimelineSortOrder)}
          >
            <SelectTrigger size="sm" aria-label={t("sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="newest">{t("sort-newest")}</SelectItem>
              <SelectItem value="oldest">{t("sort-oldest")}</SelectItem>
            </SelectContent>
          </Select>
          <Toggle
            variant="outline"
            size="sm"
            pressed={showDetails}
            onPressedChange={setShowDetails}
            aria-label={t("show-details")}
            title={t("show-details")}
          >
            <ListCollapse />
          </Toggle>
        </div>
      }
    >
      {!isReady ? (
        <TimelineSkeleton />
      ) : timelineItems.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>{t("no-events")}</EmptyTitle>
            <EmptyDescription>
              {filtersActive ? t("adjust-filters") : t("add-an-event")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex gap-8 pb-4">
          <div className="min-w-0 flex-1">
            {groups.map((group) => (
              <section
                key={group.key}
                ref={(el) => {
                  if (el) groupRefs.current.set(group.key, el);
                  else groupRefs.current.delete(group.key);
                }}
                aria-label={group.label}
                className="mb-6 scroll-mt-2"
              >
                <h2 className="mb-2 flex items-baseline gap-2 pl-[calc(6.5rem+1.75rem)] max-sm:pl-0">
                  <span className="text-xl font-bold tracking-tight">
                    {group.label}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t("entries", { count: group.items.length })}
                  </span>
                </h2>
                <ol className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute top-2 bottom-2 left-[calc(6.5rem+0.75rem)] w-px bg-border max-sm:hidden"
                  />
                  {group.items.map((item) => (
                    <li
                      key={item.data.id}
                      className="relative grid grid-cols-[6.5rem_1.5rem_minmax(0,1fr)] items-start gap-x-1 py-1.5 max-sm:grid-cols-1"
                    >
                      <span className="pt-1 text-right text-[12.5px] text-muted-foreground tabular-nums max-sm:text-left">
                        {item.data.date
                          ? shortDate(item.data.date)
                          : item.kind === "story"
                            ? t("story-date-unknown")
                            : "—"}
                      </span>
                      <span
                        aria-hidden="true"
                        className="flex justify-center pt-2 max-sm:hidden"
                      >
                        <span
                          className={cn(
                            "relative size-2.5 rounded-full ring-4 ring-background",
                            DOT[itemType(item)],
                          )}
                        />
                      </span>
                      <div className="min-w-0">{renderEntry(item)}</div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          {groups.length > 2 && (
            <nav
              aria-label={t("jump-to")}
              className="sticky top-0 hidden w-28 shrink-0 self-start xl:block"
            >
              <p className="mb-2 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {t("jump-to")}
              </p>
              <div className="flex flex-col gap-0.5">
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className="w-full rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      groupRefs.current.get(g.key)?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </nav>
          )}
        </div>
      )}

      <EventDialog
        open={isEventDialogOpen}
        onOpenChange={setIsEventDialogOpen}
        event={editingEvent}
        initialMemberId={
          selectedMemberId ?? (members.length > 0 ? members[0].id : undefined)
        }
      />

      <StoryDialog
        open={isStoryDialogOpen}
        onOpenChange={setIsStoryDialogOpen}
        story={editingStory}
      />

      <ConfirmDeleteDialog
        open={!!eventToDelete}
        onOpenChange={() => setEventToDelete(null)}
        onConfirm={handleDeleteEvent}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description")}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />

      <ConfirmDeleteDialog
        open={!!storyToDelete}
        onOpenChange={() => setStoryToDelete(null)}
        onConfirm={handleDeleteStory}
        title={t("delete-story-dialog.title")}
        description={t("delete-story-dialog.description")}
        cancelText={t("delete-story-dialog.cancel")}
        confirmText={t("delete-story-dialog.delete")}
      />
    </ViewLayout>
  );
};
