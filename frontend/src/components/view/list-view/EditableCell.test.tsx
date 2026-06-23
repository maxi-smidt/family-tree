import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import type { Member } from "@/types/member";
import type { Tree } from "@/types/tree";
import { EditableCell } from "./EditableCell";
import { ListView } from "./ListView";

// Mock PartialDatePicker to avoid date-picker complexity
vi.mock("@/components/ui/partial-date-picker", () => ({
  PartialDatePicker: () => null,
}));

// Mock MemberSheet and dialogs to keep tests focused
vi.mock("@/components/shared/member-sheet/MemberSheet", () => ({
  MemberSheet: () => null,
}));

vi.mock("@/components/shared/dialog/MemberDetailDialog", () => ({
  MemberDetailDialog: () => null,
}));

vi.mock("@/components/shared/dialog/RemoveMemberDialog", () => ({
  RemoveMemberDialog: () => null,
}));

vi.mock("@/components/view/list-view/ListCustomizePopover", () => ({
  ListCustomizePopover: () => null,
}));

vi.mock("@/components/view/list-view/ListFilters", () => ({
  ListFilters: () => null,
  DEFAULT_FILTERS: { gender: "all", status: "all", hasPhoto: false },
}));

vi.mock("@/components/view/list-view/ListPagination", () => ({
  ListPagination: () => null,
}));

vi.mock("@/hooks/useMobile", () => ({
  useIsMobile: () => false,
}));

const member: Member = {
  id: "member-1",
  gender: "m",
  academicTitle: null,
  firstName: "John",
  middleNames: null,
  baptismalName: null,
  lastName: "Doe",
  maidenName: null,
  imageData: null,
  deceased: false,
  date: { birth: "1990", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: "Vienna",
  hometown: "Graz",
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
};

const ownerTree: Tree = {
  id: "tree-1",
  name: "My Tree",
  role: "owner",
};

const viewerTree: Tree = {
  id: "tree-2",
  name: "Shared Tree",
  role: "viewer",
};

const virtualTree: Tree = {
  id: "vv_tree-3",
  name: "Virtual View",
  role: "owner",
  is_virtual: true,
};

describe("EditableCell — text field (firstName)", () => {
  const updateMemberPartial = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    updateMemberPartial.mockClear();
    useMemberStore.setState({ members: [member], updateMemberPartial });
    useTreeStore.setState({ selectedTree: ownerTree, isReady: true });
  });

  it("1. happy commit: renders idle button, enters edit, changes value, Enter key → updateMemberPartial called once", async () => {
    render(<EditableCell member={member} columnId="firstName" />);

    // Idle: button visible with current value
    const idleBtn = screen.getByRole("button");
    expect(idleBtn).toHaveTextContent("John");

    // Click to enter edit mode
    fireEvent.click(idleBtn);

    // Input appears
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();

    // Change value
    fireEvent.change(input, { target: { value: "Jane" } });

    // Press Enter to commit
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(updateMemberPartial).toHaveBeenCalledTimes(1);
      expect(updateMemberPartial).toHaveBeenCalledWith("member-1", {
        firstName: "Jane",
      });
    });
  });

  it("2. Escape cancels: change value then press Escape → updateMemberPartial NOT called, original shown", async () => {
    render(<EditableCell member={member} columnId="firstName" />);

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(updateMemberPartial).not.toHaveBeenCalled();
    });

    // Original value is shown again
    expect(screen.getByRole("button")).toHaveTextContent("John");
  });

  it("3. no-op: Enter without changing → updateMemberPartial NOT called", async () => {
    render(<EditableCell member={member} columnId="firstName" />);

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox");
    // Don't change — press Enter immediately
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(updateMemberPartial).not.toHaveBeenCalled();
    });
  });

  it("3b. blur without changing → updateMemberPartial NOT called", async () => {
    render(<EditableCell member={member} columnId="firstName" />);

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox");
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updateMemberPartial).not.toHaveBeenCalled();
    });
  });
});

describe("EditableCell — nullable text field (maidenName)", () => {
  const updateMemberPartial = vi.fn().mockResolvedValue(undefined);

  const memberWithMaiden: Member = {
    ...member,
    maidenName: "Smith",
  };

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    updateMemberPartial.mockClear();
    useMemberStore.setState({
      members: [memberWithMaiden],
      updateMemberPartial,
    });
  });

  it("commits with null when nullable field is cleared", async () => {
    render(<EditableCell member={memberWithMaiden} columnId="maidenName" />);

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(updateMemberPartial).toHaveBeenCalledWith("member-1", {
        maidenName: null,
      });
    });
  });
});

describe("ListView — Quick edit toggle gating", () => {
  const updateMemberPartial = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    updateMemberPartial.mockClear();
    useMemberStore.setState({ members: [member], updateMemberPartial });
  });

  it("4a. Quick edit toggle is NOT rendered for a viewer-role tree", () => {
    useTreeStore.setState({ selectedTree: viewerTree, isReady: true });
    render(<ListView />);

    expect(
      screen.queryByRole("button", { name: /quick edit/i }),
    ).not.toBeInTheDocument();
  });

  it("4b. Quick edit toggle is NOT rendered for a virtual tree (vv_ prefix)", () => {
    useTreeStore.setState({ selectedTree: virtualTree, isReady: true });
    render(<ListView />);

    expect(
      screen.queryByRole("button", { name: /quick edit/i }),
    ).not.toBeInTheDocument();
  });

  it("4c. Quick edit toggle IS rendered for an owner tree", () => {
    useTreeStore.setState({ selectedTree: ownerTree, isReady: true });
    render(<ListView />);

    expect(
      screen.getByRole("button", { name: /quick edit/i }),
    ).toBeInTheDocument();
  });

  it("4d. clicking Quick edit toggle activates inline edit mode (aria-pressed becomes true)", () => {
    useTreeStore.setState({ selectedTree: ownerTree, isReady: true });
    render(<ListView />);

    const toggleBtn = screen.getByRole("button", { name: /quick edit/i });
    expect(toggleBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggleBtn);

    expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });
});
