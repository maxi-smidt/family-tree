import { fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useFamilyTreeSettings } from "@/hooks/useFamilyTreeSettings";
import { useMemberStore } from "@/hooks/useMemberStore";
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
  beforeEach(async () => {
    await i18n.changeLanguage("en");
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

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange members" }));

    expect(onRearrange).not.toHaveBeenCalled();
    expect(screen.getByText("Arrange the tree?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));

    expect(onRearrange).toHaveBeenCalledTimes(1);
  });
});
