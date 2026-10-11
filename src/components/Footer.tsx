import { useGridStore } from "../store/useGridStore";

interface Props {
  domRowCount: number;
}

export function Footer({ domRowCount }: Props) {
  const totalFiltered = useGridStore((s) => s.filterResult.matchCount);
  const flatViewLength = useGridStore((s) => s.flatView.length);
  const totalRows = useGridStore((s) => s.rawRows.length);
  const pendingCount = useGridStore((s) => s.pendingEdits.size);
  const lastOpLabel = useGridStore((s) => s.lastOpLabel);
  const lastOpMs = useGridStore((s) => s.lastOpMs);

  return (
    <div className="footer">
      <span>
        rows in DOM: <strong>{domRowCount}</strong> of {flatViewLength.toLocaleString()} visible rows (
        {totalFiltered.toLocaleString()} of {totalRows.toLocaleString()} HCPs match filters)
      </span>
      <span>pending changes: <strong>{pendingCount}</strong></span>
      <span>
        last op: <strong>{lastOpLabel}</strong> ({lastOpMs.toFixed(1)} ms)
      </span>
    </div>
  );
}
