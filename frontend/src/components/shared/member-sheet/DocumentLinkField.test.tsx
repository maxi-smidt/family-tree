import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/hooks/useDocumentStore";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { Document } from "@/types/document";
import { DocumentLinkField } from "./DocumentLinkField";

const doc = (id: string, title: string, memberIds: string[]): Document => ({
  id,
  title,
  description: null,
  documentDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  files: [],
  memberIds,
  eventIds: [],
  storyIds: [],
});

const OWN_DOC = doc("doc-own", "Own document", ["member-1"]);
const OTHER_DOC = doc("doc-other", "Other member's document", ["member-2"]);
const ALREADY_LINKED_DOC = doc("doc-linked", "Already linked elsewhere", [
  "member-2",
]);

beforeEach(() => {
  useDocumentStore.setState({
    documents: [OWN_DOC, OTHER_DOC, ALREADY_LINKED_DOC],
    initialized: true,
  });
  useMemberStore.setState({ members: [] });
});

const openMenu = () => fireEvent.click(screen.getByRole("combobox"));

describe("DocumentLinkField", () => {
  it("only lists documents belonging to the seeded member", async () => {
    render(
      <DocumentLinkField
        documentIds={[]}
        onChange={vi.fn()}
        seedMemberIds={["member-1"]}
      />,
    );

    openMenu();
    expect(
      await screen.findByRole("option", { name: /Own document/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Other member's document/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Already linked elsewhere/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps an already-linked document visible even outside the seeded scope", () => {
    render(
      <DocumentLinkField
        documentIds={["doc-linked"]}
        onChange={vi.fn()}
        seedMemberIds={["member-1"]}
      />,
    );

    // Still shown as a removable chip, not silently dropped from the value
    // (it isn't offered again as a candidate since it's already selected).
    expect(
      screen.getByRole("button", { name: /Remove Already linked elsewhere/ }),
    ).toBeInTheDocument();
  });
});
