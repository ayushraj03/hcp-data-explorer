import { describe, expect, it } from "vitest";
import { computeCpi, formatCpi, getEffectiveCalls, parseCalls } from "./values";
import type { HcpRecord } from "../store/types";

function row(overrides: Partial<HcpRecord> = {}): HcpRecord {
  return {
    id: "HCP-000001",
    name: "Test Person",
    specialty: "Oncology",
    region: "West",
    territory: "West / T1",
    calls: 10,
    trx: 100,
    nrx: 50,
    ...overrides,
  };
}

describe("parseCalls", () => {
  it("passes through finite numbers", () => {
    expect(parseCalls(24)).toBe(24);
  });

  it("coerces numeric strings (the seeded string-typed calls rows)", () => {
    expect(parseCalls("24")).toBe(24);
  });

  it("returns null for non-finite/garbage values", () => {
    expect(parseCalls(Number.NaN)).toBeNull();
    expect(parseCalls("not-a-number")).toBeNull();
  });
});

describe("getEffectiveCalls", () => {
  it("uses the raw source value when there is no accepted edit", () => {
    expect(getEffectiveCalls(row({ calls: "7" }), undefined)).toBe(7);
  });

  it("prefers the accepted edit over the source value", () => {
    const accepted = { value: 42, previousValue: 7, acceptedAt: Date.now() };
    expect(getEffectiveCalls(row({ calls: 7 }), accepted)).toBe(42);
  });
});

describe("computeCpi", () => {
  it("computes Calls / TRx * 100", () => {
    expect(computeCpi(50, 200)).toBe(25);
  });

  it("is undefined when TRx is 0 (never NaN/Infinity)", () => {
    const cpi = computeCpi(50, 0);
    expect(cpi).toBeUndefined();
    expect(Number.isNaN(cpi)).toBe(false);
  });

  it("is undefined when calls is unparseable, not coerced to 0", () => {
    expect(computeCpi(null, 200)).toBeUndefined();
  });

  it("is a real 0 (not undefined) when calls is legitimately 0 and TRx > 0", () => {
    expect(computeCpi(0, 200)).toBe(0);
  });
});

describe("formatCpi", () => {
  it("renders an em dash for undefined CPI", () => {
    expect(formatCpi(undefined)).toBe("—");
  });

  it("rounds to the nearest integer", () => {
    expect(formatCpi(24.6)).toBe("25");
  });
});
