import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PartialDatePicker } from "@/components/ui/partial-date-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { MapPin, Check, ChevronsUpDown } from "lucide-react";
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

type LocationType = "event" | "birthplace" | "hometown" | "places-lived";

const LOCATION_COLORS: Record<LocationType, string> = {
  event: "var(--color-map-event)",
  birthplace: "var(--color-map-birthplace)",
  hometown: "var(--color-map-hometown)",
  "places-lived": "var(--color-map-places-lived)",
};

const LOCATION_TYPES: LocationType[] = [
  "event",
  "birthplace",
  "hometown",
  "places-lived",
];

// Order used when picking which color shows first in the icon
const TYPE_PRIORITY: LocationType[] = [
  "event",
  "birthplace",
  "places-lived",
  "hometown",
];

interface LocationItem {
  type: LocationType;
  memberName?: string;
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

function FitBounds({ groups }: { groups: LocationGroup[] }) {
  const map = useMap();
  useEffect(() => {
    if (groups.length === 0) return;
    const points = groups
      .filter((g) => g.coord.lat !== null && g.coord.lon !== null)
      .map((g) => [g.coord.lat!, g.coord.lon!] as [number, number]);
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 10 });
    }
  }, [groups, map]);
  return null;
}

export const MapView = () => {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: "map-view.view",
  });
  const { members } = useMemberStore();
  const { events, refreshEvents, initialized: eventsInitialized } = useEventStore();
  const { coords, resolveLocations } = useGeocodeStore();
  const selectedTree = useTreeStore((state) => state.selectedTree);

  useEffect(() => {
    if (!eventsInitialized && selectedTree) {
      void refreshEvents(selectedTree.id);
    }
  }, [eventsInitialized, selectedTree, refreshEvents]);

  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">(
    "all",
  );
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [visibleLocationTypes, setVisibleLocationTypes] =
    useState<LocationType[]>(LOCATION_TYPES);
  const visibleLocationTypeSet = useMemo(
    () => new Set(visibleLocationTypes),
    [visibleLocationTypes],
  );

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
        add(m.birthplace, { type: "birthplace", memberName: name });
      }
      if (m.hometown) {
        add(m.hometown, { type: "hometown", memberName: name });
      }
      for (const p of m.placesLived) {
        if (p.location) {
          add(p.location, {
            type: "places-lived",
            memberName: name,
            dateFrom: p.from,
            dateTo: p.to,
          });
        }
      }
    }

    for (const e of filteredEvents) {
      if (!e.location) continue;
      const name = e.linkedMemberIds
        .map((id) => {
          const m = members.find((x) => x.id === id);
          return m ? getMemberLabel(m) : "";
        })
        .filter(Boolean)
        .join(", ");
      add(e.location, {
        type: "event",
        memberName: name,
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
  ]);

  const unmappedCount = useMemo(
    () =>
      allLocations.filter((loc) => coords.get(loc)?.resolved === false).length,
    [allLocations, coords],
  );

  const noLocationTypesVisible = visibleLocationTypes.length === 0;

  return (
    <ViewLayout title={t("title")}>
      {/* Filters + legend row */}
      <div className="flex gap-2 mb-4 p-1 pb-2 items-center flex-nowrap overflow-x-auto">
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
            className="w-28 h-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("date-to")}</span>
          <PartialDatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder={t("date-to")}
            className="w-28 h-9"
          />
        </div>

        <div className="ml-auto flex shrink-0 items-center">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            value={visibleLocationTypes}
            onValueChange={(types) =>
              setVisibleLocationTypes(types as LocationType[])
            }
            aria-label={t("filter-location-types")}
            className="shrink-0"
          >
            {LOCATION_TYPES.map((type) => (
              <ToggleGroupItem
                key={type}
                value={type}
                aria-label={t(`legend-${type}`)}
                className="h-8 px-1.5 text-xs text-muted-foreground data-[state=on]:text-foreground data-[state=off]:opacity-50"
              >
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
                {t(`legend-${type}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {locationGroups.length === 0 ? (
        <Empty className="border" style={{ height: "calc(100% - 130px)" }}>
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
          className="rounded-lg overflow-hidden border border-border"
          style={{
            height: "calc(100% - 130px)",
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
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <FitBounds groups={locationGroups} />
            {locationGroups.map((group) => (
              <Marker
                key={`${group.coord.lat},${group.coord.lon}`}
                position={[group.coord.lat!, group.coord.lon!]}
                icon={createGroupIcon(group.types)}
              >
                <Popup maxWidth={300}>
                  <div className="space-y-2 text-sm">
                    {group.coord.displayName && (
                      <p className="text-xs text-muted-foreground font-medium pb-1 border-b">
                        {group.coord.displayName}
                      </p>
                    )}
                    {group.items.map((item, i) => {
                      const { icon: Icon } =
                        item.type === "event" && item.eventType
                          ? getEventTypeInfo(item.eventType)
                          : { icon: MapPin };
                      return (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center gap-1.5 font-medium">
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                border: `2px solid ${LOCATION_COLORS[item.type]}`,
                                background: "transparent",
                                flexShrink: 0,
                              }}
                            />
                            {t(`legend-${item.type}`)}
                            {item.memberName && (
                              <span className="font-normal text-muted-foreground">
                                · {item.memberName}
                              </span>
                            )}
                          </div>
                          {item.type === "event" && item.eventType && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground ml-4">
                              <Icon className="w-3 h-3 shrink-0" />
                              {getEventTypeLabel(item.eventType, i18n.t)}
                              {item.date && (
                                <>
                                  {" · "}
                                  {formatDateWithFallback(item.date, i18n.t)}
                                </>
                              )}
                            </div>
                          )}
                          {item.type === "places-lived" &&
                            (item.dateFrom || item.dateTo) && (
                              <p className="text-xs text-muted-foreground ml-4">
                                {item.dateFrom && item.dateTo
                                  ? `${formatDate(item.dateFrom)} – ${formatDate(item.dateTo)}`
                                  : item.dateFrom
                                    ? `${t("from")} ${formatDate(item.dateFrom)}`
                                    : `${t("until")} ${formatDate(item.dateTo)}`}
                              </p>
                            )}
                          {item.description && (
                            <p className="text-xs text-muted-foreground ml-4">
                              {item.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {unmappedCount > 0 && (
        <p className="text-sm text-muted-foreground mt-2">
          {t("unlocatable-count", { count: unmappedCount })}
        </p>
      )}
    </ViewLayout>
  );
};
