import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Event } from "@/types/event";
import type { GeocodeResult } from "@/types/geocode";
import type { Member } from "@/types/member";
import { MapView } from "./MapView";

vi.mock("leaflet", () => ({
  default: {
    Icon: {
      Default: {
        prototype: { _getIconUrl: vi.fn() },
        mergeOptions: vi.fn(),
      },
    },
    divIcon: vi.fn((options) => options),
    latLngBounds: vi.fn((points) => points),
  },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: { children: ReactNode }) => (
    <div data-testid="map-marker">{children}</div>
  ),
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
}));

vi.mock("@/components/ui/partial-date-picker", () => ({
  PartialDatePicker: () => null,
}));

const member: Member = {
  id: "member-1",
  gender: "o",
  academicTitle: null,
  firstName: "Alex",
  middleNames: null,
  baptismalName: null,
  lastName: "Example",
  maidenName: null,
  imageData: null,
  deceased: false,
  adopted: false,
  date: { birth: "1990", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: "Vienna",
  hometown: "Graz",
  cemetery: null,
  placesLived: [{ location: "Berlin", from: "2010", to: "2015" }],
  isCollapsed: false,
  position: { x: 0, y: 0 },
};

const event: Event = {
  id: "event-1",
  linkedMemberIds: [member.id],
  eventType: "education",
  date: "2012",
  location: "Paris",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const locations = ["Vienna", "Graz", "Berlin", "Paris"];
const coords = new Map<string, GeocodeResult>(
  locations.map((location, index) => [
    location,
    {
      query: location,
      lat: 48 + index,
      lon: 16 + index,
      displayName: location,
      resolved: true,
    },
  ]),
);

describe("MapView location type filters", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [member] });
    useEventStore.setState({ events: [event], initialized: true });
    useGeocodeStore.setState({
      coords,
      pendingCount: 0,
      resolveLocations: vi.fn(async () => undefined),
    });
  });

  it("updates the legend state and markers when a type is toggled", () => {
    render(<MapView />);

    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);

    const birthplaceToggle = screen.getByRole("button", {
      name: "Birthplace",
    });
    expect(birthplaceToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(birthplaceToggle);

    expect(birthplaceToggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("map-marker")).toHaveLength(3);
  });

  it("shows a filter-specific empty state when all types are hidden", () => {
    render(<MapView />);

    for (const name of [
      "Event",
      "Birthplace",
      "Hometown",
      "Cemetery",
      "Place lived",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    expect(screen.queryByTestId("map-marker")).not.toBeInTheDocument();
    expect(
      screen.getByText("All location types are hidden"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enable a location type above to show its markers"),
    ).toBeInTheDocument();
  });

  it("renders places-lived markers from store members", () => {
    render(<MapView />);

    for (const name of ["Event", "Birthplace", "Hometown", "Cemetery"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    // Only the Berlin places-lived marker remains
    const markers = screen.getAllByTestId("map-marker");
    expect(markers).toHaveLength(1);
    expect(within(markers[0]).getByText("Place lived")).toBeInTheDocument();
  });
});

describe("MapView loading state", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [member] });
    useEventStore.setState({ events: [event], initialized: true });
  });

  it("shows a loading indicator instead of the empty state while geocoding", () => {
    useGeocodeStore.setState({
      coords: new Map(),
      pendingCount: 1,
      resolveLocations: vi.fn(async () => undefined),
    });

    render(<MapView />);

    expect(screen.getByText("Resolving locations…")).toBeInTheDocument();
    expect(
      screen.queryByText("No mappable events found"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state once geocoding has settled without results", () => {
    useGeocodeStore.setState({
      coords: new Map(),
      pendingCount: 0,
      resolveLocations: vi.fn(async () => undefined),
    });

    render(<MapView />);

    expect(screen.getByText("No mappable events found")).toBeInTheDocument();
    expect(screen.queryByText("Resolving locations…")).not.toBeInTheDocument();
  });

  it("keeps the map visible with an inline indicator while more locations resolve", () => {
    useGeocodeStore.setState({
      coords,
      pendingCount: 1,
      resolveLocations: vi.fn(async () => undefined),
    });

    render(<MapView />);

    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);
    expect(screen.getByText("Resolving locations…")).toBeInTheDocument();
  });
});
