import { useGridStore } from "../../store/useGridStore";
import { COLUMNS } from "./columns";

const DIRECTION_ICON: Record<string, string> = { asc: "▲", desc: "▼", none: "" };

export function ColumnHeaderRow() {
  const sort = useGridStore((s) => s.sort);
  const toggleSort = useGridStore((s) => s.toggleSort);

  return (
    <div className="grid-row header-row" role="row">
      {COLUMNS.map((col) => {
        const active = sort.column === col.key;
        const dir = active ? sort.direction : "none";
        return (
          <button
            key={col.key}
            type="button"
            role="columnheader"
            aria-sort={active ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : "none"}
            className={`cell header-cell${col.align === "right" ? " cell--right" : ""}${active ? " header-cell--active" : ""}`}
            onClick={() => col.sortable && toggleSort(col.key)}
            disabled={!col.sortable}
          >
            <span>{col.label}</span>
            {active && dir !== "none" && <span className="header-cell__dir">{DIRECTION_ICON[dir]}</span>}
          </button>
        );
      })}
    </div>
  );
}
