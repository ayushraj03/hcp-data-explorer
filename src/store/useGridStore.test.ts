import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGridStore } from "./useGridStore";

// The real validator has real network-like latency (300-900ms) and random
// failures — fine for the running app, unusable for deterministic tests.
// We mock it and control resolution/rejection by hand per test, which is
// exactly what the assignment calls out as expected ("mocking, stubbing...
// is expected and does not violate the black-box rule").
vi.mock("../data/mock-validator", () => ({
  validateCalls: vi.fn(),
}));

import { validateCalls } from "../data/mock-validator";

interface Deferred {
  resolve: () => void;
  reject: (reason: string) => void;
}

function deferred(): [Promise<void>, Deferred] {
  let resolve!: () => void;
  let reject!: (reason: string) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return [promise, { resolve, reject }];
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

// The store is a module-level singleton (zustand's `create` runs the
// generator + initial aggregates once at import time). We snapshot it
// once and restore between tests instead of re-importing the module.
const initialSnapshot = useGridStore.getState();

beforeEach(() => {
  useGridStore.setState(initialSnapshot, true);
  vi.mocked(validateCalls).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("edit lifecycle (FR-4)", () => {
  it("goes pending immediately on commit, excluded from aggregates, then accepted updates value + aggregates + undo stack", async () => {
    const [promise, ctrl] = deferred();
    vi.mocked(validateCalls).mockReturnValue(promise);

    const rowIndex = 0;
    const row = useGridStore.getState().rawRows[rowIndex];
    const originalCalls = Number(row.calls);
    const territoryKey = `${row.region}||${row.territory}`;
    const aggBefore = useGridStore.getState().aggregates.byTerritory.get(territoryKey)!.sumCalls;

    useGridStore.getState().commitEdit(rowIndex, originalCalls + 11);

    // pending: locked, and NOT yet reflected in aggregates
    let s = useGridStore.getState();
    expect(s.pendingEdits.get(rowIndex)?.value).toBe(originalCalls + 11);
    expect(s.acceptedEdits.has(rowIndex)).toBe(false);
    expect(s.aggregates.byTerritory.get(territoryKey)!.sumCalls).toBe(aggBefore);

    ctrl.resolve();
    await flush();

    s = useGridStore.getState();
    expect(s.pendingEdits.has(rowIndex)).toBe(false);
    expect(s.acceptedEdits.get(rowIndex)?.value).toBe(originalCalls + 11);
    expect(s.aggregates.byTerritory.get(territoryKey)!.sumCalls).toBe(aggBefore + 11);
    expect(s.undoStack).toHaveLength(1);
    expect(s.undoStack[0]).toMatchObject({ rowIndex, previousValue: originalCalls, newValue: originalCalls + 11 });
  });

  it("reverts and surfaces the rejection reason when the validator rejects", async () => {
    const [promise, ctrl] = deferred();
    vi.mocked(validateCalls).mockReturnValue(promise);

    const rowIndex = 1;
    const row = useGridStore.getState().rawRows[rowIndex];
    const originalCalls = Number(row.calls);

    useGridStore.getState().commitEdit(rowIndex, 999);
    ctrl.reject("exceeds per-HCP call cap (60)");
    await flush();

    const s = useGridStore.getState();
    expect(s.pendingEdits.has(rowIndex)).toBe(false);
    expect(s.acceptedEdits.has(rowIndex)).toBe(false); // never accepted
    expect(s.rejectedFlash.get(rowIndex)).toMatchObject({
      reason: "exceeds per-HCP call cap (60)",
      attemptedValue: 999,
      revertedTo: originalCalls,
    });
    expect(s.undoStack).toHaveLength(0); // rejections never enter undo history
  });

  it("locks the cell while a commit is in flight: a second commit on the same row is a no-op", async () => {
    const [promise] = deferred();
    vi.mocked(validateCalls).mockReturnValue(promise);

    const rowIndex = 2;
    const row = useGridStore.getState().rawRows[rowIndex];
    const originalCalls = Number(row.calls);

    useGridStore.getState().commitEdit(rowIndex, originalCalls + 5);
    expect(vi.mocked(validateCalls)).toHaveBeenCalledTimes(1);

    // Attempting a second commit while the first is still pending must not
    // issue a second validator call or clobber the in-flight request.
    useGridStore.getState().commitEdit(rowIndex, originalCalls + 20);
    expect(vi.mocked(validateCalls)).toHaveBeenCalledTimes(1);
    expect(useGridStore.getState().pendingEdits.get(rowIndex)?.value).toBe(originalCalls + 5);
  });
});

describe("concurrency / no cross-contamination (race scenario)", () => {
  it("resolves two independent in-flight edits on different rows correctly regardless of completion order", async () => {
    const [promiseA, ctrlA] = deferred();
    const [promiseB, ctrlB] = deferred();
    vi.mocked(validateCalls).mockReturnValueOnce(promiseA).mockReturnValueOnce(promiseB);

    const rowA = 10;
    const rowB = 20;
    const rawRows = useGridStore.getState().rawRows;
    const originalA = Number(rawRows[rowA].calls);
    const originalB = Number(rawRows[rowB].calls);

    useGridStore.getState().commitEdit(rowA, originalA + 1);
    useGridStore.getState().commitEdit(rowB, originalB + 2);

    expect(useGridStore.getState().pendingEdits.size).toBe(2);

    // B resolves first even though A was committed first — simulates
    // out-of-order network responses.
    ctrlB.resolve();
    await flush();

    let s = useGridStore.getState();
    expect(s.acceptedEdits.get(rowB)?.value).toBe(originalB + 2);
    expect(s.acceptedEdits.has(rowA)).toBe(false); // still pending, untouched
    expect(s.pendingEdits.get(rowA)?.value).toBe(originalA + 1); // A's own value, not B's

    ctrlA.resolve();
    await flush();

    s = useGridStore.getState();
    expect(s.acceptedEdits.get(rowA)?.value).toBe(originalA + 1);
    expect(s.acceptedEdits.get(rowB)?.value).toBe(originalB + 2); // unaffected by A resolving later
    expect(s.pendingEdits.size).toBe(0);
    expect(s.undoStack).toHaveLength(2);
  });

  it("partial failure: one row's commit accepts while a concurrent row's rejects, independently", async () => {
    const [promiseA, ctrlA] = deferred();
    const [promiseB, ctrlB] = deferred();
    vi.mocked(validateCalls).mockReturnValueOnce(promiseA).mockReturnValueOnce(promiseB);

    const rowA = 30;
    const rowB = 31;
    const rawRows = useGridStore.getState().rawRows;
    const originalA = Number(rawRows[rowA].calls);
    const originalB = Number(rawRows[rowB].calls);

    useGridStore.getState().commitEdit(rowA, originalA + 3);
    useGridStore.getState().commitEdit(rowB, originalB + 4);

    ctrlA.resolve();
    ctrlB.reject("validation service 503 (simulated)");
    await flush();

    const s = useGridStore.getState();
    expect(s.acceptedEdits.get(rowA)?.value).toBe(originalA + 3);
    expect(s.acceptedEdits.has(rowB)).toBe(false);
    expect(s.rejectedFlash.get(rowB)?.reason).toBe("validation service 503 (simulated)");
    expect(s.rejectedFlash.has(rowA)).toBe(false);
    expect(s.undoStack).toHaveLength(1); // only the accepted row produced a command
  });
});

describe("undo/redo (FR-4 command history)", () => {
  it("undo reverts the value and the aggregate delta; redo re-applies both without re-validating", async () => {
    const [promise, ctrl] = deferred();
    vi.mocked(validateCalls).mockReturnValue(promise);

    const rowIndex = 40;
    const row = useGridStore.getState().rawRows[rowIndex];
    const originalCalls = Number(row.calls);
    const territoryKey = `${row.region}||${row.territory}`;
    const aggBefore = useGridStore.getState().aggregates.byTerritory.get(territoryKey)!.sumCalls;

    useGridStore.getState().commitEdit(rowIndex, originalCalls + 9);
    ctrl.resolve();
    await flush();

    expect(useGridStore.getState().aggregates.byTerritory.get(territoryKey)!.sumCalls).toBe(aggBefore + 9);

    useGridStore.getState().undo();
    let s = useGridStore.getState();
    expect(s.acceptedEdits.has(rowIndex)).toBe(false); // reverted all the way to source value -> override removed
    expect(s.aggregates.byTerritory.get(territoryKey)!.sumCalls).toBe(aggBefore);
    expect(s.undoStack).toHaveLength(0);
    expect(s.redoStack).toHaveLength(1);

    const callsBeforeRedo = vi.mocked(validateCalls).mock.calls.length;
    useGridStore.getState().redo();
    s = useGridStore.getState();
    expect(s.acceptedEdits.get(rowIndex)?.value).toBe(originalCalls + 9);
    expect(s.aggregates.byTerritory.get(territoryKey)!.sumCalls).toBe(aggBefore + 9);
    expect(vi.mocked(validateCalls).mock.calls.length).toBe(callsBeforeRedo); // redo does not re-call the validator
  });

  it("undo works correctly against a row that is currently filtered out of view", async () => {
    const [promise, ctrl] = deferred();
    vi.mocked(validateCalls).mockReturnValue(promise);

    const rowIndex = 50;
    const row = useGridStore.getState().rawRows[rowIndex];
    const originalCalls = Number(row.calls);

    useGridStore.getState().commitEdit(rowIndex, originalCalls + 6);
    ctrl.resolve();
    await flush();

    // Filter the row out of view (pick any region other than its own)
    const otherRegion = useGridStore.getState().groupIndex.regionOrder.find((r) => r !== row.region)!;
    useGridStore.getState().setRegionFilter(otherRegion);
    expect(useGridStore.getState().filterResult.mask[rowIndex]).toBe(0);

    // Undo must still operate correctly via rowIndex identity, independent of the view.
    useGridStore.getState().undo();
    const s = useGridStore.getState();
    expect(s.acceptedEdits.has(rowIndex)).toBe(false);
    expect(s.scrollToRowIndex).toBe(rowIndex); // signals the grid to expand + scroll to it
  });
});
