import type { HcpRecord } from "../data/data-generator";

/**
 * Row identity.
 *
 * The source dataset is NOT guaranteed to have unique `id` values — see
 * ASSUMPTIONS.md ("duplicate HCP IDs"). We therefore use the row's position
 * in the array returned by `generateRows()` as the single stable identity
 * for everything that needs one: React keys, the edits map, selection sets,
 * and undo/redo commands. The generator is deterministic and we never
 * mutate or reorder the underlying `HcpRecord[]` — we only reorder *views*
 * (arrays of indices) — so `RowIndex` is stable for the lifetime of the app.
 */
export type RowIndex = number;

export type SortDirection = "asc" | "desc" | "none";

export type SortableColumn =
  | "id"
  | "name"
  | "specialty"
  | "calls"
  | "trx"
  | "nrx"
  | "cpi";

export interface SortState {
  column: SortableColumn | null;
  direction: SortDirection;
}

/** An edit that has been confirmed by the validator and is now "live". */
export interface AcceptedEdit {
  value: number;
  previousValue: number;
  acceptedAt: number;
}

/** An edit that has been committed by the user and is awaiting validation. */
export interface PendingEdit {
  value: number;
  previousValue: number;
  requestId: number;
  startedAt: number;
}

/** A transient rejection, shown until the user interacts with the cell again. */
export interface RejectedFlash {
  reason: string;
  attemptedValue: number;
  revertedTo: number;
  at: number;
}

export type CellLifecycle = "idle" | "editing" | "pending" | "rejected" | "saved";

/** Command-pattern undo entry for a single accepted Calls edit. */
export interface EditCommand {
  type: "edit-calls";
  rowIndex: RowIndex;
  previousValue: number;
  newValue: number;
  timestamp: number;
}

export interface GroupAggregate {
  key: string; // "Region" or "Region||Territory"
  count: number;
  sumCalls: number;
  sumTrx: number;
  sumNrx: number;
  /** HCPs whose calls value could not be parsed to a number; excluded from sumCalls. */
  unparsedCalls: number;
}

export interface RegionGroupView {
  type: "region";
  region: string;
  key: string;
  aggregate: GroupAggregate;
  expanded: boolean;
}

export interface TerritoryGroupView {
  type: "territory";
  region: string;
  territory: string;
  key: string;
  aggregate: GroupAggregate;
  expanded: boolean;
}

export interface DataRowView {
  type: "row";
  rowIndex: RowIndex;
}

export type FlatViewItem = RegionGroupView | TerritoryGroupView | DataRowView;

export interface GroupIndex {
  /** Region -> ordered list of territory names. */
  regionOrder: string[];
  territoryOrderByRegion: Map<string, string[]>;
  /** "Region||Territory" -> row indices in original (generator) order. */
  rowsByTerritory: Map<string, RowIndex[]>;
  /** Region -> row indices in original order. */
  rowsByRegion: Map<string, RowIndex[]>;
}

export type { HcpRecord };
