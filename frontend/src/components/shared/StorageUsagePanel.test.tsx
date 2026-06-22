import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useStorageStore } from "@/hooks/useStorageStore";
import { StorageUsagePanel } from "./StorageUsagePanel";
import { TreeStorageUsageDB } from "@/types/storage";

vi.mock("@/hooks/useStorageStore");

const TREE_ID = "tree-ui-test";

const mockRefresh = vi.fn().mockResolvedValue(undefined);

interface MockStoreState {
  usage: TreeStorageUsageDB | null;
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

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  mockStore();
});

describe("StorageUsagePanel", () => {
  it("shows loading indicator while fetching and no usage available", () => {
    mockStore({ isLoading: true });

    render(<StorageUsagePanel treeId={TREE_ID} />);

    // t("title") == "Storage", component appends "…"
    expect(screen.getByText(/storage…/i)).toBeInTheDocument();
  });

  it("renders nothing when not loading and no usage", () => {
    const { container } = render(<StorageUsagePanel treeId={TREE_ID} />);
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

    render(<StorageUsagePanel treeId={TREE_ID} />);

    // Section heading — t("title") == "Storage"
    expect(screen.getByText("Storage")).toBeInTheDocument();
    // Row labels — t("tree") == "Tree data", t("media") == "Media files", t("total") == "Total"
    expect(screen.getByText("Tree data")).toBeInTheDocument();
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

    render(<StorageUsagePanel treeId={TREE_ID} />);

    // Unlimited quotas render as "<used> / ∞" — one per null-quota row (tree +
    // media only; the total is a plain sum), with the translated "unlimited"
    // word exposed via the title attribute.
    const unlimitedEls = screen.getAllByText(/∞/);
    expect(unlimitedEls.length).toBe(2);
    expect(unlimitedEls[0]).toHaveAttribute("title", "unlimited");
  });

  it("calls refreshStorageUsage with the treeId on mount", () => {
    render(<StorageUsagePanel treeId={TREE_ID} />);
    expect(mockRefresh).toHaveBeenCalledWith(TREE_ID);
  });
});
