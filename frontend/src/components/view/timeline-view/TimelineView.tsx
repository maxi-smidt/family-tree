import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Calendar,
  Plus,
  Pencil,
  Trash2,
  Search,
  Check,
  ChevronsUpDown,
  BookOpen,
} from "lucide-react";
import { EventDialog } from "./EventDialog";
import { Event } from "@/types/event";
import { Story } from "@/types/story";
import { getEventTypeInfo, getEventTypeLabel } from "@/types/eventTypes";
import { Member } from "@/types/member";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTranslation } from "react-i18next";
import { comparePartialDates, formatDateWithFallback } from "@/utils/dateUtils";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useTimelineSettings } from "@/hooks/useTimelineSettings";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { StoryDialog } from "@/components/shared/member-sheet/StoryDialog";
import { ContentCard } from "@/components/shared/content/ContentCard";

interface VitalEvent {
  kind: "vital";
  id: string;
  member: Member;
  type: "birth" | "death";
  date: string;
}

function TimelineSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center gap-4 p-1">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-9 w-62.5" />
      </div>
      <div className="relative flex-1">
        <div className="absolute bottom-0 left-8 top-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="relative ml-16 rounded-xl border p-4">
              <Skeleton className="absolute -left-10 top-6 h-4 w-4 rounded-full" />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-44" />
                </div>
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const setMapFocus = useNavigationStore((s) => s.setMapFocus);
  const navigateTo = useNavigationStore((s) => s.navigateTo);

  useDeferredStoreLoad(eventsInitialized, refreshEvents);
  useDeferredStoreLoad(storiesInitialized, refreshStories);
  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">(
    "all",
  );
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [isStoryDialogOpen, setIsStoryDialogOpen] = useState(false);
  const [storyToDelete, setStoryToDelete] = useState<Story | null>(null);
  const [showVitalEvents, setShowVitalEvents] = useState(true);
  const { showDetails, setShowDetails } = useTimelineSettings();

  const filteredEvents = useMemo(() => {
    let filtered = events;

    if (!showVitalEvents) {
      filtered = filtered.filter(
        (e) => e.eventType !== "birth" && e.eventType !== "death",
      );
    }

    if (selectedMemberId !== "all") {
      filtered = filtered.filter((e) =>
        e.linkedMemberIds.includes(selectedMemberId),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.eventType.toLowerCase().includes(query) ||
          e.location?.toLowerCase().includes(query) ||
          e.description?.toLowerCase().includes(query),
      );
    }

    return filtered.sort((a, b) => comparePartialDates(b.date, a.date));
  }, [events, selectedMemberId, searchQuery, showVitalEvents]);

  const filteredVitalEvents = useMemo(() => {
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

    let filtered = vitals;

    if (selectedMemberId !== "all") {
      filtered = filtered.filter((v) => v.member.id === selectedMemberId);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          t(v.type).toLowerCase().includes(query) ||
          `${v.member.firstName} ${v.member.lastName}`
            .toLowerCase()
            .includes(query),
      );
    }

    return filtered;
  }, [members, events, selectedMemberId, searchQuery, t]);

  const filteredStories = useMemo(() => {
    let filtered = stories;

    if (selectedMemberId !== "all") {
      filtered = filtered.filter((story) =>
        story.linkedMemberIds.includes(selectedMemberId),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (story) =>
          story.title.toLowerCase().includes(query) ||
          story.content.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [stories, selectedMemberId, searchQuery]);

  type TimelineItem =
    | { kind: "event"; data: Event }
    | { kind: "story"; data: Story }
    | { kind: "vital"; data: VitalEvent };

  const timelineItems = useMemo((): TimelineItem[] => {
    const eventItems: TimelineItem[] = filteredEvents.map((e) => ({
      kind: "event",
      data: e,
    }));
    const storyItems: TimelineItem[] = filteredStories.map((story) => ({
      kind: "story",
      data: story,
    }));
    const vitalItems: TimelineItem[] = showVitalEvents
      ? filteredVitalEvents.map((v) => ({
          kind: "vital",
          data: v,
        }))
      : [];
    return [...eventItems, ...storyItems, ...vitalItems].sort((a, b) =>
      comparePartialDates(b.data.date, a.data.date),
    );
  }, [filteredEvents, filteredStories, filteredVitalEvents, showVitalEvents]);

  const getMemberName = (memberId: string) => {
    const member = members.find((m) => m.id === memberId);
    return member
      ? `${member.firstName} ${member.lastName}`
      : t("member-fallback");
  };

  const getMemberNames = (memberIds: string[]) => {
    return memberIds.map(getMemberName).join(", ");
  };

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

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setIsEventDialogOpen(true);
  };

  const handleDeleteEvent = async () => {
    if (eventToDelete) {
      await removeEvent(eventToDelete.id);
      setEventToDelete(null);
    }
  };

  const handleEditStory = (story: Story) => {
    setEditingStory(story);
    setIsStoryDialogOpen(true);
  };

  const handleDeleteStory = async () => {
    if (storyToDelete) {
      await removeStory(storyToDelete.id);
      setStoryToDelete(null);
    }
  };

  if (!isReady) {
    return (
      <ViewLayout title={t("title")} action={<Skeleton className="h-8 w-28" />}>
        <TimelineSkeleton />
      </ViewLayout>
    );
  }

  return (
    <ViewLayout
      title={t("title")}
      action={
        <Button size="sm" onClick={handleAddEvent}>
          <Plus />
          {t("add-event")}
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("search-placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="show-vital-events"
              checked={showVitalEvents}
              onCheckedChange={setShowVitalEvents}
            />
            <label
              htmlFor="show-vital-events"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              {t("show-vital-events")}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="show-details"
              checked={showDetails}
              onCheckedChange={setShowDetails}
            />
            <label
              htmlFor="show-details"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              {t("show-details")}
            </label>
          </div>

          <Popover open={memberSelectOpen} onOpenChange={setMemberSelectOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={memberSelectOpen}
                className="w-62.5 max-w-full justify-between"
              >
                {selectedMemberId === "all"
                  ? t("all-members")
                  : members.find((m) => m.id === selectedMemberId)
                    ? `${members.find((m) => m.id === selectedMemberId)?.firstName} ${members.find((m) => m.id === selectedMemberId)?.lastName}`
                    : t("member-place-holder")}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-62.5 max-w-[calc(100vw-2rem)] p-0">
              <Command>
                <CommandInput placeholder={t("member-search-placeholder")} />
                <CommandList>
                  <CommandEmpty>{t("no-member")}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="all"
                      onSelect={() => {
                        setSelectedMemberId("all");
                        setMemberSelectOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedMemberId === "all"
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {t("all-members")}
                    </CommandItem>
                    <CommandSeparator />
                    {members.map((member) => (
                      <CommandItem
                        key={member.id}
                        value={`${member.firstName} ${member.lastName}`}
                        onSelect={() => {
                          setSelectedMemberId(member.id);
                          setMemberSelectOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedMemberId === member.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        {member.firstName} {member.lastName}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      }
      toolbarClassName="mb-6"
    >
      <div
        className={
          timelineItems.length === 0
            ? "flex min-h-0 flex-1 flex-col"
            : "space-y-4 pb-4"
        }
      >
        {timelineItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
            <Calendar className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">{t("no-events")}</p>
            <p className="text-sm">
              {searchQuery || selectedMemberId !== "all"
                ? t("adjust-filters")
                : t("add-an-event")}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute left-8 top-0 bottom-0 w-0.5 bg-border"
            />

            <div role="list">
              {timelineItems.map((item) => {
                const isStory = item.kind === "story";
                const markerClass = isStory
                  ? "bg-violet-500"
                  : item.kind === "event"
                    ? "bg-primary"
                    : "bg-muted-foreground";

                return (
                  <div
                    key={item.data.id}
                    role="listitem"
                    className="relative ml-16 mb-4"
                  >
                    <div
                      aria-hidden="true"
                      className={`absolute top-6 h-4 w-4 rounded-full border-4 border-background ${markerClass}`}
                      style={{ left: "-40px" }}
                    />
                    {item.kind === "event" ? (
                      <ContentCard
                        icon={getEventTypeInfo(item.data.eventType).icon}
                        title={getEventTypeLabel(item.data.eventType, i18n.t)}
                        metadata={
                          <span className="truncate text-sm text-muted-foreground">
                            · {getMemberNames(item.data.linkedMemberIds)}
                          </span>
                        }
                        date={formatDateWithFallback(item.data.date, i18n.t)}
                        location={item.data.location}
                        onShowLocationOnMap={() =>
                          handleShowEventOnMap(item.data)
                        }
                        description={item.data.description}
                        expanded={showDetails}
                        className="p-4 shadow-sm hover:shadow-md"
                        actions={
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("edit-event")}
                              onClick={() => handleEditEvent(item.data)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("delete-event")}
                              onClick={() => setEventToDelete(item.data)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </>
                        }
                      />
                    ) : item.kind === "story" ? (
                      <ContentCard
                        icon={BookOpen}
                        title={item.data.title}
                        metadata={
                          <span className="truncate text-sm text-muted-foreground">
                            · {getMemberNames(item.data.linkedMemberIds)}
                          </span>
                        }
                        date={
                          item.data.date
                            ? formatDateWithFallback(item.data.date, i18n.t)
                            : t("story-date-unknown")
                        }
                        description={item.data.content}
                        expanded={showDetails}
                        className="p-4 shadow-sm hover:shadow-md"
                        actions={
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("edit-story")}
                              onClick={() => handleEditStory(item.data)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t("delete-story")}
                              onClick={() => setStoryToDelete(item.data)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </>
                        }
                      />
                    ) : (
                      <ContentCard
                        icon={Calendar}
                        title={t(item.data.type)}
                        metadata={
                          <span className="truncate text-sm text-muted-foreground">
                            · {getMemberName(item.data.member.id)}
                          </span>
                        }
                        date={formatDateWithFallback(item.data.date, i18n.t)}
                        className="p-4 shadow-sm hover:shadow-md"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <EventDialog
        open={isEventDialogOpen}
        onOpenChange={setIsEventDialogOpen}
        event={editingEvent}
        initialMemberId={
          selectedMemberId !== "all"
            ? selectedMemberId
            : members.length > 0
              ? members[0].id
              : undefined
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
