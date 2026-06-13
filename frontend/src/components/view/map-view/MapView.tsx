import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useState, useMemo, useEffect } from "react";
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
import { MapPin, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { useTranslation } from "react-i18next";
import { formatDateWithFallback } from "@/utils/dateUtils";
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
  event: "#f59e0b",
  birthplace: "#3b82f6",
  hometown: "#06b6d4",
  "places-lived": "#a855f7",
};

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
        `<div style="width:12px;height:12px;border-radius:50%;` +
        `border:2.5px solid ${LOCATION_COLORS[t]};background:white;` +
        `box-shadow:0 1px 3px rgba(0,0,0,0.25);flex-shrink:0;"></div>`,
    )
    .join("");
  const w = sorted.length * 14;
  return L.divIcon({
    html: `<div style="display:flex;gap:2px;align-items:center;">${dots}</div>`,
    className: "",
    iconSize: [w, 12],
    iconAnchor: [w / 2, 6],
    popupAnchor: [0, -10],
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
  const { events } = useEventStore();
  const { coords, resolveLocations } = useGeocodeStore();

  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">(
    "all",
  );
  const [memberSelectOpen, setMemberSelectOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Gather every location string from all sources for geocoding
  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    for (const m of members) {
      if (m.birthplace) locs.add(m.birthplace);
      if (m.hometown) locs.add(m.hometown);
      for (const p of m.placesLived) {
        if (p.location) locs.add(p.location);
      }
    }
    for (const e of events) {
      if (e.location) locs.add(e.location);
    }
    return [...locs];
  }, [members, events]);

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
      if (m.birthplace) add(m.birthplace, { type: "birthplace", memberName: name });
      if (m.hometown) add(m.hometown, { type: "hometown", memberName: name });
      for (const p of m.placesLived) {
        if (p.location)
          add(p.location, {
            type: "places-lived",
            memberName: name,
            dateFrom: p.from,
            dateTo: p.to,
          });
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
  }, [filteredMembers, filteredEvents, coords, members]);

  const unmappedCount = useMemo(
    () => allLocations.filter((loc) => coords.get(loc)?.resolved === false).length,
    [allLocations, coords],
  );

  const LEGEND_TYPES: LocationType[] = [
    "event",
    "birthplace",
    "hometown",
    "places-lived",
  ];

  return (
    <ViewLayout title={t("title")}>
      {/* Filters + legend row */}
      <div className="flex gap-3 mb-4 p-1 items-center flex-wrap">
        <Popover open={memberSelectOpen} onOpenChange={setMemberSelectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={memberSelectOpen}
              className="w-56 justify-between"
            >
              {selectedMemberId === "all"
                ? t("all-members")
                : members.find((m) => m.id === selectedMemberId)
                  ? getMemberLabel(members.find((m) => m.id === selectedMemberId)!)
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
                        selectedMemberId === "all" ? "opacity-100" : "opacity-0",
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
          <span className="text-sm text-muted-foreground">{t("date-from")}</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("date-to")}</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-9"
          />
        </div>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {LEGEND_TYPES.map((type) => (
            <span
              key={type}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: `2px solid ${LOCATION_COLORS[type]}`,
                  background: "white",
                  flexShrink: 0,
                }}
              />
              {t(`legend-${type}`)}
            </span>
          ))}
        </div>
      </div>

      {locationGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <MapPin className="w-16 h-16 mb-4 opacity-50" />
          <p className="text-lg">{t("no-mappable-events")}</p>
          {unmappedCount === 0 && (
            <p className="text-sm">{t("add-location-hint")}</p>
          )}
        </div>
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
                                background: "white",
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
                                  ? `${item.dateFrom} – ${item.dateTo}`
                                  : item.dateFrom
                                    ? `${t("from")} ${item.dateFrom}`
                                    : `${t("until")} ${item.dateTo}`}
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
