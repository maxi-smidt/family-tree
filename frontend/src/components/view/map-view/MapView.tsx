import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { Switch } from "@/components/ui/switch";
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
import { MapPin, Check, ChevronsUpDown, LocateFixed } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
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
import { formatDate, formatDateWithFallback } from "@/utils/dateUtils";
import { getEventTypeLabel, getEventTypeInfo } from "@/types/eventTypes";
import { GeocodeResult } from "@/types/geocode";
import { Member } from "@/types/member";

// Fix Leaflet default icon paths in bundler environments
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

type LocationType =
  | "event"
  | "birthplace"
  | "hometown"
  | "cemetery"
  | "places-lived";

const LOCATION_COLORS: Record<LocationType, string> = {
  event: "var(--color-map-event)",
  birthplace: "var(--color-map-birthplace)",
  hometown: "var(--color-map-hometown)",
  cemetery: "var(--color-map-cemetery)",
  "places-lived": "var(--color-map-places-lived)",
};

const LOCATION_TYPES: LocationType[] = [
  "event",
  "birthplace",
  "hometown",
  "cemetery",
  "places-lived",
];

// Order used when picking which color shows first in the icon
const TYPE_PRIORITY: LocationType[] = [
  "event",
  "birthplace",
  "places-lived",
  "hometown",
  "cemetery",
];

interface LinkedMember {
  id: string;
  name: string;
}

interface LocationItem {
  type: LocationType;
  // Member-based items (birthplace/hometown/cemetery/places-lived): the
  // member this entry belongs to, so the popup name can link back to them.
  memberId?: string;
  memberName?: string;
  // Events: the linked members, so each name can link back individually.
  linkedMembers?: LinkedMember[];
  eventType?: string;
  date?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  description?: string | null;
}

interface LocationGroup {
  location: string;
  coord: GeocodeResult;
  items: LocationItem[];
  types: LocationType[];
}

function createGroupIcon(types: LocationType[]) {
  const sorted = [...new Set(types)].sort(
    (a, b) => TYPE_PRIORITY.indexOf(a) - TYPE_PRIORITY.indexOf(b),
  );
  const dots = sorted
    .map(
      (t) =>
        `<div style="width:16px;height:16px;border-radius:50%;` +
        `border:2.5px solid ${LOCATION_COLORS[t]};background:transparent;` +
        `box-shadow:0 1px 3px rgba(0,0,0,0.3);flex-shrink:0;"></div>`,
    )
    .join("");
  const w = sorted.length * 18;
  return L.divIcon({
    html: `<div style="display:flex;gap:2px;align-items:center;">${dots}</div>`,
    className: "",
    iconSize: [w, 16],
    iconAnchor: [w / 2, 8],
    popupAnchor: [0, -12],
  });
}

function FitBounds({
  groups,
  fitSignal,
}: {
  groups: LocationGroup[];
  fitSignal: number;
}) {
  const map = useMap();
  // Fit once, the first time points become available, so toggling a legend
  // chip or picking a member doesn't yank the user's pan/zoom away. Further
  // fits only happen when `fitSignal` changes (the explicit recenter button).
  const hasFitRef = useRef(false);
  const lastSignalRef = useRef(fitSignal);

  useEffect(() => {
    if (groups.length === 0) return;
    const signalChanged = lastSignalRef.current !== fitSignal;
    if (hasFitRef.current && !signalChanged) return;
    const points = groups
      .filter((g) => g.coord.lat !== null && g.coord.lon !== null)
      .map((g) => [g.coord.lat!, g.coord.lon!] as [number, number]);
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 10 });
      hasFitRef.current = true;
      lastSignalRef.current = fitSignal;
    }
  }, [groups, map, fitSignal]);
  return null;
}

// Renders a member's name as a clickable inline button that jumps to them in
// the tree view. Kept separate so both member-based and event popup items can
// share the same look/behavior.
function MemberNameLink({
  id,
  name,
  title,
  onShowMember,
}: {
  id: string;
  name: string;
  title: string;
  onShowMember: (memberId: string) => void;
}) {
  return (
    <button
      type="button"
      className="underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      title={title}
      aria-label={title}
      onClick={() => onShowMember(id)}
    >
      {name}
    </button>
  );
}

// A member-based popup line (birthplace/hometown/cemetery/places-lived): the
// member's clickable name plus the places-lived period, if any.
function MemberPopupItem({
  item,
  t,
  onShowMember,
}: {
  item: LocationItem;
  t: (key: string) => string;
  onShowMember: (memberId: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div>
        {item.memberId && item.memberName ? (
          <MemberNameLink
            id={item.memberId}
            name={item.memberName}
            title={t("show-in-tree")}
            onShowMember={onShowMember}
          />
        ) : (
          item.memberName
        )}
      </div>
      {item.type === "places-lived" && (item.dateFrom || item.dateTo) && (
        <p className="text-xs text-muted-foreground">
          {item.dateFrom && item.dateTo
            ? `${formatDate(item.dateFrom)} – ${formatDate(item.dateTo)}`
            : item.dateFrom
              ? `${t("from")} ${formatDate(item.dateFrom)}`
              : `${t("until")} ${formatDate(item.dateTo)}`}
        </p>
      )}
    </div>
  );
}

// An event popup line: the existing icon + type label + date + description,
// with the linked member names rendered as individually clickable links.
function EventPopupItem({
  item,
  t,
  i18nT,
  onShowMember,
}: {
  item: LocationItem;
  t: (key: string) => string;
  i18nT: (key: string) => string;
  onShowMember: (memberId: string) => void;
}) {
  const { icon: Icon } = item.eventType
    ? getEventTypeInfo(item.eventType)
    : { icon: MapPin };
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="w-3 h-3 shrink-0" />
        {item.eventType && getEventTypeLabel(item.eventType, i18nT)}
        {item.date && (
          <>
            {" · "}
            {formatDateWithFallback(item.date, i18nT)}
          </>
        )}
      </div>
      {item.linkedMembers && item.linkedMembers.length > 0 && (
        <div className="text-xs">
          {item.linkedMembers.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <MemberNameLink
                id={m.id}
                name={m.name}
                title={t("show-in-tree")}
                onShowMember={onShowMember}
              />
            </span>
          ))}
        </div>
      )}
      {item.description && (
        <p className="text-xs text-muted-foreground">{item.description}</p>
      )}
    </div>
  );
}

export const MapView = () => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "map-view.view",
  });
  const { members } = useMemberStore();
  const setPendingLocateMemberId = useMemberStore(
    (s) => s.setPendingLocateMemberId,
  );
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const {
    events,
    refreshEvents,
    initialized: eventsInitialized,
  } = useEventStore();
  const { coords, resolveLocations } = useGeocodeStore();
  const geocodePending = useGeocodeStore((s) => s.pendingCount > 0);

  useDeferredStoreLoad(eventsInitialized, refreshEvents);

  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">(
    "all",
  );
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [visibleLocationTypes, setVisibleLocationTypes] =
    useState<LocationType[]>(LOCATION_TYPES);
  const [fitSignal, setFitSignal] = useState(0);
  const visibleLocationTypeSet = useMemo(
    () => new Set(visibleLocationTypes),
    [visibleLocationTypes],
  );

  const showMemberInTree = (memberId: string) => {
    setPendingLocateMemberId(memberId);
    navigateTo("tree-view");
  };

  // Gather visible location strings from all sources for geocoding
  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    for (const m of members) {
      if (visibleLocationTypeSet.has("birthplace") && m.birthplace) {
        locs.add(m.birthplace);
      }
      if (visibleLocationTypeSet.has("hometown") && m.hometown) {
        locs.add(m.hometown);
      }
      if (visibleLocationTypeSet.has("cemetery") && m.cemetery) {
        locs.add(m.cemetery);
      }
      if (visibleLocationTypeSet.has("places-lived")) {
        for (const p of m.placesLived) {
          if (p.location) locs.add(p.location);
        }
      }
    }
    if (visibleLocationTypeSet.has("event")) {
      for (const e of events) {
        if (e.location) locs.add(e.location);
      }
    }
    return [...locs];
  }, [members, events, visibleLocationTypeSet]);

  useEffect(() => {
    if (allLocations.length > 0) resolveLocations(allLocations);
  }, [allLocations, resolveLocations]);

  const filteredMembers = useMemo(
    () =>
      selectedMemberId === "all"
        ? members
        : members.filter((m) => m.id === selectedMemberId),
    [members, selectedMemberId],
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((e) => {
        if (!e.location) return false;
        if (
          selectedMemberId !== "all" &&
          !e.linkedMemberIds.includes(selectedMemberId)
        )
          return false;
        if (dateFrom && e.date < dateFrom) return false;
        if (dateTo && e.date > dateTo) return false;
        return true;
      }),
    [events, selectedMemberId, dateFrom, dateTo],
  );

  const getMemberLabel = (m: Member) => `${m.firstName} ${m.lastName}`;

  const locationGroups = useMemo((): LocationGroup[] => {
    const byCoord = new Map<string, LocationGroup>();

    const add = (location: string, item: LocationItem) => {
      if (!visibleLocationTypeSet.has(item.type)) return;
      const coord = coords.get(location);
      if (!coord?.resolved || coord.lat === null || coord.lon === null) return;
      const key = `${coord.lat.toFixed(5)},${coord.lon.toFixed(5)}`;
      if (!byCoord.has(key)) {
        byCoord.set(key, { location, coord, items: [], types: [] });
      }
      const group = byCoord.get(key)!;
      group.items.push(item);
      if (!group.types.includes(item.type)) group.types.push(item.type);
    };

    for (const m of filteredMembers) {
      const name = getMemberLabel(m);
      if (m.birthplace) {
        add(m.birthplace, {
          type: "birthplace",
          memberId: m.id,
          memberName: name,
        });
      }
      if (m.hometown) {
        add(m.hometown, {
          type: "hometown",
          memberId: m.id,
          memberName: name,
        });
      }
      if (m.cemetery) {
        add(m.cemetery, {
          type: "cemetery",
          memberId: m.id,
          memberName: name,
        });
      }
      for (const p of m.placesLived) {
        if (!p.location) continue;
        // Same overlap check as the event date filter: plain string
        // comparison over possibly-partial ISO dates; open-ended sides
        // (null from/to) are unbounded.
        if (dateTo && p.from && p.from > dateTo) continue;
        if (dateFrom && p.to && p.to < dateFrom) continue;
        add(p.location, {
          type: "places-lived",
          memberId: m.id,
          memberName: name,
          dateFrom: p.from,
          dateTo: p.to,
        });
      }
    }

    for (const e of filteredEvents) {
      if (!e.location) continue;
      const linkedMembers: LinkedMember[] = e.linkedMemberIds
        .map((id) => {
          const m = members.find((x) => x.id === id);
          return m ? { id: m.id, name: getMemberLabel(m) } : null;
        })
        .filter((m): m is LinkedMember => m !== null);
      add(e.location, {
        type: "event",
        linkedMembers,
        eventType: e.eventType,
        date: e.date,
        description: e.description,
      });
    }

    return [...byCoord.values()];
  }, [
    filteredMembers,
    filteredEvents,
    coords,
    members,
    visibleLocationTypeSet,
    dateFrom,
    dateTo,
  ]);

  const unmappedCount = useMemo(
    () =>
      allLocations.filter((loc) => coords.get(loc)?.resolved === false).length,
    [allLocations, coords],
  );

  const noLocationTypesVisible = visibleLocationTypes.length === 0;

  // Events load deferred and unknown locations are geocoded sequentially on
  // the server (>1s each) — show a loading state instead of the empty state
  // until both have settled.
  const loading = !eventsInitialized || geocodePending;

  return (
    <ViewLayout title={t("title")}>
      <div className="flex flex-col h-full min-h-0">
        {/* Filters + legend row */}
        <div className="flex gap-2 mb-4 p-1 pb-2 items-center flex-wrap">
          <Popover open={memberSelectOpen} onOpenChange={setMemberSelectOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={memberSelectOpen}
                className="w-44 shrink-0 justify-between"
              >
                {selectedMemberId === "all"
                  ? t("all-members")
                  : members.find((m) => m.id === selectedMemberId)
                    ? getMemberLabel(
                        members.find((m) => m.id === selectedMemberId)!,
                      )
                    : t("member-place-holder")}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0">
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
                        value={getMemberLabel(member)}
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
                        {getMemberLabel(member)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("date-from")}
            </span>
            <PartialDatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder={t("date-from")}
              className="w-32 h-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("date-to")}
            </span>
            <PartialDatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder={t("date-to")}
              className="w-32 h-9"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={locationGroups.length === 0}
            onClick={() => setFitSignal((s) => s + 1)}
            aria-label={t("fit-to-markers")}
            title={t("fit-to-markers")}
          >
            <LocateFixed className="h-4 w-4" />
          </Button>

          {/* Compact location-type filter: a popover with one switch per
              type (same pattern as the List view's customize popover). The
              trigger previews the colors of the currently visible types. */}
          <div className="ml-auto shrink-0">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 gap-2"
                  aria-label={t("filter-location-types")}
                >
                  <span className="flex items-center gap-1">
                    {visibleLocationTypes.length > 0 ? (
                      LOCATION_TYPES.filter((type) =>
                        visibleLocationTypeSet.has(type),
                      ).map((type) => (
                        <span
                          key={type}
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            border: `2px solid ${LOCATION_COLORS[type]}`,
                            background: "transparent",
                            flexShrink: 0,
                          }}
                        />
                      ))
                    ) : (
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  {t("filter-location-types")}
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="space-y-1">
                  {LOCATION_TYPES.map((type) => {
                    const isVisible = visibleLocationTypeSet.has(type);
                    return (
                      <label
                        key={type}
                        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50 cursor-pointer"
                      >
                        <Switch
                          checked={isVisible}
                          onCheckedChange={(checked) =>
                            setVisibleLocationTypes((prev) =>
                              checked
                                ? [...prev, type]
                                : prev.filter((v) => v !== type),
                            )
                          }
                          aria-label={t(`legend-${type}`)}
                        />
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            border: `2px solid ${LOCATION_COLORS[type]}`,
                            background: "transparent",
                            flexShrink: 0,
                          }}
                        />
                        <span className="text-sm">{t(`legend-${type}`)}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {locationGroups.length === 0 && loading && !noLocationTypesVisible ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border flex-1 min-h-0">
            <Spinner className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("resolving-locations")}
            </p>
          </div>
        ) : locationGroups.length === 0 ? (
          <Empty className="border flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MapPin />
              </EmptyMedia>
              <EmptyTitle>
                {noLocationTypesVisible
                  ? t("no-location-types-visible")
                  : t("no-mappable-events")}
              </EmptyTitle>
              {noLocationTypesVisible ? (
                <EmptyDescription>
                  {t("enable-location-type-hint")}
                </EmptyDescription>
              ) : (
                unmappedCount === 0 && (
                  <EmptyDescription>{t("add-location-hint")}</EmptyDescription>
                )
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          // position+zIndex creates a stacking context so Leaflet's internal
          // z-indices don't escape and cover Radix UI portals (e.g. the member picker)
          <div
            className="rounded-lg overflow-hidden border border-border flex-1 min-h-0"
            style={{
              position: "relative",
              zIndex: 0,
            }}
          >
            <MapContainer
              center={[20, 0]}
              zoom={2}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom
            >
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                detectRetina
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <FitBounds groups={locationGroups} fitSignal={fitSignal} />
              {locationGroups.map((group) => {
                // Group items by location type (birthplace/hometown/etc.) in
                // TYPE_PRIORITY order, so the popup shows one header per type
                // present instead of an insertion-order list interleaving types.
                const itemsByType = new Map<LocationType, LocationItem[]>();
                for (const item of group.items) {
                  if (!itemsByType.has(item.type))
                    itemsByType.set(item.type, []);
                  itemsByType.get(item.type)!.push(item);
                }
                const presentTypes = TYPE_PRIORITY.filter((type) =>
                  itemsByType.has(type),
                );

                return (
                  <Marker
                    key={`${group.coord.lat},${group.coord.lon}`}
                    position={[group.coord.lat!, group.coord.lon!]}
                    icon={createGroupIcon(group.types)}
                  >
                    <Popup maxWidth={300} maxHeight={280}>
                      <div className="space-y-2 text-sm">
                        {group.coord.displayName && (
                          <p className="text-xs text-muted-foreground font-medium pb-1 border-b">
                            {group.coord.displayName}
                          </p>
                        )}
                        {presentTypes.map((type) => (
                          <div key={type} className="space-y-1">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span
                                style={{
                                  display: "inline-block",
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  border: `2px solid ${LOCATION_COLORS[type]}`,
                                  background: "transparent",
                                  flexShrink: 0,
                                }}
                              />
                              {t(`legend-${type}`)}
                            </div>
                            <div className="space-y-1 ml-4">
                              {itemsByType
                                .get(type)!
                                .map((item, i) =>
                                  item.type === "event" ? (
                                    <EventPopupItem
                                      key={i}
                                      item={item}
                                      t={t}
                                      i18nT={i18n.t}
                                      onShowMember={showMemberInTree}
                                    />
                                  ) : (
                                    <MemberPopupItem
                                      key={i}
                                      item={item}
                                      t={t}
                                      onShowMember={showMemberInTree}
                                    />
                                  ),
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        )}
      </div>

      {geocodePending && locationGroups.length > 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
          <Spinner />
          {t("resolving-locations")}
        </p>
      ) : (
        !loading &&
        unmappedCount > 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            {t("unlocatable-count", { count: unmappedCount })}
          </p>
        )
      )}
    </ViewLayout>
  );
};
