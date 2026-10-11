import type {
  AcceptedEdit,
  FlatViewItem,
  GroupIndex,
  HcpRecord,
  RowIndex,
  SortState,
} from "../store/types";
import type { AggregateStore } from "./aggregates";
import type { FilterResult } from "./filter";
import { sortGroupKeys, sortRowIndices } from "./sort";
import { territoryKey } from "./values";

export interface ExpansionState {
  expandedRegions: Set<string>;
  expandedTerritories: Set<string>; // keyed by "Region||Territory"
}

/**
 * Builds the flattened list the virtualizer renders: a mix of region
 * header rows, territory header rows, and data rows, honoring expand/
 * collapse, the current filter, and the current sort.
 *
 * Groups whose filtered row count is 0 are omitted entirely (searching
 * for "Meera" shouldn't leave 47 empty region headers on screen).
 *
 * Recomputed (useMemo) on: filter change, sort change, expand/collapse,
 * and accepted-edit (map identity changes). NOT recomputed on pending
 * edits or raw keystrokes in the search box (debounced upstream) — see
 * README "Performance" section.
 */
export function buildFlatView(
  rawRows: HcpRecord[],
  groupIndex: GroupIndex,
  filter: FilterResult,
  aggregates: AggregateStore,
  acceptedEdits: Map<RowIndex, AcceptedEdit>,
  sort: SortState,
  expansion: ExpansionState,
  searchActive: boolean
): FlatViewItem[] {
  const items: FlatViewItem[] = [];

  const effectiveExpandedRegions = searchActive
    ? union(expansion.expandedRegions, filter.matchingRegions)
    : expansion.expandedRegions;
  const effectiveExpandedTerritories = searchActive
    ? union(expansion.expandedTerritories, filter.matchingTerritories)
    : expansion.expandedTerritories;

  const regionOrder = sortGroupKeys(groupIndex.regionOrder, aggregates.byRegion, sort.column, sort.direction);

  for (const region of regionOrder) {
    const regionAgg = aggregates.byRegion.get(region);
    if (!regionAgg || regionAgg.count === 0) continue;

    const expanded = effectiveExpandedRegions.has(region);
    items.push({ type: "region", region, key: region, aggregate: regionAgg, expanded });
    if (!expanded) continue;

    const territoryNames = groupIndex.territoryOrderByRegion.get(region) ?? [];
    const territoryKeys = territoryNames.map((t) => territoryKey(region, t));
    const sortedTerritoryKeys = sortGroupKeys(territoryKeys, aggregates.byTerritory, sort.column, sort.direction);

    for (const tKey of sortedTerritoryKeys) {
      const tAgg = aggregates.byTerritory.get(tKey);
      if (!tAgg || tAgg.count === 0) continue;
      const territory = tKey.slice(region.length + 2); // strip "Region||"
      const tExpanded = effectiveExpandedTerritories.has(tKey);
      items.push({ type: "territory", region, territory, key: tKey, aggregate: tAgg, expanded: tExpanded });
      if (!tExpanded) continue;

      const rawIndices = groupIndex.rowsByTerritory.get(tKey) ?? [];
      const filtered = rawIndices.filter((i) => filter.mask[i] === 1);
      const sorted = sortRowIndices(filtered, rawRows, acceptedEdits, sort.column, sort.direction);
      for (const rowIndex of sorted) {
        items.push({ type: "row", rowIndex });
      }
    }
  }

  return items;
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  if (b.size === 0) return a;
  const out = new Set(a);
  for (const v of b) out.add(v);
  return out;
}
