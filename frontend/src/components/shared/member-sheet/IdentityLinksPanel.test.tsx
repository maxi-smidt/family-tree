import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { IdentityLink } from "@/types/identityLink";
import type { Member } from "@/types/member";
import { IdentityLinksPanel } from "./IdentityLinksPanel";

vi.mock("./ProposeIdentityLinkDialog", () => ({
  ProposeIdentityLinkDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="propose-dialog" /> : null,
}));

const MEMBER = { id: "member-1", firstName: "Ada", lastName: "Lovelace" };

const PENDING = {
  id: "link-1",
  status: "proposed",
  counterpart_protected: false,
  counterpart: {
    workspace_id: "tree-2",
    workspace_name: "Other",
    member_id: "member-2",
    display_name: "Ada L.",
  },
} as unknown as IdentityLink;

describe("IdentityLinksPanel inside the member edit form", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      selectedTree: {
        id: "tree-1",
        name: "W",
        role: "owner",
        restrictions: [],
      },
    });
    useIdentityLinkStore.setState({
      linksByMember: { "member-1": [PENDING] },
      claimsByMember: {},
      loadForMember: vi.fn().mockResolvedValue(undefined),
    });
  });

  // Regression: the panel sits inside EditMode's <form>, so a button without
  // type="button" submitted it and saved the member ("changes saved") before
  // the user had proposed anything.
  it("opens the propose dialog without submitting the surrounding form", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <IdentityLinksPanel member={MEMBER as Member} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Propose link" }));

    expect(screen.getByTestId("propose-dialog")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never renders a submit button", () => {
    const { container } = render(
      <form>
        <IdentityLinksPanel member={MEMBER as Member} />
      </form>,
    );
    for (const button of container.querySelectorAll("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
  });
});
