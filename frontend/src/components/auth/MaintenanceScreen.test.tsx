import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { MaintenanceScreen } from "./MaintenanceScreen";

describe("MaintenanceScreen", () => {
  const retryAuthCheck = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    retryAuthCheck.mockClear();
    useAuthStore.setState({ retryAuthCheck });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only a spinner during a short restart", () => {
    render(<MaintenanceScreen />);
    expect(screen.queryByText("Starting Family Tree")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByText("Starting Family Tree")).toBeInTheDocument();
  });

  it("re-checks the backend every second", () => {
    render(<MaintenanceScreen />);
    expect(retryAuthCheck).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(3000));
    expect(retryAuthCheck).toHaveBeenCalledTimes(4);
  });
});
