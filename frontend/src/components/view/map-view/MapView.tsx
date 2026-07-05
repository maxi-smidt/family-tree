import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useDeferredStoreLoad } from "@/hooks/useDeferredStoreLoad";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
import {
  MapPin,
  Check,
  ChevronsUpDown,
  LocateFixed,
  X,
  Play,
  Pause,
  RefreshCw,
} from "lucide-react";
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

// CSS background for a disc that summarizes a set of location types, shared by
// the map markers and the location-type filter so both read the same visual
// language: a light-gray fill when the set is empty, a solid fill for a single
// type, or equal conic-gradient segments (in TYPE_PRIORITY order) for several.
function typeSwatchBackground(types: LocationType[]): string {
  const sorted = [...new Set(types)].sort(
    (a, b) => TYPE_PRIORITY.indexOf(a) - TYPE_PRIORITY.indexOf(b),
  );
  if (sorted.length === 0) return "var(--muted)";
  if (sorted.length === 1) return LOCATION_COLORS[sorted[0]];
  return `conic-gradient(${sorted
    .map((t, i) => {
      const from = (i / sorted.length) * 360;
      const to = ((i + 1) / sorted.length) * 360;
      return `${LOCATION_COLORS[t]} ${from}deg ${to}deg`;
    })
    .join(", ")})`;
}

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

// One place a failed-to-geocode location string is referenced, so the
// unresolved-locations popover can point the user at the record(s) that need
// fixing instead of just naming the string.
interface UnresolvedUsage {
  kind: "member" | "event";
  fieldLabelKey: string; // legend-{type} for members, event type label for events
  label: string; // member name, or event type label
  date?: string | null;
  memberId?: string;
}

interface UnresolvedLocation {
  location: string;
  usages: UnresolvedUsage[];
}

const PIN_SIZE = 28; // px, outer diameter of the pin disc
const BADGE_SIZE = 15; // px, diameter of the count badge

// Builds the divIcon HTML/options for one location marker. A single-type
// group renders as a solid filled disc in that type's color; a multi-type
// group renders one disc whose ring is split into equal conic-gradient
// segments (one per present type, in TYPE_PRIORITY order) around a neutral
// filled center, so every type present is visible at a glance without
// stacking separate shapes. A small count badge appears in the top-right
// corner when the group holds more than one item. The root element carries
// `role="img"` + `aria-label` (divIcon markup isn't a real DOM node the
// Marker can annotate directly); the caller passes an already-translated
// label so screen readers get the user's language.
function createGroupIcon(
  types: LocationType[],
  count: number,
  ariaLabel: string,
) {
  const ringBackground = typeSwatchBackground(types);

  const badge =
    count > 1
      ? `<div style="position:absolute;top:-4px;right:-4px;min-width:${BADGE_SIZE}px;` +
        `height:${BADGE_SIZE}px;padding:0 3px;border-radius:${BADGE_SIZE}px;` +
        `background:var(--primary);color:var(--primary-foreground);` +
        `font-size:9px;font-weight:700;line-height:${BADGE_SIZE}px;text-align:center;` +
        `box-shadow:0 1px 3px rgba(0,0,0,0.4);">${count > 99 ? "99+" : count}</div>`
      : "";

  const html =
    `<div role="img" aria-label="${ariaLabel.replace(/"/g, "&quot;")}" ` +
    `style="position:relative;width:${PIN_SIZE}px;height:${PIN_SIZE}px;">` +
    `<div style="width:100%;height:100%;border-radius:50%;background:${ringBackground};` +
    `box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">` +
    `<div style="width:${PIN_SIZE - 8}px;height:${PIN_SIZE - 8}px;border-radius:50%;` +
    `background:var(--background);"></div>` +
    `</div>` +
    badge +
    `</div>`;

  return L.divIcon({
    html,
    className: "",
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
    popupAnchor: [0, -PIN_SIZE / 2],
  });
}

// A small disc mirroring the map markers (see createGroupIcon): a conic-
// gradient ring of the selected location-type colors around a hollow center,
// or a light-gray disc when nothing is selected. Used as the location-type
// filter's single combined preview.
function TypeSwatch({
  types,
  size = 16,
}: {
  types: LocationType[];
  size?: number;
}) {
  const inner = Math.round(size * 0.7);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: typeSwatchBackground(types),
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: inner,
          height: inner,
          borderRadius: "50%",
          background: "var(--background)",
        }}
      />
    </span>
  );
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
      {(item.type === "birthplace" || item.type === "cemetery") &&
        item.date && (
          <p className="text-xs text-muted-foreground">
            {formatDate(item.date)}
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

// Footer control replacing the old plain-text "unlocatable" count: a
// muted trigger button that opens a scrollable list of every location string
// that failed to geocode, each with where it's used (member field / event)
// and a per-location retry button that evicts + re-requests just that one.
function UnresolvedLocationsPopover({
  unresolvedLocations,
  t,
  i18nT,
  onShowMember,
  onRetry,
}: {
  unresolvedLocations: UnresolvedLocation[];
  t: (key: string, options?: Record<string, unknown>) => string;
  i18nT: (key: string) => string;
  onShowMember: (memberId: string) => void;
  onRetry: (location: string) => void;
}) {
  if (unresolvedLocations.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none mt-2"
        >
          {t("unresolved-locations-count", {
            count: unresolvedLocations.length,
          })}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="px-3 py-2 border-b text-sm font-medium">
          {t("unresolved-locations-title")}
        </div>
        <div className="max-h-72 overflow-y-auto divide-y">
          {unresolvedLocations.map(({ location, usages }) => (
            <div key={location} className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium break-words">
                  {location}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 shrink-0"
                  onClick={() => onRetry(location)}
                  aria-label={t("retry-location", { location })}
                  title={t("retry-location", { location })}
                >
                  <RefreshCw className="h-3 w-3" />
                  {t("retry")}
                </Button>
              </div>
              <ul className="space-y-1">
                {usages.map((usage, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap"
                  >
                    <span>
                      {t("used-in", { field: t(usage.fieldLabelKey) })}
                    </span>
                    {usage.kind === "member" && usage.memberId ? (
                      <MemberNameLink
                        id={usage.memberId}
                        name={usage.label}
                        title={t("show-in-tree")}
                        onShowMember={onShowMember}
                      />
                    ) : (
                      <span className="font-medium">{usage.label}</span>
                    )}
                    {usage.date && (
                      <span>· {formatDateWithFallback(usage.date, i18nT)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
  const { coords, resolveLocations, retryLocations } = useGeocodeStore();
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
  const [showLifePath, setShowLifePath] = useState(true);
  const [asOfYear, setAsOfYear] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Whether the user has moved the always-visible time slider off its default
  // (latest) position. Until they do, we keep it pinned to the newest year so
  // deferred-loading data (events arrive after members) never hides anything.
  const [sliderTouched, setSliderTouched] = useState(false);
  const prevMemberRef = useRef<string | "all">(selectedMemberId);
  const visibleLocationTypeSet = useMemo(
    () => new Set(visibleLocationTypes),
    [visibleLocationTypes],
  );

  // Every 4-digit year present anywhere in the tree's dates, used to bound the
  // time slider. Parses only the leading year from partial-ISO strings.
  const [minYear, maxYear] = useMemo(() => {
    let min: number | null = null;
    let max: number | null = null;
    const consider = (value: string | null | undefined) => {
      if (!value) return;
      const match = /^(\d{4})/.exec(value);
      if (!match) return;
      const year = Number(match[1]);
      if (min === null || year < min) min = year;
      if (max === null || year > max) max = year;
    };
    for (const m of members) {
      consider(m.date.birth);
      consider(m.date.death);
      for (const p of m.placesLived) {
        consider(p.from);
        consider(p.to);
      }
    }
    for (const e of events) {
      consider(e.date);
    }
    return [min, max];
  }, [members, events]);

  const timeSliderAvailable = minYear !== null && maxYear !== null;

  // Keep the slider pinned to the latest year until the user drags it, so it
  // both initializes correctly and follows maxYear as deferred data widens the
  // range. Once touched, the user's chosen year is left alone.
  useEffect(() => {
    if (!sliderTouched && maxYear !== null) setAsOfYear(maxYear);
  }, [sliderTouched, maxYear]);

  // Advance asOfYear by one year on an interval while playing; stop at maxYear.
  // Cleaned up on unmount / pause.
  useEffect(() => {
    if (!isPlaying || maxYear === null) return;
    const interval = setInterval(() => {
      setAsOfYear((prev) => {
        const current = prev ?? maxYear;
        if (current >= maxYear) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return () => clearInterval(interval);
  }, [isPlaying, maxYear]);

  // Play/pause. Pressing play while already parked at the latest year rewinds
  // to the earliest year and plays the whole range again.
  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    setSliderTouched(true);
    if (asOfYear !== null && maxYear !== null && asOfYear >= maxYear) {
      setAsOfYear(minYear);
    }
    setIsPlaying(true);
  };

  // The as-of-year bound (end of that year, so the whole year is included)
  // combined with any manual "to" date filter by taking the more restrictive
  // (earlier) of the two — both compare as plain strings over partial ISO. At
  // the latest year the slider imposes no restriction of its own.
  const effectiveDateTo = useMemo(() => {
    if (asOfYear === null || maxYear === null || asOfYear >= maxYear) {
      return dateTo;
    }
    const sliderBound = `${asOfYear}-12-31`;
    if (dateTo && dateTo < sliderBound) return dateTo;
    return sliderBound;
  }, [asOfYear, maxYear, dateTo]);

  const sliderMovedBack =
    asOfYear !== null && maxYear !== null && asOfYear < maxYear;

  const hasActiveFilters =
    selectedMemberId !== "all" ||
    dateFrom !== null ||
    dateTo !== null ||
    sliderMovedBack;

  const clearFilters = () => {
    setSelectedMemberId("all");
    setDateFrom(null);
    setDateTo(null);
    setSliderTouched(false);
    setAsOfYear(maxYear);
    setIsPlaying(false);
  };

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
        if (effectiveDateTo && e.date > effectiveDateTo) return false;
        return true;
      }),
    [events, selectedMemberId, dateFrom, effectiveDateTo],
  );

  const getMemberLabel = (m: Member) => `${m.firstName} ${m.lastName}`;

  // A single point-in-time location (birthplace dated by birth, cemetery by
  // death) is visible when its date isn't before "from" or after the effective
  // "to". Undatable points (empty/null) can't be placed in time, so they always
  // show — the date filters only ever hide things we can actually date.
  const isPointDateVisible = useCallback(
    (date: string | null | undefined) => {
      if (!date) return true;
      if (dateFrom && date < dateFrom) return false;
      if (effectiveDateTo && date > effectiveDateTo) return false;
      return true;
    },
    [dateFrom, effectiveDateTo],
  );

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
      // Birthplace is dated by birth, cemetery by death; hometown has no
      // natural date so it ignores the date filters entirely.
      if (m.birthplace && isPointDateVisible(m.date.birth)) {
        add(m.birthplace, {
          type: "birthplace",
          memberId: m.id,
          memberName: name,
          date: m.date.birth || undefined,
        });
      }
      if (m.hometown) {
        add(m.hometown, {
          type: "hometown",
          memberId: m.id,
          memberName: name,
        });
      }
      if (m.cemetery && isPointDateVisible(m.date.death)) {
        add(m.cemetery, {
          type: "cemetery",
          memberId: m.id,
          memberName: name,
          date: m.date.death || undefined,
        });
      }
      for (const p of m.placesLived) {
        if (!p.location) continue;
        // Same overlap check as the event date filter: plain string
        // comparison over possibly-partial ISO dates; open-ended sides
        // (null from/to) are unbounded.
        if (effectiveDateTo && p.from && p.from > effectiveDateTo) continue;
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
    effectiveDateTo,
    isPointDateVisible,
  ]);

  // Auto-fit when the member filter changes so the new selection is centered.
  useEffect(() => {
    if (prevMemberRef.current !== selectedMemberId) {
      prevMemberRef.current = selectedMemberId;
      if (locationGroups.length > 0) setFitSignal((s) => s + 1);
    }
  }, [selectedMemberId, locationGroups.length]);

  // Life path (#552): for a single selected member, a chronological line
  // through birthplace -> places lived (sorted by "from", undated ones last)
  // -> cemetery. Hometown is deliberately excluded — it isn't time-ordered.
  // Only the currently-visible location types and geocoded points count, and
  // consecutive duplicate coordinates are collapsed so a birthplace that
  // matches the first residence doesn't create a zero-length segment.
  const lifePathPoints = useMemo((): [number, number][] => {
    if (selectedMemberId === "all") return [];
    const member = members.find((m) => m.id === selectedMemberId);
    if (!member) return [];

    const resolve = (
      loc: string | null | undefined,
    ): [number, number] | null => {
      if (!loc) return null;
      const c = coords.get(loc);
      if (!c?.resolved || c.lat === null || c.lon === null) return null;
      return [c.lat, c.lon];
    };

    const ordered: [number, number][] = [];

    if (
      visibleLocationTypeSet.has("birthplace") &&
      isPointDateVisible(member.date.birth)
    ) {
      const p = resolve(member.birthplace);
      if (p) ordered.push(p);
    }

    if (visibleLocationTypeSet.has("places-lived")) {
      const dated = member.placesLived.filter((p) => p.from);
      const undated = member.placesLived.filter((p) => !p.from);
      dated.sort((a, b) =>
        a.from! < b.from! ? -1 : a.from! > b.from! ? 1 : 0,
      );
      for (const p of [...dated, ...undated]) {
        if (effectiveDateTo && p.from && p.from > effectiveDateTo) continue;
        if (dateFrom && p.to && p.to < dateFrom) continue;
        const point = resolve(p.location);
        if (point) ordered.push(point);
      }
    }

    if (
      visibleLocationTypeSet.has("cemetery") &&
      isPointDateVisible(member.date.death)
    ) {
      const p = resolve(member.cemetery);
      if (p) ordered.push(p);
    }

    // Dedupe consecutive identical coordinates (5-decimal precision, matching
    // the marker-grouping key elsewhere in this file).
    const deduped: [number, number][] = [];
    for (const point of ordered) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        prev[0].toFixed(5) === point[0].toFixed(5) &&
        prev[1].toFixed(5) === point[1].toFixed(5)
      ) {
        continue;
      }
      deduped.push(point);
    }

    return deduped;
  }, [
    selectedMemberId,
    members,
    coords,
    visibleLocationTypeSet,
    dateFrom,
    effectiveDateTo,
    isPointDateVisible,
  ]);

  // Leaflet renders the polyline into an SVG overlay, where a raw
  // `var(--token)` string is not guaranteed to resolve as a `stroke` value.
  // Resolve an existing map accent token to a concrete color string once.
  const [lifePathColor, setLifePathColor] = useState<string>("#8b5cf6");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-map-places-lived")
      .trim();
    if (value) setLifePathColor(value);
  }, []);

  const unmappedCount = useMemo(
    () =>
      allLocations.filter((loc) => coords.get(loc)?.resolved === false).length,
    [allLocations, coords],
  );

  // For every location that failed to geocode, collect where it's used
  // (which members/fields, which events) so the unresolved-locations popover
  // can show something actionable instead of a bare string. Walks the same
  // sources/visibility rules as `allLocations`, but keyed by location so each
  // failed string lists every place it appears.
  const unresolvedLocations = useMemo((): UnresolvedLocation[] => {
    const failed = new Set(
      allLocations.filter((loc) => coords.get(loc)?.resolved === false),
    );
    if (failed.size === 0) return [];

    const byLocation = new Map<string, UnresolvedUsage[]>();
    const addUsage = (location: string, usage: UnresolvedUsage) => {
      if (!failed.has(location)) return;
      if (!byLocation.has(location)) byLocation.set(location, []);
      byLocation.get(location)!.push(usage);
    };

    for (const m of members) {
      const name = getMemberLabel(m);
      if (visibleLocationTypeSet.has("birthplace") && m.birthplace) {
        addUsage(m.birthplace, {
          kind: "member",
          fieldLabelKey: "legend-birthplace",
          label: name,
          date: m.date.birth,
          memberId: m.id,
        });
      }
      if (visibleLocationTypeSet.has("hometown") && m.hometown) {
        addUsage(m.hometown, {
          kind: "member",
          fieldLabelKey: "legend-hometown",
          label: name,
          memberId: m.id,
        });
      }
      if (visibleLocationTypeSet.has("cemetery") && m.cemetery) {
        addUsage(m.cemetery, {
          kind: "member",
          fieldLabelKey: "legend-cemetery",
          label: name,
          date: m.date.death,
          memberId: m.id,
        });
      }
      if (visibleLocationTypeSet.has("places-lived")) {
        for (const p of m.placesLived) {
          if (!p.location) continue;
          addUsage(p.location, {
            kind: "member",
            fieldLabelKey: "legend-places-lived",
            label: name,
            memberId: m.id,
          });
        }
      }
    }

    if (visibleLocationTypeSet.has("event")) {
      for (const e of events) {
        if (!e.location) continue;
        addUsage(e.location, {
          kind: "event",
          fieldLabelKey: "legend-event",
          label: getEventTypeLabel(e.eventType, i18n.t),
          date: e.date,
        });
      }
    }

    return [...byLocation.entries()].map(([location, usages]) => ({
      location,
      usages,
    }));
  }, [allLocations, coords, members, events, visibleLocationTypeSet, i18n.t]);

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
              className="w-40 h-9"
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
              className="w-40 h-9"
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

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={clearFilters}
              aria-label={t("clear-filters")}
              title={t("clear-filters")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}

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
                  <TypeSwatch types={visibleLocationTypes} />
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
              {showLifePath &&
                selectedMemberId !== "all" &&
                lifePathPoints.length >= 2 && (
                  <Polyline
                    positions={lifePathPoints}
                    pathOptions={{
                      color: lifePathColor,
                      weight: 3,
                      opacity: 0.7,
                      dashArray: "6 6",
                    }}
                  />
                )}
              <MarkerClusterGroup
                showCoverageOnHover={false}
                spiderfyOnMaxZoom
                maxClusterRadius={50}
              >
                {locationGroups.map((group) => {
                  // Group items by location type (birthplace/hometown/etc.)
                  // in TYPE_PRIORITY order, so the popup shows one header per
                  // type present instead of an insertion-order list
                  // interleaving types.
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
                      icon={createGroupIcon(
                        group.types,
                        group.items.length,
                        // count first so the i18n checker sees the `count:`
                        // param and treats this as a pluralized key (_one/_other).
                        t("marker-aria-label", {
                          count: group.items.length,
                          location: group.coord.displayName || group.location,
                        }),
                      )}
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
              </MarkerClusterGroup>
            </MapContainer>
          </div>
        )}

        {/* Below-map controls: contextual toggles kept out of the top filter
            bar so it doesn't get crowded. The time slider stretches full width
            here. This bar stays mounted regardless of the map/empty/loading
            state above, so sliding the year back to before any data (which
            empties the map) never hides the slider itself. */}
        {(selectedMemberId !== "all" || timeSliderAvailable) && (
          <div className="flex items-center gap-x-4 gap-y-2 mt-3 px-1 flex-wrap shrink-0">
            {selectedMemberId !== "all" && (
              <label className="flex items-center gap-2 shrink-0">
                <Switch
                  checked={showLifePath}
                  onCheckedChange={setShowLifePath}
                  aria-label={t("show-life-path")}
                />
                <span className="text-sm text-muted-foreground">
                  {t("show-life-path")}
                </span>
              </label>
            )}

            {timeSliderAvailable && asOfYear !== null && (
              <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={togglePlay}
                  aria-label={
                    isPlaying ? t("time-slider-pause") : t("time-slider-play")
                  }
                  title={
                    isPlaying ? t("time-slider-pause") : t("time-slider-play")
                  }
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <input
                  type="range"
                  min={minYear!}
                  max={maxYear!}
                  step={1}
                  value={asOfYear}
                  onChange={(e) => {
                    setSliderTouched(true);
                    setAsOfYear(Number(e.target.value));
                  }}
                  aria-label={t("as-of-year", { year: asOfYear })}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm text-muted-foreground tabular-nums w-24 shrink-0 text-right">
                  {t("as-of-year", { year: asOfYear })}
                </span>
              </div>
            )}
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
          <UnresolvedLocationsPopover
            unresolvedLocations={unresolvedLocations}
            t={t}
            i18nT={i18n.t}
            onShowMember={showMemberInTree}
            onRetry={(location) => retryLocations([location])}
          />
        )
      )}
    </ViewLayout>
  );
};
