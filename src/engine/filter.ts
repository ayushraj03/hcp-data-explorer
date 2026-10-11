import type { HcpRecord } from "../store/types";
import { territoryKey } from "./values";

export interface FilterState {
  search: string; // already trimmed/lowercased by caller
  region: string; // "all" or a region name
}

export interface FilterResult {
  /** 1 byte per row: 1 = passes the current filter, 0 = excluded. Cheap, GC-friendly. */
  mask: Uint8Array;
  matchCount: number;
  /** Territory group keys ("Region||Territory") containing at least one match. Only populated when search is non-empty. */
  matchingTerritories: Set<string>;
  matchingRegions: Set<string>;
}

/**
 * Single O(n) pass over the raw rows. Called only when `search` (debounced)
 * or `region` changes — never on every accepted/pending edit, since neither
 * can change which rows match (edits only ever touch `calls`).
 */
export function computeFilter(rawRows: HcpRecord[], filter: FilterState): FilterResult {
  const n = rawRows.length;
  const mask = new Uint8Array(n);
  const hasSearch = filter.search.length > 0;
  const hasRegion = filter.region !== "all";
  const matchingTerritories = new Set<string>();
  const matchingRegions = new Set<string>();
  let matchCount = 0;

  for (let i = 0; i < n; i++) {
    const row = rawRows[i];
    if (hasRegion && row.region !== filter.region) continue;
    if (hasSearch) {
      const haystack = row.name.toLowerCase() + " " + row.id.toLowerCase();
      if (!haystack.includes(filter.search)) continue;
    }
    mask[i] = 1;
    matchCount++;
    if (hasSearch) {
      matchingTerritories.add(territoryKey(row.region, row.territory));
      matchingRegions.add(row.region);
    }
  }

  return { mask, matchCount, matchingTerritories, matchingRegions };
}
