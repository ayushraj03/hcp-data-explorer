import type { AcceptedEdit, GroupAggregate, HcpRecord, RowIndex, SortDirection, SortableColumn } from "../store/types";
import { computeCpi, getEffectiveCalls } from "./values";

export const NUMERIC_COLUMNS: ReadonlySet<SortableColumn> = new Set(["calls", "trx", "nrx", "cpi"]);

/**
 * Sort-value extraction for a single row.
 *
 * Semantics for values that don't compare cleanly (documented in
 * ASSUMPTIONS.md):
 *  - `specialty: null` and unparseable/missing `calls` and undefined CPI
 *    (TRx = 0) all resolve to `null` here.
 *  - `null` always sorts *after every defined value, in both asc and desc*.
 *    Rationale: a value that flips from "last" to "first" when you toggle
 *    sort direction is confusing in an operational grid — "undefined/missing"
 *    should read as "missing" no matter which way you sort.
 */
export function getSortValue(
  row: HcpRecord,
  accepted: AcceptedEdit | undefined,
  column: SortableColumn
): number | string | null {
  switch (column) {
    case "id":
      return row.id;
    case "name":
      return row.name;
    case "specialty":
      return row.specialty; // already string | null
    case "calls":
      return getEffectiveCalls(row, accepted);
    case "trx":
      return row.trx;
    case "nrx":
      return row.nrx;
    case "cpi": {
      const calls = getEffectiveCalls(row, accepted);
      const cpi = computeCpi(calls, row.trx);
      return cpi === undefined ? null : cpi;
    }
  }
}

/**
 * Compares two sort values and applies `direction` to the result. Null
 * handling happens *before* the direction flip and is never flipped itself
 * — that's what guarantees "nulls last in both asc and desc" rather than
 * nulls jumping to the front when the direction is reversed.
 */
function compareValues(
  a: number | string | null,
  b: number | string | null,
  direction: Exclude<SortDirection, "none">
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last, always — not subject to direction
  if (b === null) return -1;
  const cmp = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Stable sort of row indices within a single group. Stability is guaranteed
 * explicitly (index as a final tiebreaker) rather than relying on engine
 * sort stability, and ties preserve original dataset order.
 */
export function sortRowIndices(
  indices: RowIndex[],
  rawRows: HcpRecord[],
  acceptedEdits: Map<RowIndex, AcceptedEdit>,
  column: SortableColumn | null,
  direction: SortDirection
): RowIndex[] {
  if (!column || direction === "none") return indices;
  const withValues = indices.map((idx) => ({
    idx,
    value: getSortValue(rawRows[idx], acceptedEdits.get(idx), column),
  }));
  withValues.sort((a, b) => {
    const cmp = compareValues(a.value, b.value, direction);
    if (cmp !== 0) return cmp;
    return a.idx - b.idx; // stable tiebreaker
  });
  return withValues.map((w) => w.idx);
}

function aggregateSortValue(agg: GroupAggregate, column: SortableColumn): number | null {
  switch (column) {
    case "calls":
      return agg.sumCalls;
    case "trx":
      return agg.sumTrx;
    case "nrx":
      return agg.sumNrx;
    case "cpi": {
      const cpi = computeCpi(agg.sumCalls, agg.sumTrx);
      return cpi === undefined ? null : cpi;
    }
    default:
      return null;
  }
}

/**
 * Orders a list of group keys (regions, or territories within a region) by
 * their aggregate value for a numeric column (FR-3: "groups reorder by
 * their aggregate value of that column"). For non-numeric columns, or when
 * sort is "none", returns the list unchanged (natural/first-seen order).
 */
export function sortGroupKeys(
  keys: string[],
  aggregates: Map<string, GroupAggregate>,
  column: SortableColumn | null,
  direction: SortDirection
): string[] {
  if (!column || direction === "none" || !NUMERIC_COLUMNS.has(column)) return keys;
  const withValues = keys.map((key, originalIndex) => ({
    key,
    originalIndex,
    value: aggregateSortValue(aggregates.get(key) ?? { key, count: 0, sumCalls: 0, sumTrx: 0, sumNrx: 0, unparsedCalls: 0 }, column),
  }));
  withValues.sort((a, b) => {
    const cmp = compareValues(a.value, b.value, direction);
    if (cmp !== 0) return cmp;
    return a.originalIndex - b.originalIndex;
  });
  return withValues.map((w) => w.key);
}
