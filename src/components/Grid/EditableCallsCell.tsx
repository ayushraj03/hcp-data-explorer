import { useEffect, useRef, useState } from "react";
import { useGridStore } from "../../store/useGridStore";
import { getEffectiveCalls } from "../../engine/values";
import type { HcpRecord, RowIndex } from "../../store/types";

const CALL_CAP = 60; // mirrors mock-validator.ts's business rule, for the pre-existing-outlier hint

interface Props {
  rowIndex: RowIndex;
  row: HcpRecord;
}

/**
 * Lifecycle: idle -> editing (local, uncommitted) -> pending (locked,
 * excluded from aggregates) -> saved | rejected (reverts + shows reason).
 *
 * Concurrency rule (FR-4): while pending, the cell is locked — clicking or
 * typing is a no-op. There is at most one in-flight request per row at a
 * time, enforced here and defensively in the store action.
 */
export function EditableCallsCell({ rowIndex, row }: Props) {
  const accepted = useGridStore((s) => s.acceptedEdits.get(rowIndex));
  const pending = useGridStore((s) => s.pendingEdits.get(rowIndex));
  const rejected = useGridStore((s) => s.rejectedFlash.get(rowIndex));
  const commitEdit = useGridStore((s) => s.commitEdit);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveValue = getEffectiveCalls(row, accepted) ?? 0;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select(); // replace-on-type, like a spreadsheet cell
    }
  }, [isEditing]);

  useEffect(() => {
    if (!accepted) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted?.acceptedAt]);

  if (pending) {
    return (
      <div className="cell cell--calls cell--pending" title="Saving… locked until the validator responds">
        <span>{pending.value}</span>
        <span className="cell__spinner" aria-hidden="true" />
      </div>
    );
  }

  if (rejected && !isEditing) {
    return (
      <button
        type="button"
        className="cell cell--calls cell--rejected"
        title={`Rejected: ${rejected.reason}. Reverted to ${rejected.revertedTo}. Click to try again.`}
        onClick={() => {
          setDraft(String(rejected.revertedTo));
          setIsEditing(true);
        }}
      >
        <span>{rejected.revertedTo}</span>
        <span className="cell__reject-badge">!</span>
      </button>
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="cell cell--calls cell--editing"
        defaultValue={draft || String(effectiveValue)}
        min={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setIsEditing(false);
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    );
  }

  const exceedsCap = effectiveValue > CALL_CAP;

  return (
    <button
      type="button"
      className={`cell cell--calls${justSaved ? " cell--saved-flash" : ""}${exceedsCap ? " cell--over-cap" : ""}`}
      onClick={() => {
        setDraft(String(effectiveValue));
        setIsEditing(true);
      }}
      title={exceedsCap ? `Exceeds per-HCP call cap (${CALL_CAP}) — pre-existing data issue` : "Click to edit"}
    >
      {effectiveValue}
    </button>
  );

  function commit(raw: string) {
    setIsEditing(false);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || raw.trim() === "") return; // invalid input: silently revert to idle, no commit
    if (parsed === effectiveValue) return; // no-op edit
    commitEdit(rowIndex, Math.max(0, Math.round(parsed)));
  }
}
