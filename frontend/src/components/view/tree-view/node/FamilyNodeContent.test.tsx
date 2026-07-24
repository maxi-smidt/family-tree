import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMember } from "@/types/member";
import { FamilyNodeContent } from "./FamilyNodeContent";

function makeMember(overrides: Partial<ReturnType<typeof createMember>> = {}) {
  return { ...createMember({ x: 0, y: 0 }), ...overrides };
}

const CROSS_LABEL = "Deceased, date of death unknown";

const CASES = [
  {
    name: "shows only the birth year for a living member",
    date: { birth: "1990", death: null },
    deceased: false,
    expectVisible: [/1990/],
    expectAbsent: [/†/, /ongoing/i, /unknown/i, /deceased/i],
    crossVisible: false,
  },
  {
    name: "shows birth date and † for a deceased member with unknown death date",
    date: { birth: "1940", death: null },
    deceased: true,
    expectVisible: [/1940/],
    expectAbsent: [/ongoing/i],
    crossVisible: true,
  },
  {
    name: "shows birth – death for a deceased member with known death date, no †",
    date: { birth: "1920", death: "2000" },
    deceased: true,
    expectVisible: [/1920/, /2000/],
    expectAbsent: [/ongoing/i, /deceased/i],
    crossVisible: false,
  },
  {
    name: "renders nothing in the date area for a member with no birth date and not deceased",
    date: { birth: "", death: null },
    deceased: false,
    expectVisible: [],
    expectAbsent: [/†/, /unknown/i, /ungewiss/i],
    crossVisible: false,
  },
];

describe("FamilyNodeContent – life dates display", () => {
  it.each(CASES)(
    "$name",
    ({ date, deceased, expectVisible, expectAbsent, crossVisible }) => {
      const member = makeMember({ date, deceased });
      render(<FamilyNodeContent member={member} disableNameLink />);

      for (const pattern of expectVisible) {
        expect(screen.getByText(pattern)).toBeInTheDocument();
      }
      for (const pattern of expectAbsent) {
        expect(screen.queryByText(pattern)).not.toBeInTheDocument();
      }

      const cross = screen.queryByRole("img", { name: CROSS_LABEL });
      if (crossVisible) {
        expect(cross).toBeInTheDocument();
        expect(cross?.textContent).toBe("†");
      } else {
        expect(cross).not.toBeInTheDocument();
      }
    },
  );
});
