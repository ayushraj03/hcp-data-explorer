import type { AcceptedEdit, GroupAggregate, GroupIndex, HcpRecord, RowIndex } from "../store/types";
import { getEffectiveCalls, territoryKey } from "./values";
import type { FilterResult } from "./filter";

export interface AggregateStore {
  /** "Region||Territory" -> aggregate. */
  byTerritory: Map<string, GroupAggregate>;
  /** "Region" -> aggregate (rollup of its territories). */
  byRegion: Map<string, GroupAggregate>;
}

function emptyAggregate(key: string): GroupAggregate {
  return { key, count: 0, sumCalls: 0, sumTrx: 0, sumNrx: 0, unparsedCalls: 0 };
}

/**
 * Full O(n) rebuild over the *filtered* rows. Called on initial load and
 * whenever the filter (search/region) changes — never on every keystroke
 * (search is debounced upstream) and never on individual edit accept,
 * which instead uses `applyCallsDelta` below for O(1) updates.
 */
export function buildAggregates(
  rawRows: HcpRecord[],
  groupIndex: GroupIndex,
  filter: FilterResult,
  acceptedEdits: Map<RowIndex, AcceptedEdit>
): AggregateStore {
  const byTerritory = new Map<string, GroupAggregate>();
  const byRegion = new Map<string, GroupAggregate>();

  for (const region of groupIndex.regionOrder) {
    byRegion.set(region, emptyAggregate(region));
    for (const territory of groupIndex.territoryOrderByRegion.get(region) ?? []) {
      byTerritory.set(territoryKey(region, territory), emptyAggregate(territoryKey(region, territory)));
    }
  }

  for (let i = 0; i < rawRows.length; i++) {
    if (filter.mask[i] === 0) continue;
    const row = rawRows[i];
    const tKey = territoryKey(row.region, row.territory);
    const tAgg = byTerritory.get(tKey)!;
    const rAgg = byRegion.get(row.region)!;

    const calls = getEffectiveCalls(row, acceptedEdits.get(i));
    tAgg.count++;
    rAgg.count++;
    tAgg.sumTrx += row.trx;
    rAgg.sumTrx += row.trx;
    tAgg.sumNrx += row.nrx;
    rAgg.sumNrx += row.nrx;
    if (calls === null) {
      tAgg.unparsedCalls++;
      rAgg.unparsedCalls++;
    } else {
      tAgg.sumCalls += calls;
      rAgg.sumCalls += calls;
    }
  }

  return { byTerritory, byRegion };
}

/**
 * O(1) incremental update applied when a single row's Calls edit is
 * *accepted*. Avoids rescanning all 50k rows on every accepted edit.
 * No-ops if the row is currently excluded by the filter (its value isn't
 * part of any visible aggregate).
 */
export function applyCallsDelta(
  store: AggregateStore,
  row: HcpRecord,
  filter: FilterResult,
  rowIndex: RowIndex,
  delta: number
): AggregateStore {
  if (filter.mask[rowIndex] === 0 || delta === 0) return store;
  const tKey = territoryKey(row.region, row.territory);
  const byTerritory = new Map(store.byTerritory);
  const byRegion = new Map(store.byRegion);

  const tAgg = byTerritory.get(tKey);
  if (tAgg) byTerritory.set(tKey, { ...tAgg, sumCalls: tAgg.sumCalls + delta });
  const rAgg = byRegion.get(row.region);
  if (rAgg) byRegion.set(row.region, { ...rAgg, sumCalls: rAgg.sumCalls + delta });

  return { byTerritory, byRegion };
}
