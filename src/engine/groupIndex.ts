import type { GroupIndex, HcpRecord, RowIndex } from "../store/types";
import { territoryKey } from "./values";

/**
 * Builds the static Region -> Territory -> row-index structure once, at
 * load, from the raw (unfiltered, unsorted) dataset. Region/Territory are
 * never edited, so this never needs to be rebuilt — only re-filtered.
 *
 * Region order and territory order are "first seen" order in generator
 * output, which is stable across runs because the generator is deterministic.
 */
export function buildGroupIndex(rawRows: HcpRecord[]): GroupIndex {
  const regionOrder: string[] = [];
  const territoryOrderByRegion = new Map<string, string[]>();
  const rowsByTerritory = new Map<string, RowIndex[]>();
  const rowsByRegion = new Map<string, RowIndex[]>();

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const { region, territory } = row;

    if (!rowsByRegion.has(region)) {
      regionOrder.push(region);
      rowsByRegion.set(region, []);
      territoryOrderByRegion.set(region, []);
    }
    rowsByRegion.get(region)!.push(i);

    const tKey = territoryKey(region, territory);
    if (!rowsByTerritory.has(tKey)) {
      territoryOrderByRegion.get(region)!.push(territory);
      rowsByTerritory.set(tKey, []);
    }
    rowsByTerritory.get(tKey)!.push(i);
  }

  return { regionOrder, territoryOrderByRegion, rowsByTerritory, rowsByRegion };
}
