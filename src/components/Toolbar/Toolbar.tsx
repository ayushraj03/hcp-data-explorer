import { useGridStore } from "../../store/useGridStore";
import { buildChangeSet } from "../../engine/exportDiff";
import { SearchInput } from "./SearchInput";
import { RegionFilter } from "./RegionFilter";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Toolbar() {
  const undoStack = useGridStore((s) => s.undoStack);
  const redoStack = useGridStore((s) => s.redoStack);
  const pendingCount = useGridStore((s) => s.pendingEdits.size);
  const undo = useGridStore((s) => s.undo);
  const redo = useGridStore((s) => s.redo);
  const rawRows = useGridStore((s) => s.rawRows);
  const acceptedEdits = useGridStore((s) => s.acceptedEdits);

  const changeSet = buildChangeSet(rawRows, acceptedEdits);

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <SearchInput />
        <RegionFilter />
      </div>
      <div className="toolbar__group">
        <button type="button" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <span className="toolbar__badge" title="Edits awaiting validation">
          {pendingCount > 0 ? `${pendingCount} pending` : "no pending edits"}
        </span>
        <button
          type="button"
          onClick={() => downloadJson("hcp-change-set.json", changeSet)}
          disabled={changeSet.length === 0}
          title="Export accepted changes as a JSON diff"
        >
          ⤓ Export changes
        </button>
      </div>
      <div className="toolbar__group">
        <ThemeSwitcher />
      </div>
    </div>
  );
}
