import { describe, expect, it } from "vitest";
import { getSortValue, sortGroupKeys, sortRowIndices } from "./sort";
import type { AcceptedEdit, GroupAggregate, HcpRecord, RowIndex } from "../store/types";

function makeRows(): HcpRecord[] {
  return [
    { id: "HCP-000001", name: "Zed", specialty: "Oncology", region: "West", territory: "West / T1", calls: 10, trx: 100, nrx: 1 },
    { id: "HCP-000002", name: "Amy", specialty: null, region: "West", territory: "West / T1", calls: "5", trx: 50, nrx: 2 },
    { id: "HCP-000003", name: "Mid", specialty: "Cardiology", region: "West", territory: "West / T1", calls: 30, trx: 0, nrx: 3 }, // TRx 0 -> CPI undefined
  ];
}

describe("getSortValue", () => {
  it("returns null for null specialty", () => {
    const rows = makeRows();
    expect(getSortValue(rows[1], undefined, "specialty")).toBeNull();
  });

  it("coerces string calls to a number for sorting", () => {
    const rows = makeRows();
    expect(getSortValue(rows[1], undefined, "calls")).toBe(5);
  });

  it("returns null CPI when TRx is 0", () => {
    const rows = makeRows();
    expect(getSortValue(rows[2], undefined, "cpi")).toBeNull();
  });

  it("prefers an accepted edit's value over the source value", () => {
    const rows = makeRows();
    const accepted: AcceptedEdit = { value: 99, previousValue: 10, acceptedAt: Date.now() };
    expect(getSortValue(rows[0], accepted, "calls")).toBe(99);
  });
});

describe("sortRowIndices", () => {
  const rows = makeRows();
  const edits = new Map<RowIndex, AcceptedEdit>();

  it("returns the original order when direction is none", () => {
    expect(sortRowIndices([0, 1, 2], rows, edits, "calls", "none")).toEqual([0, 1, 2]);
  });

  it("sorts ascending by calls, coercing the string value", () => {
    // calls: row0=10, row1="5"->5, row2=30
    expect(sortRowIndices([0, 1, 2], rows, edits, "calls", "asc")).toEqual([1, 0, 2]);
  });

  it("sorts descending by calls", () => {
    expect(sortRowIndices([0, 1, 2], rows, edits, "calls", "desc")).toEqual([2, 0, 1]);
  });

  it("puts null CPI last regardless of direction", () => {
    const asc = sortRowIndices([0, 1, 2], rows, edits, "cpi", "asc");
    const desc = sortRowIndices([0, 1, 2], rows, edits, "cpi", "desc");
    expect(asc[asc.length - 1]).toBe(2); // row2 has undefined CPI (TRx=0)
    expect(desc[desc.length - 1]).toBe(2);
  });

  it("is stable: equal values keep original relative (index) order", () => {
    const tiedRows: HcpRecord[] = [
      { id: "a", name: "A", specialty: "X", region: "R", territory: "R / T1", calls: 10, trx: 1, nrx: 0 },
      { id: "b", name: "B", specialty: "X", region: "R", territory: "R / T1", calls: 10, trx: 1, nrx: 0 },
      { id: "c", name: "C", specialty: "X", region: "R", territory: "R / T1", calls: 10, trx: 1, nrx: 0 },
    ];
    expect(sortRowIndices([2, 0, 1], tiedRows, edits, "calls", "asc")).toEqual([0, 1, 2]);
  });
});

describe("sortGroupKeys", () => {
  function agg(key: string, sumCalls: number, sumTrx = 100): GroupAggregate {
    return { key, count: 1, sumCalls, sumTrx, sumNrx: 0, unparsedCalls: 0 };
  }

  it("leaves order unchanged for non-numeric columns", () => {
    const aggregates = new Map([
      ["b", agg("b", 999)],
      ["a", agg("a", 1)],
    ]);
    expect(sortGroupKeys(["b", "a"], aggregates, "name", "asc")).toEqual(["b", "a"]);
  });

  it("reorders groups by their aggregate value for a numeric column", () => {
    const aggregates = new Map([
      ["low", agg("low", 10)],
      ["high", agg("high", 100)],
      ["mid", agg("mid", 50)],
    ]);
    expect(sortGroupKeys(["low", "high", "mid"], aggregates, "calls", "asc")).toEqual(["low", "mid", "high"]);
    expect(sortGroupKeys(["low", "high", "mid"], aggregates, "calls", "desc")).toEqual(["high", "mid", "low"]);
  });
});
