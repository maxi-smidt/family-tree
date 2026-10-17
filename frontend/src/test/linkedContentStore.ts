import { describe, expect, it, type MockedFunction } from "vitest";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { Workspace } from "@/types/workspace";

interface LinkedContentLifecycle<Row extends { id: string }> {
  name: string;
  workspace: Workspace;
  row: Row;
  fetchRows: MockedFunction<(workspaceId: string) => Promise<Row[]>>;
  refresh: (workspaceId?: string) => Promise<void>;
  items: () => readonly { id: string }[];
  initialized: () => boolean;
  seed: () => void;
  clear: () => void;
}

// Run the same lifecycle contract against each real store implementation.
// Payload and domain-specific mapping assertions stay beside that store's tests.
export function testLinkedContentLifecycle<Row extends { id: string }>({
  name,
  workspace,
  row,
  fetchRows,
  refresh,
  items,
  initialized,
  seed,
  clear,
}: LinkedContentLifecycle<Row>): void {
  describe(`${name} lifecycle`, () => {
    it("clears loaded items without fetching when no workspace is selected", async () => {
      seed();
      useWorkspaceStore.setState({ selectedTree: undefined });

      await refresh();

      expect(items()).toEqual([]);
      expect(fetchRows).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "workspace switch",
        selected: { ...workspace, id: "other" },
        accepted: false,
      },
      { label: "disconnect", selected: undefined, accepted: false },
      { label: "unchanged workspace", selected: workspace, accepted: true },
    ])(
      "handles an in-flight read after $label",
      async ({ selected, accepted }) => {
        let resolve!: (rows: Row[]) => void;
        const pending = new Promise<Row[]>((r) => {
          resolve = r;
        });
        fetchRows.mockReturnValueOnce(pending);

        const request = refresh(workspace.id);
        useWorkspaceStore.setState({ selectedTree: selected });
        resolve([row]);
        await request;

        expect(fetchRows).toHaveBeenCalledWith(workspace.id);
        expect(items().map((item) => item.id)).toEqual(
          accepted ? [row.id] : [],
        );
        expect(initialized()).toBe(accepted);
      },
    );

    it("clear resets loaded items and deferred-load initialization", () => {
      seed();

      clear();

      expect(items()).toEqual([]);
      expect(initialized()).toBe(false);
    });
  });
}
