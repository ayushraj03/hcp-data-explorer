import { describe, expect, it } from "vitest";
import { computeFilter } from "./filter";
import type { HcpRecord } from "../store/types";

function makeRows(): HcpRecord[] {
  return [
    { id: "HCP-000001", name: "Meera Iyer", specialty: "Oncology", region: "Northeast", territory: "Northeast / T1", calls: 10, trx: 100, nrx: 1 },
    { id: "HCP-000002", name: "Rahul Khan", specialty: "Cardiology", region: "West", territory: "West / T1", calls: 5, trx: 50, nrx: 1 },
  ];
}

describe("computeFilter", () => {
  it("matches by name, case-insensitively", () => {
    const result = computeFilter(makeRows(), { search: "meera", region: "all" });
    expect(result.matchCount).toBe(1);
    expect(Array.from(result.mask)).toEqual([1, 0]);
  });

  it("matches by ID", () => {
    const result = computeFilter(makeRows(), { search: "hcp-000002", region: "all" });
    expect(result.matchCount).toBe(1);
    expect(result.mask[1]).toBe(1);
  });

  it("applies the region filter independently of search", () => {
    const result = computeFilter(makeRows(), { search: "", region: "West" });
    expect(result.matchCount).toBe(1);
    expect(result.mask[1]).toBe(1);
  });

  it("combines search and region filters with AND semantics", () => {
    const result = computeFilter(makeRows(), { search: "meera", region: "West" });
    expect(result.matchCount).toBe(0);
  });

  it("records which territories/regions contain a match, for auto-expand", () => {
    const result = computeFilter(makeRows(), { search: "rahul", region: "all" });
    expect(result.matchingRegions.has("West")).toBe(true);
    expect(result.matchingTerritories.has("West||West / T1")).toBe(true);
    expect(result.matchingRegions.has("Northeast")).toBe(false);
  });
});
