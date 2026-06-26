import { describe, it, expect } from "vitest";
import {
  aggregate,
  serializeWidgets,
  parseWidgetsExport,
  chartTypeMeta,
  WIDGET_EXPORT_TYPE,
  type CustomWidget,
} from "./customWidgets";
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

describe("widget import/export", () => {
  const widget: CustomWidget = {
    id: "custom:abc",
    kind: "custom",
    chartType: "bar",
    dimensionId: "birth-decade",
    measureId: "count",
    breakdownId: "gender",
    title: "Births by decade",
    xLabel: "Decade",
    yLabel: "People",
    color: "#6366f1",
  };

  it("round-trips through serialize → parse, dropping id/kind", () => {
    const json = serializeWidgets([widget]);
    const envelope = JSON.parse(json);
    expect(envelope.type).toBe(WIDGET_EXPORT_TYPE);
    expect(envelope.widgets[0]).not.toHaveProperty("id");
    expect(envelope.widgets[0]).not.toHaveProperty("kind");

    const parsed = parseWidgetsExport(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      chartType: "bar",
      dimensionId: "birth-decade",
      measureId: "count",
      breakdownId: "gender",
      title: "Births by decade",
    });
  });

  it("accepts a bare array of configs", () => {
    const parsed = parseWidgetsExport([
      { chartType: "pie", dimensionId: "gender", measureId: "count", title: "G", color: "#abcdef" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].breakdownId).toBeNull();
  });

  it("drops entries that reference unknown dimensions/measures/types", () => {
    const parsed = parseWidgetsExport([
      { chartType: "bar", dimensionId: "nope", measureId: "count", title: "x", color: "#000000" },
      { chartType: "scatter", dimensionId: "gender", measureId: "count", title: "y", color: "#000000" },
      { chartType: "bar", dimensionId: "gender", measureId: "count", title: "ok", color: "#000000" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("ok");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseWidgetsExport("{not json")).toThrow();
  });

  it("throws on an unrecognized object payload", () => {
    expect(() => parseWidgetsExport({ foo: "bar" })).toThrow();
  });

  it("preserves the stacked flag through a round-trip", () => {
    const stacked = parseWidgetsExport(serializeWidgets([{ ...widget, stacked: false }]));
    expect(stacked[0].stacked).toBe(false);
  });
});

describe("chartTypeMeta", () => {
  it("frames pie charts as slices without axes, breakdown, or stacking", () => {
    const meta = chartTypeMeta("pie");
    expect(meta.hasAxes).toBe(false);
    expect(meta.supportsBreakdown).toBe(false);
    expect(meta.supportsStacking).toBe(false);
    expect(meta.dimensionLabelKey).toBe("field-slice-by");
  });

  it("frames bar/area as cartesian with stacking, line without stacking", () => {
    expect(chartTypeMeta("bar")).toMatchObject({ hasAxes: true, supportsBreakdown: true, supportsStacking: true });
    expect(chartTypeMeta("area").supportsStacking).toBe(true);
    expect(chartTypeMeta("line").supportsStacking).toBe(false);
    expect(chartTypeMeta("bar").dimensionLabelKey).toBe("field-x-axis");
  });
});
