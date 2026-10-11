import { create } from "zustand";
import { generateRows } from "../data/data-generator";
import { validateCalls } from "../data/mock-validator";
import { buildGroupIndex } from "../engine/groupIndex";
import { computeFilter, type FilterResult } from "../engine/filter";
import { buildAggregates, applyCallsDelta, type AggregateStore } from "../engine/aggregates";
import { buildFlatView } from "../engine/flatView";
import { getEffectiveCalls, parseCalls } from "../engine/values";
import type {
  AcceptedEdit,
  EditCommand,
  FlatViewItem,
  GroupIndex,
  HcpRecord,
  PendingEdit,
  RejectedFlash,
  RowIndex,
  SortDirection,
  SortState,
  SortableColumn,
} from "./types";

const MAX_UNDO_HISTORY = 200;
const REJECTED_FLASH_TTL_MS = 6000;

export interface GridState {
  // ---- static / raw data -------------------------------------------------
  rawRows: HcpRecord[];
  groupIndex: GroupIndex;

  // ---- view inputs ---------------------------------------------------------
  search: string; // debounced/committed
  regionFilter: string; // "all" | region
  sort: SortState;
  expandedRegions: Set<string>;
  expandedTerritories: Set<string>;

  // ---- edit lifecycle -------------------------------------------------------
  acceptedEdits: Map<RowIndex, AcceptedEdit>;
  pendingEdits: Map<RowIndex, PendingEdit>;
  rejectedFlash: Map<RowIndex, RejectedFlash>;
  requestCounter: number;

  // ---- undo/redo -------------------------------------------------------------
  undoStack: EditCommand[];
  redoStack: EditCommand[];

  // ---- derived (recomputed by actions, not components) ------------------------
  filterResult: FilterResult;
  aggregates: AggregateStore;
  flatView: FlatViewItem[];

  // ---- footer / instrumentation -------------------------------------------------
  lastOpLabel: string;
  lastOpMs: number;

  // ---- undo-into-view signal, consumed once by the Grid ------------------------
  scrollToRowIndex: RowIndex | null;
  flashRowIndex: RowIndex | null;

  // ---- actions -----------------------------------------------------------------
  setSearch: (value: string) => void;
  setRegionFilter: (value: string) => void;
  toggleSort: (column: SortableColumn) => void;
  toggleRegion: (region: string) => void;
  toggleTerritory: (region: string, territory: string) => void;
  startEdit: (rowIndex: RowIndex) => boolean;
  commitEdit: (rowIndex: RowIndex, value: number) => void;
  cancelEdit: (rowIndex: RowIndex) => void;
  dismissRejection: (rowIndex: RowIndex) => void;
  undo: () => void;
  redo: () => void;
  consumeScrollSignal: () => void;
  clearFlash: () => void;
}

function nextDirection(current: SortDirection): SortDirection {
  if (current === "none") return "asc";
  if (current === "asc") return "desc";
  return "none";
}

function recomputeFlatView(s: Pick<
  GridState,
  "rawRows" | "groupIndex" | "filterResult" | "aggregates" | "acceptedEdits" | "sort" | "expandedRegions" | "expandedTerritories" | "search"
>): FlatViewItem[] {
  return buildFlatView(
    s.rawRows,
    s.groupIndex,
    s.filterResult,
    s.aggregates,
    s.acceptedEdits,
    s.sort,
    { expandedRegions: s.expandedRegions, expandedTerritories: s.expandedTerritories },
    s.search.length > 0
  );
}

export const useGridStore = create<GridState>((setState, getState) => {
  const rawRows = generateRows(42, 50000);
  const groupIndex = buildGroupIndex(rawRows);
  const initialFilter = computeFilter(rawRows, { search: "", region: "all" });
  const initialAggregates = buildAggregates(rawRows, groupIndex, initialFilter, new Map());

  const baseState = {
    rawRows,
    groupIndex,
    search: "",
    regionFilter: "all",
    sort: { column: null, direction: "none" as SortDirection },
    expandedRegions: new Set<string>(),
    expandedTerritories: new Set<string>(),
    acceptedEdits: new Map<RowIndex, AcceptedEdit>(),
    pendingEdits: new Map<RowIndex, PendingEdit>(),
    rejectedFlash: new Map<RowIndex, RejectedFlash>(),
    requestCounter: 0,
    undoStack: [] as EditCommand[],
    redoStack: [] as EditCommand[],
    filterResult: initialFilter,
    aggregates: initialAggregates,
    lastOpLabel: "init",
    lastOpMs: 0,
    scrollToRowIndex: null as RowIndex | null,
    flashRowIndex: null as RowIndex | null,
  };

  const flatView = recomputeFlatView(baseState);

  return {
    ...baseState,
    flatView,

    setSearch: (value) => {
      const normalized = value.trim().toLowerCase();
      setState((state) => {
        if (normalized === state.search) return state;
        const start = performance.now();
        const filterResult = computeFilter(state.rawRows, { search: normalized, region: state.regionFilter });
        const aggregates = buildAggregates(state.rawRows, state.groupIndex, filterResult, state.acceptedEdits);
        const next = { ...state, search: normalized, filterResult, aggregates };
        const flatView = recomputeFlatView(next);
        return { ...next, flatView, lastOpLabel: "search", lastOpMs: performance.now() - start };
      });
    },

    setRegionFilter: (value) => {
      setState((state) => {
        if (value === state.regionFilter) return state;
        const start = performance.now();
        const filterResult = computeFilter(state.rawRows, { search: state.search, region: value });
        const aggregates = buildAggregates(state.rawRows, state.groupIndex, filterResult, state.acceptedEdits);
        const next = { ...state, regionFilter: value, filterResult, aggregates };
        const flatView = recomputeFlatView(next);
        return { ...next, flatView, lastOpLabel: "filter", lastOpMs: performance.now() - start };
      });
    },

    toggleSort: (column) => {
      setState((state) => {
        const start = performance.now();
        const direction: SortDirection =
          state.sort.column === column ? nextDirection(state.sort.direction) : "asc";
        const sort: SortState = { column: direction === "none" ? null : column, direction };
        const next = { ...state, sort };
        const flatView = recomputeFlatView(next);
        return { ...next, flatView, lastOpLabel: "sort", lastOpMs: performance.now() - start };
      });
    },

    toggleRegion: (region) => {
      setState((state) => {
        const start = performance.now();
        const expandedRegions = new Set(state.expandedRegions);
        if (expandedRegions.has(region)) expandedRegions.delete(region);
        else expandedRegions.add(region);
        const next = { ...state, expandedRegions };
        const flatView = recomputeFlatView(next);
        return { ...next, flatView, lastOpLabel: "toggle-region", lastOpMs: performance.now() - start };
      });
    },

    toggleTerritory: (region, territory) => {
      setState((state) => {
        const start = performance.now();
        const key = `${region}||${territory}`;
        const expandedTerritories = new Set(state.expandedTerritories);
        if (expandedTerritories.has(key)) expandedTerritories.delete(key);
        else expandedTerritories.add(key);
        const next = { ...state, expandedTerritories };
        const flatView = recomputeFlatView(next);
        return { ...next, flatView, lastOpLabel: "toggle-territory", lastOpMs: performance.now() - start };
      });
    },

    /** Returns false (no-op) if the cell is locked by an in-flight commit. */
    startEdit: (rowIndex) => {
      return !getState().pendingEdits.has(rowIndex);
    },

    commitEdit: (rowIndex, value) => {
      const state = getState();
      if (state.pendingEdits.has(rowIndex)) return; // locked: previous commit still in flight

      const row = state.rawRows[rowIndex];
      const previousValue = getEffectiveCalls(row, state.acceptedEdits.get(rowIndex)) ?? 0;
      if (previousValue === value) return; // no-op edit, nothing to commit

      const requestId = state.requestCounter + 1;
      setState((s) => {
        const pendingEdits = new Map(s.pendingEdits);
        pendingEdits.set(rowIndex, { value, previousValue, requestId, startedAt: Date.now() });
        const rejectedFlash = new Map(s.rejectedFlash);
        rejectedFlash.delete(rowIndex);
        return { pendingEdits, rejectedFlash, requestCounter: requestId };
      });

      validateCalls(value).then(
        () => {
          const current = getState();
          const pending = current.pendingEdits.get(rowIndex);
          if (!pending || pending.requestId !== requestId) return; // superseded/stale guard
          const start = performance.now();

          const acceptedEdits = new Map(current.acceptedEdits);
          acceptedEdits.set(rowIndex, { value, previousValue, acceptedAt: Date.now() });
          const pendingEdits = new Map(current.pendingEdits);
          pendingEdits.delete(rowIndex);

          const aggregates = applyCallsDelta(current.aggregates, row, current.filterResult, rowIndex, value - previousValue);

          const command: EditCommand = { type: "edit-calls", rowIndex, previousValue, newValue: value, timestamp: Date.now() };
          const undoStack = [...current.undoStack, command].slice(-MAX_UNDO_HISTORY);

          const next = { ...current, acceptedEdits, pendingEdits, aggregates, undoStack, redoStack: [] };
          const flatView = recomputeFlatView(next);
          setState({ ...next, flatView, lastOpLabel: "edit-accepted", lastOpMs: performance.now() - start });
        },
        (reason: string) => {
          const current = getState();
          const pending = current.pendingEdits.get(rowIndex);
          if (!pending || pending.requestId !== requestId) return; // superseded/stale guard

          const pendingEdits = new Map(current.pendingEdits);
          pendingEdits.delete(rowIndex);
          const rejectedAt = Date.now();
          const rejectedFlash = new Map(current.rejectedFlash);
          rejectedFlash.set(rowIndex, {
            reason: String(reason),
            attemptedValue: value,
            revertedTo: previousValue,
            at: rejectedAt,
          });
          setState({ pendingEdits, rejectedFlash, lastOpLabel: "edit-rejected" });

          // Auto-clear the rejection flash after a delay, but only if it's
          // still *this* rejection (the user may have retried and gotten a
          // newer one in the meantime).
          setTimeout(() => {
            const s = getState();
            const flash = s.rejectedFlash.get(rowIndex);
            if (flash && flash.at === rejectedAt) {
              const next = new Map(s.rejectedFlash);
              next.delete(rowIndex);
              setState({ rejectedFlash: next });
            }
          }, REJECTED_FLASH_TTL_MS);
        }
      );
    },

    cancelEdit: () => {
      /* editing (pre-commit) state is local to the cell component; nothing to do here */
    },

    dismissRejection: (rowIndex) => {
      setState((state) => {
        if (!state.rejectedFlash.has(rowIndex)) return state;
        const rejectedFlash = new Map(state.rejectedFlash);
        rejectedFlash.delete(rowIndex);
        return { rejectedFlash };
      });
    },

    undo: () => {
      const state = getState();
      const command = state.undoStack[state.undoStack.length - 1];
      if (!command) return;
      const start = performance.now();

      const row = state.rawRows[command.rowIndex];
      const originalSourceValue = parseCalls(row.calls);
      const acceptedEdits = new Map(state.acceptedEdits);
      if (originalSourceValue === command.previousValue) {
        acceptedEdits.delete(command.rowIndex);
      } else {
        acceptedEdits.set(command.rowIndex, {
          value: command.previousValue,
          previousValue: command.previousValue,
          acceptedAt: Date.now(),
        });
      }

      const delta = command.previousValue - command.newValue;
      const aggregates = applyCallsDelta(state.aggregates, row, state.filterResult, command.rowIndex, delta);

      const { expandedRegions, expandedTerritories } = ensureExpanded(state, row.region, row.territory);

      const undoStack = state.undoStack.slice(0, -1);
      const redoStack = [...state.redoStack, command];

      const next = { ...state, acceptedEdits, aggregates, undoStack, redoStack, expandedRegions, expandedTerritories };
      const flatView = recomputeFlatView(next);
      setState({
        ...next,
        flatView,
        lastOpLabel: "undo",
        lastOpMs: performance.now() - start,
        scrollToRowIndex: command.rowIndex,
        flashRowIndex: command.rowIndex,
      });
    },

    redo: () => {
      const state = getState();
      const command = state.redoStack[state.redoStack.length - 1];
      if (!command) return;
      const start = performance.now();

      const row = state.rawRows[command.rowIndex];
      const acceptedEdits = new Map(state.acceptedEdits);
      acceptedEdits.set(command.rowIndex, {
        value: command.newValue,
        previousValue: command.previousValue,
        acceptedAt: Date.now(),
      });

      const delta = command.newValue - command.previousValue;
      const aggregates = applyCallsDelta(state.aggregates, row, state.filterResult, command.rowIndex, delta);

      const { expandedRegions, expandedTerritories } = ensureExpanded(state, row.region, row.territory);

      const redoStack = state.redoStack.slice(0, -1);
      const undoStack = [...state.undoStack, command];

      const next = { ...state, acceptedEdits, aggregates, undoStack, redoStack, expandedRegions, expandedTerritories };
      const flatView = recomputeFlatView(next);
      setState({
        ...next,
        flatView,
        lastOpLabel: "redo",
        lastOpMs: performance.now() - start,
        scrollToRowIndex: command.rowIndex,
        flashRowIndex: command.rowIndex,
      });
    },

    consumeScrollSignal: () => {
      setState({ scrollToRowIndex: null });
    },

    clearFlash: () => {
      setState({ flashRowIndex: null });
    },
  };
});

function ensureExpanded(
  state: Pick<GridState, "expandedRegions" | "expandedTerritories">,
  region: string,
  territory: string
): { expandedRegions: Set<string>; expandedTerritories: Set<string> } {
  const key = `${region}||${territory}`;
  const expandedRegions = state.expandedRegions.has(region)
    ? state.expandedRegions
    : new Set(state.expandedRegions).add(region);
  const expandedTerritories = state.expandedTerritories.has(key)
    ? state.expandedTerritories
    : new Set(state.expandedTerritories).add(key);
  return { expandedRegions, expandedTerritories };
}
