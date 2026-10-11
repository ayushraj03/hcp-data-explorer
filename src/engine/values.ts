import type { AcceptedEdit, HcpRecord, RowIndex } from "../store/types";

/** "Region||Territory" composite key for the territory-level group. */
export function territoryKey(region: string, territory: string): string {
  return `${region}||${territory}`;
}

/**
 * The source `calls` field is `number | string` (see ASSUMPTIONS.md,
 * "Calls stored as string"). We coerce leniently: numeric strings parse to
 * their number; anything else is "unparsed" and excluded from sums/sorts
 * (not coerced to 0, which would silently understate a real value).
 */
export function parseCalls(raw: number | string): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The "effective" calls value for a row: the last *accepted* edit if one
 * exists, otherwise the parsed source value. Deliberately ignores any
 * in-flight pending edit — pending edits must not affect sort order,
 * aggregates, or CPI until the validator confirms them (FR-2, FR-4).
 */
export function getEffectiveCalls(
  row: HcpRecord,
  accepted: AcceptedEdit | undefined
): number | null {
  if (accepted) return accepted.value;
  return parseCalls(row.calls);
}

/** CPI = Calls ÷ TRx × 100. Undefined (not NaN/Infinity) when TRx is 0 or Calls is unparseable. */
export function computeCpi(calls: number | null, trx: number): number | undefined {
  if (calls === null || trx === 0) return undefined;
  return (calls / trx) * 100;
}

export function formatCpi(cpi: number | undefined): string {
  if (cpi === undefined) return "—";
  return String(Math.round(cpi));
}

export function formatCalls(row: HcpRecord, accepted: AcceptedEdit | undefined): string {
  if (accepted) return String(accepted.value);
  return String(row.calls);
}

export interface RowLookup {
  rawRows: HcpRecord[];
  acceptedEdits: Map<RowIndex, AcceptedEdit>;
}
