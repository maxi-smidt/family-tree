import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageStore } from "@/hooks/useStorageStore";
import { StorageUsagePanel } from "./StorageUsagePanel";
import { WorkspaceStorageUsageDB } from "@/types/storage";

vi.mock("@/hooks/useStorageStore");

const TREE_ID = "tree-ui-test";

const mockRefresh = vi.fn().mockResolvedValue(undefined);

interface MockStoreState {
  usage: WorkspaceStorageUsageDB | null;
  isLoading: boolean;
  refreshStorageUsage: typeof mockRefresh;
  clear: ReturnType<typeof vi.fn>;
}

function mockStore(overrides: Partial<MockStoreState> = {}) {
  const state: MockStoreState = {
    usage: null,
    isLoading: false,
    refreshStorageUsage: mockRefresh,
    clear: vi.fn(),
    ...overrides,
  };
  vi.mocked(useStorageStore).mockReturnValue(state as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore();
});

describe("StorageUsagePanel", () => {
  it("shows loading indicator while fetching and no usage available", () => {
    mockStore({ isLoading: true });

    render(<StorageUsagePanel workspaceId={TREE_ID} />);

    // t("title") == "Owner storage", component appends "…"
    expect(screen.getByText(/owner storage…/i)).toBeInTheDocument();
  });

  it("renders nothing when not loading and no usage", () => {
    const { container } = render(<StorageUsagePanel workspaceId={TREE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders usage rows with quota values", () => {
    mockStore({
      usage: {
        tree_bytes: 512,
        media_bytes: 1024,
        total_bytes: 1536,
        tree_quota_bytes: 10240,
        media_quota_bytes: 20480,
      },
    });

    render(<StorageUsagePanel workspaceId={TREE_ID} />);

    // Section heading — t("title") == "Owner storage"
    expect(screen.getByText("Owner storage")).toBeInTheDocument();
    // Row labels — t("tree") == "Workspace data", t("media") == "Media files", t("total") == "Total"
    expect(screen.getByText("Workspace data")).toBeInTheDocument();
    expect(screen.getByText("Media files")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    // Total has no quota — it's just the formatted sum (1536 bytes == 1.5 KB).
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
  });

  it("shows the ∞ symbol when quota is null", () => {
    mockStore({
      usage: {
        tree_bytes: 256,
        media_bytes: 512,
        total_bytes: 768,
        tree_quota_bytes: null,
        media_quota_bytes: null,
      },
    });

    render(<StorageUsagePanel workspaceId={TREE_ID} />);

    // Unlimited quotas render as "<used> / ∞" — one per null-quota row (tree +
    // media only; the total is a plain sum), with the translated "unlimited"
    // word exposed via the title attribute.
    const unlimitedEls = screen.getAllByText(/∞/);
    expect(unlimitedEls.length).toBe(2);
    expect(unlimitedEls[0]).toHaveAttribute("title", "unlimited");
  });

  it("calls refreshStorageUsage with the workspaceId on mount", () => {
    render(<StorageUsagePanel workspaceId={TREE_ID} />);
    expect(mockRefresh).toHaveBeenCalledWith(TREE_ID);
  });
});
