import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/i18n";
import { createMember } from "@/types/member";
import { FamilyNodeContent } from "./FamilyNodeContent";

function makeMember(overrides: Partial<ReturnType<typeof createMember>> = {}) {
  return { ...createMember({ x: 0, y: 0 }), ...overrides };
}

describe("FamilyNodeContent – life dates display", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows only the birth year for a living member", () => {
    const member = makeMember({
      date: { birth: "1990", death: null },
      deceased: false,
    });
    render(<FamilyNodeContent member={member} disableNameLink />);

    expect(screen.getByText("1990")).toBeInTheDocument();
    expect(screen.queryByText("†")).not.toBeInTheDocument();
    // No status words
    expect(screen.queryByText(/ongoing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deceased/i)).not.toBeInTheDocument();
  });

  it("shows birth date and † for a deceased member with unknown death date", () => {
    const member = makeMember({
      date: { birth: "1940", death: null },
      deceased: true,
    });
    render(<FamilyNodeContent member={member} disableNameLink />);

    expect(screen.getByText("1940")).toBeInTheDocument();
    // The cross marker must be present with the accessible label
    const cross = screen.getByRole("img", {
      name: "Deceased, date of death unknown",
    });
    expect(cross).toBeInTheDocument();
    expect(cross.textContent).toBe("†");
    // No status words
    expect(screen.queryByText(/ongoing/i)).not.toBeInTheDocument();
  });

  it("shows birth – death for a deceased member with known death date, no †", () => {
    const member = makeMember({
      date: { birth: "1920", death: "2000" },
      deceased: true,
    });
    render(<FamilyNodeContent member={member} disableNameLink />);

    // Both years should appear in the date line
    const dateEl = screen.getByText(/1920/);
    expect(dateEl).toBeInTheDocument();
    expect(screen.getByText(/2000/)).toBeInTheDocument();

    // No cross marker and no status words
    expect(
      screen.queryByRole("img", { name: "Deceased, date of death unknown" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ongoing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deceased/i)).not.toBeInTheDocument();
  });

  it("renders nothing in the date area for a member with no birth date and not deceased", () => {
    const member = makeMember({
      date: { birth: "", death: null },
      deceased: false,
    });
    render(<FamilyNodeContent member={member} disableNameLink />);

    // No cross, no status words
    expect(screen.queryByText("†")).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ungewiss/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Deceased, date of death unknown" }),
    ).not.toBeInTheDocument();
  });
});
