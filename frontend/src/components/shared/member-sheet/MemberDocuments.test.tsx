import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import type { Document } from "@/types/document";
import type { Member } from "@/types/member";
import { MemberDocuments } from "./MemberDocuments";

vi.mock("@/services/TreeService");

const MEMBER: Member = {
  id: "member-1",
  gender: "f",
  academicTitle: null,
  firstName: "Ada",
  middleNames: null,
  baptismalName: null,
  lastName: "Lovelace",
  maidenName: null,
  imageData: null,
  deceased: false,
  adopted: false,
  date: { birth: "1815-12-10", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: null,
  hometown: null,
  cemetery: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
};

const DOCUMENT: Document = {
  id: "document-1",
  title: "Archive index",
  description: "A detailed description of the archive contents.",
  documentDate: "2020-01-01",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  files: [],
  memberIds: [MEMBER.id],
  eventIds: [],
  storyIds: [],
};

describe("MemberDocuments", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useDocumentStore.setState({ documents: [DOCUMENT] });
  });

  it("starts collapsed and hides the description", () => {
    render(<MemberDocuments member={MEMBER} />);

    const toggle = screen.getByRole("button", { name: /Archive index/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(DOCUMENT.description as string),
    ).not.toBeInTheDocument();
  });

  it("toggles the description and file list when the row is clicked", () => {
    render(<MemberDocuments member={MEMBER} />);

    const toggle = screen.getByRole("button", { name: /Archive index/ });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(DOCUMENT.description as string)).toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(DOCUMENT.description as string),
    ).not.toBeInTheDocument();
  });

  it("does not toggle when the edit or delete buttons are clicked", () => {
    render(<MemberDocuments member={MEMBER} />);

    const toggle = screen.getByRole("button", { name: /Archive index/ });
    const row = toggle.parentElement as HTMLElement;
    const actionButtons = within(row)
      .getAllByRole("button")
      .filter((button) => button !== toggle);
    expect(actionButtons).toHaveLength(2);

    actionButtons.forEach((button) => fireEvent.click(button));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
