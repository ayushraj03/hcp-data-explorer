import type { AcceptedEdit, HcpRecord, RowIndex } from "../store/types";
import { parseCalls } from "./values";

export interface ChangeSetEntry {
  rowIndex: RowIndex;
  id: string;
  field: "calls";
  from: number | string;
  to: number;
  acceptedAt: string; // ISO timestamp
}

/**
 * The set of *net* accepted changes versus the original source data, as a
 * JSON-serializable diff. Entries that round-tripped back to their original
 * value (edit, then edit again back to source) are excluded — "no-op edits
 * deduplicated" per the bonus spec — even though each individual commit
 * was itself a real, separately-validated edit.
 */
export function buildChangeSet(rawRows: HcpRecord[], acceptedEdits: Map<RowIndex, AcceptedEdit>): ChangeSetEntry[] {
  const entries: ChangeSetEntry[] = [];
  for (const [rowIndex, edit] of acceptedEdits) {
    const row = rawRows[rowIndex];
    const original = parseCalls(row.calls);
    if (original === edit.value) continue; // net no-op, excluded
    entries.push({
      rowIndex,
      id: row.id,
      field: "calls",
      from: row.calls,
      to: edit.value,
      acceptedAt: new Date(edit.acceptedAt).toISOString(),
    });
  }
  entries.sort((a, b) => a.rowIndex - b.rowIndex);
  return entries;
}
