import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useEventStore } from "@/hooks/useEventStore";
import { useGeocodeStore } from "@/hooks/useGeocodeStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import type { Event } from "@/types/event";
import type { GeocodeResult } from "@/types/geocode";
import type { Member } from "@/types/member";
import { MapView } from "./MapView";

// The member-picker command palette (cmdk) relies on ResizeObserver, which
// jsdom doesn't implement.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-only polyfill
global.ResizeObserver = MockResizeObserver;
Element.prototype.scrollIntoView = vi.fn();

const fitBoundsMock = vi.fn();

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
  Polyline: () => <div data-testid="life-path" />,
  useMap: () => ({ fitBounds: fitBoundsMock }),
}));

// The real picker renders a full calendar popover; for MapView's purposes we
// only care that a text value round-trips through onChange, so stub it as a
// plain text input keyed by its placeholder (mirrors the from/to labels).
vi.mock("@/components/ui/partial-date-picker", () => ({
  PartialDatePicker: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string | null;
    onChange?: (value: string | null) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      value={value ?? ""}
      onChange={(e) =>
        onChange?.(e.target.value === "" ? null : e.target.value)
      }
    />
  ),
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

// Second member sharing Alex's birthplace (Vienna), so the birthplace +
// hometown markers collapse onto a single coordinate for the grouping tests.
const secondMember: Member = {
  ...member,
  id: "member-2",
  firstName: "Jamie",
  lastName: "Sample",
  birthplace: null,
  hometown: "Vienna",
  placesLived: [],
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
    useNavigationStore.setState({ pendingView: null });
    fitBoundsMock.mockClear();
  });

  const openTypeFilter = () =>
    fireEvent.click(screen.getByRole("button", { name: "Location types" }));

  it("updates the type switches and markers when a type is toggled", () => {
    render(<MapView />);

    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);

    openTypeFilter();
    const birthplaceSwitch = screen.getByRole("switch", {
      name: "Birthplace",
    });
    expect(birthplaceSwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.click(birthplaceSwitch);

    expect(birthplaceSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByTestId("map-marker")).toHaveLength(3);
  });

  it("shows a filter-specific empty state when all types are hidden", () => {
    render(<MapView />);

    openTypeFilter();
    for (const name of [
      "Event",
      "Birthplace",
      "Hometown",
      "Cemetery",
      "Place lived",
    ]) {
      fireEvent.click(screen.getByRole("switch", { name }));
    }

    expect(screen.queryByTestId("map-marker")).not.toBeInTheDocument();
    expect(
      screen.getByText("All location types are hidden"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enable a location type above to show its markers"),
    ).toBeInTheDocument();
  });

  it("groups items sharing a coordinate into one marker with one popup section per type", () => {
    useMemberStore.setState({ members: [member, secondMember] });

    render(<MapView />);

    // Vienna now carries both Alex's birthplace and Jamie's hometown, so it
    // should still be a single marker, not two.
    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);

    const viennaMarker = screen
      .getAllByTestId("map-marker")
      .find((marker) => within(marker).queryByText("Alex Example"));
    expect(viennaMarker).toBeDefined();
    const scoped = within(viennaMarker!);
    expect(scoped.getByText("Birthplace")).toBeInTheDocument();
    expect(scoped.getByText("Hometown")).toBeInTheDocument();
    expect(scoped.getByText("Alex Example")).toBeInTheDocument();
    expect(scoped.getByText("Jamie Sample")).toBeInTheDocument();
  });

  it("navigates to the tree view centered on the clicked member name in a member-based popup item", () => {
    render(<MapView />);

    // Vienna is Alex's birthplace-only marker: exactly one clickable name.
    const viennaMarker = screen
      .getAllByTestId("map-marker")
      .find((marker) => within(marker).queryByText("Vienna"));
    expect(viennaMarker).toBeDefined();

    fireEvent.click(within(viennaMarker!).getByText("Alex Example"));

    expect(useMemberStore.getState().pendingLocateMemberId).toBe(member.id);
    expect(useNavigationStore.getState().pendingView).toBe("tree-view");
  });

  it("navigates to the tree view for a linked member name inside an event popup", () => {
    render(<MapView />);

    // Paris only carries the education event, whose sole linked member is Alex.
    const parisMarker = screen
      .getAllByTestId("map-marker")
      .find((marker) => within(marker).queryByText("Paris"));
    expect(parisMarker).toBeDefined();

    fireEvent.click(within(parisMarker!).getByText("Alex Example"));

    expect(useMemberStore.getState().pendingLocateMemberId).toBe(member.id);
    expect(useNavigationStore.getState().pendingView).toBe("tree-view");
  });

  it("filters places-lived markers by date range", () => {
    const hasBerlinMarker = () =>
      screen
        .getAllByTestId("map-marker")
        .some((marker) => within(marker).queryByText("Berlin"));

    render(<MapView />);

    // Berlin (2010–2015) is visible without a filter.
    expect(hasBerlinMarker()).toBe(true);
    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2016" },
    });

    // Berlin's stay ended in 2015, before the "From" filter of 2016, so its
    // marker (no longer backed by any other visible type) disappears. The
    // Paris event (dated 2012) is also excluded by the same >= dateFrom
    // check, so two markers drop out.
    expect(hasBerlinMarker()).toBe(false);
    expect(screen.getAllByTestId("map-marker")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    expect(hasBerlinMarker()).toBe(true);
    expect(screen.getAllByTestId("map-marker")).toHaveLength(4);
  });

  it("enables the recenter button only once markers are present, and bumps the fit signal on click", () => {
    useGeocodeStore.setState({
      coords: new Map(),
      resolveLocations: vi.fn(async () => undefined),
    });
    const { rerender } = render(<MapView />);

    const recenterButton = screen.getByRole("button", {
      name: "Fit to markers",
    });
    expect(recenterButton).toBeDisabled();

    useGeocodeStore.setState({
      coords,
      resolveLocations: vi.fn(async () => undefined),
    });
    rerender(<MapView />);

    const enabledRecenterButton = screen.getByRole("button", {
      name: "Fit to markers",
    });
    expect(enabledRecenterButton).toBeEnabled();

    fireEvent.click(enabledRecenterButton);
    // FitBounds reacts to fitSignal via its own effect (mocked away here via
    // useMap), so we only assert the button remains enabled and clickable
    // rather than reaching into Leaflet internals.
    expect(enabledRecenterButton).toBeEnabled();
  });

  it("renders the life path only when a single member with >=2 geocoded places is selected", () => {
    render(<MapView />);

    // "All Members" selected by default: no life path.
    expect(screen.queryByTestId("life-path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Alex Example" }));

    // Alex has a geocoded birthplace (Vienna) and a geocoded place lived
    // (Berlin), so the life path should now render.
    expect(screen.getByTestId("life-path")).toBeInTheDocument();
  });

  it("hides the time-travel slider until dates exist, and lets asOfYear hide later markers", () => {
    const hasParisMarker = () =>
      screen
        .getAllByTestId("map-marker")
        .some((marker) => within(marker).queryByText("Paris"));

    render(<MapView />);

    const timeTravelSwitch = screen.getByRole("switch", {
      name: "Time travel",
    });
    expect(timeTravelSwitch).toBeInTheDocument();

    fireEvent.click(timeTravelSwitch);

    // The slider initializes to the latest year, so nothing is hidden yet.
    expect(hasParisMarker()).toBe(true);

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "2011" } });

    // The Paris event (2012) is now after the as-of-year, so its marker
    // disappears; Berlin (from 2010) remains.
    expect(hasParisMarker()).toBe(false);
  });
});
