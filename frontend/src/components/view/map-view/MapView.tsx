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
import { Event } from "@/types/event";
import { GeocodeResult } from "@/types/geocode";

// Fix Leaflet marker icons in bundler environments
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface MarkerGroup {
  coord: GeocodeResult;
  events: Event[];
  location: string;
}

function FitBounds({ groups }: { groups: MarkerGroup[] }) {
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

  // Trigger geocoding for all distinct non-empty event locations
  useEffect(() => {
    const locations = [
      ...new Set(events.flatMap((e) => (e.location ? [e.location] : []))),
    ];
    if (locations.length > 0) {
      resolveLocations(locations);
    }
  }, [events, resolveLocations]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (!event.location) return false;
      const coord = coords.get(event.location);
      if (!coord?.resolved) return false;
      if (
        selectedMemberId !== "all" &&
        !event.linkedMemberIds.includes(selectedMemberId)
      )
        return false;
      if (dateFrom && event.date < dateFrom) return false;
      if (dateTo && event.date > dateTo) return false;
      return true;
    });
  }, [events, coords, selectedMemberId, dateFrom, dateTo]);

  const markerGroups = useMemo((): MarkerGroup[] => {
    const groups = new Map<string, MarkerGroup>();
    for (const event of filteredEvents) {
      const coord = coords.get(event.location!);
      if (!coord || coord.lat === null || coord.lon === null) continue;
      const key = `${coord.lat.toFixed(5)},${coord.lon.toFixed(5)}`;
      if (!groups.has(key)) {
        groups.set(key, { coord, events: [], location: event.location! });
      }
      groups.get(key)!.events.push(event);
    }
    return [...groups.values()];
  }, [filteredEvents, coords]);

  const unmappedCount = useMemo(() => {
    return events.filter((e) => {
      if (!e.location) return false;
      if (
        selectedMemberId !== "all" &&
        !e.linkedMemberIds.includes(selectedMemberId)
      )
        return false;
      const coord = coords.get(e.location);
      return coord !== undefined && !coord.resolved;
    }).length;
  }, [events, coords, selectedMemberId]);

  const getMemberName = (memberId: string) => {
    const m = members.find((m) => m.id === memberId);
    return m ? `${m.firstName} ${m.lastName}` : t("member-fallback");
  };

  const hasMarkers = markerGroups.length > 0;

  return (
    <ViewLayout title={t("title")}>
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
                  ? `${members.find((m) => m.id === selectedMemberId)?.firstName} ${members.find((m) => m.id === selectedMemberId)?.lastName}`
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
      </div>

      {!hasMarkers ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <MapPin className="w-16 h-16 mb-4 opacity-50" />
          <p className="text-lg">{t("no-mappable-events")}</p>
          {unmappedCount === 0 && (
            <p className="text-sm">{t("add-location-hint")}</p>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-border" style={{ height: "calc(100% - 160px)" }}>
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
            <FitBounds groups={markerGroups} />
            {markerGroups.map((group) => (
              <Marker
                key={`${group.coord.lat},${group.coord.lon}`}
                position={[group.coord.lat!, group.coord.lon!]}
              >
                <Popup maxWidth={300}>
                  <div className="space-y-2">
                    {group.coord.displayName && (
                      <p className="text-xs text-muted-foreground font-medium">
                        {group.coord.displayName}
                      </p>
                    )}
                    {group.events.map((event) => {
                      const { icon: Icon } = getEventTypeInfo(event.eventType);
                      return (
                        <div
                          key={event.id}
                          className="border-t pt-2 first:border-t-0 first:pt-0"
                        >
                          <div className="flex items-center gap-1 font-semibold text-sm">
                            <Icon className="w-4 h-4 shrink-0" />
                            {getEventTypeLabel(event.eventType, i18n.t)}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDateWithFallback(event.date, i18n.t)}
                          </p>
                          {event.linkedMemberIds.length > 0 && (
                            <p className="text-xs">
                              {event.linkedMemberIds
                                .map(getMemberName)
                                .join(", ")}
                            </p>
                          )}
                          {event.description && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {event.description}
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
