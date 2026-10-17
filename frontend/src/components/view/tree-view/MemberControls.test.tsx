import { fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useMemberStore } from "@/hooks/useMemberStore";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MemberControls } from "./MemberControls";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: vi.fn((point) => point),
    }),
  };
});

const nodes = [
  {
    id: "member-1",
    position: { x: 0, y: 0 },
    data: { isCollapsed: false },
  },
] as Node[];

describe("MemberControls", () => {
  beforeEach(() => {
    useFamilyTreeSettings.setState({
      isLockedScreen: false,
      isFastMode: false,
      isDiseaseMode: false,
    });
    useMemberStore.setState({
      isLayouting: false,
      windowed: false,
      undoStack: [],
      redoStack: [],
    });
  });

  it("asks for confirmation before arranging members", () => {
    const onRearrange = vi.fn();

    render(
      <MemberControls
        nodes={nodes}
        selectedNodes={[]}
        setMembersToDelete={vi.fn()}
        onEditMember={vi.fn()}
        onCreateNewMember={vi.fn()}
        onRearrange={onRearrange}
        readOnly
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More actions" }),
      {
        button: 0,
      },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange members" }));

    expect(onRearrange).not.toHaveBeenCalled();
    expect(screen.getByText("Arrange the tree?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    expect(onRearrange).toHaveBeenCalledTimes(1);
  });

  it("ends the toolbar in one overflow menu that also lists the leading items", () => {
    render(
      <MemberControls
        nodes={nodes}
        selectedNodes={[]}
        setMembersToDelete={vi.fn()}
        onEditMember={vi.fn()}
        onCreateNewMember={vi.fn()}
        onRearrange={vi.fn()}
        leadingMenuItems={<DropdownMenuItem>Export image</DropdownMenuItem>}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    expect(triggers).toHaveLength(1);

    fireEvent.pointerDown(triggers[0], { button: 0 });
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items[0]).toBe("Export image");
    expect(items).toContain("Arrange members");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
