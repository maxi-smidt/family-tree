import { describe, it, expect } from "vitest";
import { aggregate, type CustomWidget } from "./customWidgets";
import { createMember, type Member } from "@/types/member";

const t = (k: string) => k;

function makeMember(overrides: Partial<Member>): Member {
  return { ...createMember({ x: 0, y: 0 }), ...overrides };
}

describe("aggregate", () => {
  it("counts members grouped by gender", () => {
    const members = [
      makeMember({ gender: "m" }),
      makeMember({ gender: "m" }),
      makeMember({ gender: "f" }),
    ];
    const cfg: Pick<CustomWidget, "dimensionId" | "measureId" | "breakdownId"> = {
      dimensionId: "gender",
      measureId: "count",
      breakdownId: null,
    };
    const { data, series } = aggregate(members, cfg, t);
    expect(series).toHaveLength(1);
    // gender natural order: male first, then female
    expect(data[0]).toMatchObject({ category: "gender-male", __value__: 2 });
    expect(data[1]).toMatchObject({ category: "gender-female", __value__: 1 });
  });

  it("groups by birth decade in chronological order", () => {
    const members = [
      makeMember({ date: { birth: "1985-01-01", death: null } }),
      makeMember({ date: { birth: "1992", death: null } }),
      makeMember({ date: { birth: "1988", death: null } }),
    ];
    const { data } = aggregate(
      members,
      { dimensionId: "birth-decade", measureId: "count", breakdownId: null },
      t,
    );
    expect(data.map((d) => d.category)).toEqual(["1980s", "1990s"]);
    expect(data[0].__value__).toBe(2);
    expect(data[1].__value__).toBe(1);
  });

  it("excludes members with no value for the dimension", () => {
    const members = [
      makeMember({ date: { birth: "1985", death: null } }),
      makeMember({ date: { birth: "", death: null } }),
    ];
    const { data } = aggregate(
      members,
      { dimensionId: "birth-decade", measureId: "count", breakdownId: null },
      t,
    );
    expect(data).toHaveLength(1);
    expect(data[0].__value__).toBe(1);
  });

  it("computes average lifespan per group", () => {
    const members = [
      makeMember({ gender: "m", date: { birth: "1900", death: "1980" } }), // 80
      makeMember({ gender: "m", date: { birth: "1900", death: "1960" } }), // 60
    ];
    const { data } = aggregate(
      members,
      { dimensionId: "gender", measureId: "avg-lifespan", breakdownId: null },
      t,
    );
    expect(data[0].__value__).toBe(70);
  });

  it("splits into multiple series with a breakdown dimension", () => {
    const members = [
      makeMember({ gender: "m", date: { birth: "1980", death: null } }),
      makeMember({ gender: "f", date: { birth: "1980", death: null } }),
      makeMember({ gender: "m", date: { birth: "1990", death: null } }),
    ];
    const { data, series } = aggregate(
      members,
      { dimensionId: "birth-decade", measureId: "count", breakdownId: "gender" },
      t,
    );
    const keys = series.map((s) => s.key);
    expect(keys).toContain("m");
    expect(keys).toContain("f");
    const row1980 = data.find((d) => d.category === "1980s")!;
    expect(row1980.m).toBe(1);
    expect(row1980.f).toBe(1);
  });

  it("limits high-cardinality dimensions", () => {
    const members = Array.from({ length: 20 }, (_, i) =>
      makeMember({ lastName: `Name${i}` }),
    );
    const { data } = aggregate(
      members,
      { dimensionId: "last-name", measureId: "count", breakdownId: null },
      t,
    );
    expect(data.length).toBeLessThanOrEqual(12);
  });
});
