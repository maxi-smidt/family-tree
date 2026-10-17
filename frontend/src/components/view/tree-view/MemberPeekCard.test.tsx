import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMember, type Member } from "@/types/member";
import { MemberPeekCard } from "./MemberPeekCard";

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    ...createMember({ x: 0, y: 0 }),
    firstName: "Thomas",
    lastName: "Gruber",
    birthplace: "Wien",
    ...overrides,
  };
}

function renderCard(member: Member, canEdit = true) {
  const handlers = {
    onView: vi.fn(),
    onEdit: vi.fn(),
    onAddParent: vi.fn(),
    onAddPartner: vi.fn(),
    onAddChild: vi.fn(),
    onClose: vi.fn(),
  };
  render(<MemberPeekCard member={member} canEdit={canEdit} {...handlers} />);
  return handlers;
}

describe("MemberPeekCard", () => {
  it("introduces a living person with where they were born and their age", () => {
    const thisYear = new Date().getFullYear();
    renderCard(makeMember({ date: { birth: "1976-02-28", death: null } }));
    expect(
      screen.getByRole("region", { name: "Thomas Gruber" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`Born .*1976 in Wien · ${thisYear - 1976} years`),
      ),
    ).toBeInTheDocument();
  });

  it("states the death and age reached for a deceased person", () => {
    renderCard(
      makeMember({
        deceased: true,
        date: { birth: "1921-03-14", death: "1994-11-02" },
      }),
    );
    expect(screen.getByText(/† .*1994 · aged 73/)).toBeInTheDocument();
  });

  it("opens the profile and offers edit and add-relative to editors", async () => {
    const handlers = renderCard(makeMember());
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(handlers.onView).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(handlers.onEdit).toHaveBeenCalled();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Add relative" }),
      {
        pointerType: "mouse",
      },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add child" }));
    expect(handlers.onAddChild).toHaveBeenCalled();
  });

  it("only offers the profile to viewers", () => {
    renderCard(makeMember(), false);
    expect(
      screen.getByRole("button", { name: "View profile" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add relative" })).toBeNull();
  });

  it("closes on Escape", () => {
    const handlers = renderCard(makeMember());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
