import { useEffect } from "react";
import { useGridStore } from "../../store/useGridStore";
import { computeCpi, formatCpi, getEffectiveCalls } from "../../engine/values";
import type { HcpRecord, RowIndex } from "../../store/types";
import { EditableCallsCell } from "./EditableCallsCell";

interface Props {
  rowIndex: RowIndex;
  row: HcpRecord;
}

export function DataRow({ rowIndex, row }: Props) {
  const accepted = useGridStore((s) => s.acceptedEdits.get(rowIndex));
  // Driven entirely by the store: the className derives straight from
  // `shouldFlash` during render, and the effect's only job is to clear the
  // signal (an external-system update, not a local render decision) once
  // the CSS animation has had time to play.
  const shouldFlash = useGridStore((s) => s.flashRowIndex === rowIndex);
  const clearFlash = useGridStore((s) => s.clearFlash);

  useEffect(() => {
    if (!shouldFlash) return;
    const t = setTimeout(clearFlash, 1400);
    return () => clearTimeout(t);
  }, [shouldFlash, clearFlash]);

  const calls = getEffectiveCalls(row, accepted);
  const cpi = computeCpi(calls, row.trx);

  return (
    <div className={`grid-row data-row${shouldFlash ? " data-row--flash" : ""}`} role="row">
      <div className="cell" role="cell">
        {row.id}
      </div>
      <div className="cell" role="cell">
        {row.name}
      </div>
      <div className="cell" role="cell">
        {row.specialty === null ? <span className="cell--null">null</span> : row.specialty}
      </div>
      <div className="cell cell--right" role="cell">
        <EditableCallsCell rowIndex={rowIndex} row={row} />
      </div>
      <div className="cell cell--right" role="cell">
        {row.trx === 0 ? <span className="cell--zero">0</span> : row.trx}
      </div>
      <div className="cell cell--right" role="cell">
        {row.nrx}
      </div>
      <div className="cell cell--right" role="cell">
        {formatCpi(cpi)}
      </div>
    </div>
  );
}
