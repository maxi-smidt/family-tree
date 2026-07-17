import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { ChangelogList } from "./ChangelogList";

vi.mock("@/lib/buildInfo", () => ({
  APP_VERSION: "1.11.0",
}));

vi.mock("@/data/changelog.json", () => ({
  default: [
    { version: "1.12.0", date: "", body: "Release 1.12.0" },
    { version: "1.11.0", date: "", body: "Release 1.11.0" },
    { version: "1.10.0", date: "", body: "Release 1.10.0" },
    { version: "1.9.0", date: "", body: "Release 1.9.0" },
    { version: "1.8.0", date: "", body: "Release 1.8.0" },
    { version: "1.7.0", date: "", body: "Release 1.7.0" },
    { version: "1.6.0", date: "", body: "Release 1.6.0" },
    { version: "1.5.0", date: "", body: "Release 1.5.0" },
    { version: "1.4.0", date: "", body: "Release 1.4.0" },
    { version: "1.3.0", date: "", body: "Release 1.3.0" },
    { version: "1.2.0", date: "", body: "Release 1.2.0" },
    { version: "1.1.0", date: "", body: "Release 1.1.0" },
  ],
}));

vi.mock("@/components/shared/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <p>{content}</p>,
}));

describe("ChangelogList", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("filters newer versions and renders older entries on demand", () => {
    render(<ChangelogList />);

    expect(screen.queryByText("Release 1.12.0")).not.toBeInTheDocument();
    expect(screen.getByText("Release 1.11.0")).toBeInTheDocument();
    expect(screen.queryByText("Release 1.1.0")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(screen.getByText("Release 1.1.0")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });
});
