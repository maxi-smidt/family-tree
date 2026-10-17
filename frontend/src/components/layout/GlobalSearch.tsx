import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Search } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import { shortLifeSpan } from "@/components/shared/MemberChip";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useNavEntries } from "@/hooks/useNavEntries";
import { getEventTypeLabel } from "@/types/eventTypes";
import { memberMatchesSearch } from "@/utils/memberUtils";
import { formatDate } from "@/utils/dateUtils";
import { cn } from "@/lib/utils";

const MAX_PEOPLE = 8;
const MAX_PLACES = 5;
const MAX_EVENTS = 5;

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The header's search: one palette (⌘K / Ctrl K) for people, places and
 * events in the open workspace, plus every view to jump to. Picking a person
 * opens their panel; a place opens the map on it; an event opens the timeline.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "layout.search",
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceId = useWorkspaceStore((s) => s.selectedTree?.id);
  const members = useMemberStore((s) => s.members);
  const setPendingLocateMemberId = useMemberStore(
    (s) => s.setPendingLocateMemberId,
  );
  const events = useEventStore((s) => s.events);
  const setOpenSheet = useMemberSheetStore((s) => s.setOpenSheet);
  const setMapFocus = useNavigationStore((s) => s.setMapFocus);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const { groups, open: openEntry } = useNavEntries(() => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();

  const people = useMemo(
    () =>
      q
        ? members
            .filter((m) =>
              memberMatchesSearch(m, query, {
                birth: m.date.birth,
                death: m.date.death,
              }),
            )
            .slice(0, MAX_PEOPLE)
        : [],
    [members, q, query],
  );

  const places = useMemo(() => {
    if (!q) return [];
    const counts = new Map<string, number>();
    for (const m of members) {
      const all = [
        m.birthplace,
        m.hometown,
        m.cemetery,
        ...m.placesLived.map((p) => p.location),
      ];
      for (const place of new Set(all.filter((p): p is string => !!p))) {
        if (place.toLowerCase().includes(q))
          counts.set(place, (counts.get(place) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PLACES);
  }, [members, q]);

  const matchingEvents = useMemo(
    () =>
      q
        ? events
            .filter(
              (e) =>
                getEventTypeLabel(e.eventType, i18n.t)
                  .toLowerCase()
                  .includes(q) ||
                !!e.location?.toLowerCase().includes(q) ||
                !!e.description?.toLowerCase().includes(q),
            )
            .slice(0, MAX_EVENTS)
        : [],
    [events, q, i18n.t],
  );

  const destinations = useMemo(
    () =>
      groups
        .flatMap((g) => g.entries)
        .filter((entry) => !q || entry.label.toLowerCase().includes(q)),
    [groups, q],
  );

  const openPerson = (memberId: string) => {
    setOpen(false);
    if (!workspaceId) return;
    // Open their panel and centre the canvas on them once the tree is up.
    setPendingLocateMemberId(memberId);
    setOpenSheet(workspaceId, { memberId, tab: "identity", mode: "view" });
  };

  const openPlace = (location: string) => {
    setOpen(false);
    setMapFocus({ location });
    navigateTo("map-view");
  };

  const openTimeline = () => {
    setOpen(false);
    navigateTo("timeline-view");
  };

  const shortcut = isMac ? "⌘K" : "Ctrl K";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-input hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none max-md:w-9 max-md:justify-center max-md:px-0 md:w-56 2xl:w-72",
          className,
        )}
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left max-md:hidden">
          {t("placeholder")}
        </span>
        <kbd className="rounded border bg-background px-1.5 font-sans text-[11px] max-md:hidden">
          {shortcut}
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase [&_[cmdk-item]]:gap-3 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              className="h-12"
            />
            <CommandList className="max-h-[min(60vh,28rem)]">
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {people.length > 0 && (
                <CommandGroup heading={t("people")}>
                  {people.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`person-${m.id}`}
                      onSelect={() => openPerson(m.id)}
                    >
                      <MemberAvatar member={m} size="sm" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {[m.firstName, m.lastName].filter(Boolean).join(" ")}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {shortLifeSpan(m)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {places.length > 0 && (
                <CommandGroup heading={t("places")}>
                  {places.map(([place, count]) => (
                    <CommandItem
                      key={place}
                      value={`place-${place}`}
                      onSelect={() => openPlace(place)}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                        <MapPin className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {place}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("people-count", { count })}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingEvents.length > 0 && (
                <CommandGroup heading={t("events")}>
                  {matchingEvents.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={`event-${e.id}`}
                      onSelect={openTimeline}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-warning-soft text-warning">
                        <CalendarDays className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {getEventTypeLabel(e.eventType, i18n.t)}
                        {e.location ? ` · ${e.location}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(e.date)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {destinations.length > 0 && (
                <CommandGroup heading={t("go-to")}>
                  {destinations.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <CommandItem
                        key={entry.key}
                        value={`view-${entry.key}`}
                        onSelect={() => openEntry(entry)}
                      >
                        <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">
                          <Icon className="size-4" />
                        </span>
                        <span className="font-medium">{entry.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
