import { describe, expect, it } from "vitest";
import { buildGroupIndex } from "./groupIndex";
import { computeFilter } from "./filter";
import { applyCallsDelta, buildAggregates } from "./aggregates";
import type { AcceptedEdit, HcpRecord, RowIndex } from "../store/types";

function makeRows(): HcpRecord[] {
  return [
    { id: "HCP-1", name: "A", specialty: "Oncology", region: "West", territory: "West / T1", calls: 10, trx: 100, nrx: 1 },
    { id: "HCP-2", name: "B", specialty: "Oncology", region: "West", territory: "West / T1", calls: "20", trx: 100, nrx: 1 }, // string calls
    { id: "HCP-3", name: "C", specialty: "Cardiology", region: "West", territory: "West / T2", calls: 5, trx: 50, nrx: 1 },
    { id: "HCP-4", name: "D", specialty: "Cardiology", region: "East", territory: "East / T1", calls: 7, trx: 50, nrx: 1 },
  ];
}

describe("buildAggregates", () => {
  it("sums calls/trx/nrx per territory and rolls up to region, coercing string calls", () => {
    const rows = makeRows();
    const groupIndex = buildGroupIndex(rows);
    const filter = computeFilter(rows, { search: "", region: "all" });
    const { byTerritory, byRegion } = buildAggregates(rows, groupIndex, filter, new Map());

    const t1 = byTerritory.get("West||West / T1")!;
    expect(t1.sumCalls).toBe(30); // 10 + "20"
    expect(t1.count).toBe(2);

    const west = byRegion.get("West")!;
    expect(west.sumCalls).toBe(35); // 10 + 20 + 5
    expect(west.count).toBe(3);

    const east = byRegion.get("East")!;
    expect(east.sumCalls).toBe(7);
  });

  it("excludes rows outside the current filter", () => {
    const rows = makeRows();
    const groupIndex = buildGroupIndex(rows);
    const filter = computeFilter(rows, { search: "", region: "East" });
    const { byRegion } = buildAggregates(rows, groupIndex, filter, new Map());
    expect(byRegion.get("West")!.count).toBe(0);
    expect(byRegion.get("East")!.count).toBe(1);
  });

  it("uses the accepted-edit value instead of the source value when present", () => {
    const rows = makeRows();
    const groupIndex = buildGroupIndex(rows);
    const filter = computeFilter(rows, { search: "", region: "all" });
    const edits = new Map<RowIndex, AcceptedEdit>([[0, { value: 50, previousValue: 10, acceptedAt: Date.now() }]]);
    const { byRegion } = buildAggregates(rows, groupIndex, filter, edits);
    // West was 35 with source calls=10 for row 0; with accepted edit it's 10->50, so +40
    expect(byRegion.get("West")!.sumCalls).toBe(75);
  });
});

describe("applyCallsDelta", () => {
  it("adjusts both the territory and region aggregate by the delta in O(1)", () => {
    const rows = makeRows();
    const groupIndex = buildGroupIndex(rows);
    const filter = computeFilter(rows, { search: "", region: "all" });
    const store = buildAggregates(rows, groupIndex, filter, new Map());

    const updated = applyCallsDelta(store, rows[0], filter, 0, 15); // row 0's calls went up by 15

    expect(updated.byTerritory.get("West||West / T1")!.sumCalls).toBe(45); // 30 + 15
    expect(updated.byRegion.get("West")!.sumCalls).toBe(50); // 35 + 15
    // original store is untouched (immutable update)
    expect(store.byRegion.get("West")!.sumCalls).toBe(35);
  });

  it("is a no-op when the row is excluded by the current filter", () => {
    const rows = makeRows();
    const groupIndex = buildGroupIndex(rows);
    const filter = computeFilter(rows, { search: "", region: "East" }); // row 0 (West) excluded
    const store = buildAggregates(rows, groupIndex, filter, new Map());
    const updated = applyCallsDelta(store, rows[0], filter, 0, 100);
    expect(updated).toBe(store); // same reference: genuinely skipped, not just unchanged values
  });
});
