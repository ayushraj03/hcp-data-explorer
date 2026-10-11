# HCP Data Explorer

A virtualized, groupable, async-editable data grid over 50,000 healthcare-
provider records. React 18+ (React 19 via the Vite template) + TypeScript,
no backend, no network calls — see `ASSUMPTIONS.md` for every data-quality
issue found in the seed data and every ambiguity resolved along the way.

## Quick start

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest, 47 tests
npm run build   # typecheck + production build
```

Switch tenants via the dropdown in the toolbar, or `?tenant=aurelia` /
`?tenant=meridian` in the URL.

## Table of contents

- [Architecture overview](#architecture-overview)
- [State model](#state-model)
- [Virtualization approach](#virtualization-approach)
- [Performance strategy](#performance-strategy)
- [Edit lifecycle & concurrency (FR-4)](#edit-lifecycle--concurrency-fr-4)
- [FR-5 design: bulk edit with partial failure](#fr-5-design-bulk-edit-with-partial-failure)
- [FR-6 design: undo at scale](#fr-6-design-undo-at-scale)
- [CPI (FR-7)](#cpi-fr-7)
- [Runtime white-labelling (FR-8)](#runtime-white-labelling-fr-8)
- [Testing](#testing)
- [Scope, descopes, and what I'd do differently](#scope-descopes-and-what-id-do-differently)
- [Time spent](#time-spent)

## Architecture overview

```
src/
  data/             data-generator.ts, mock-validator.ts   (provided, verbatim)
  theme/            theme-config.ts (provided), validateTheme, ThemeProvider, ThemeSwitcher
  engine/           pure functions: values, sort, filter, aggregates, groupIndex, flatView, exportDiff
  store/            useGridStore.ts (zustand) + types.ts — the single source of truth
  components/
    Grid/           VirtualGrid, ColumnHeaderRow, GroupHeaderRow, DataRow, EditableCallsCell
    Toolbar/        SearchInput, RegionFilter, Toolbar
    Footer.tsx
```

**The `engine/` directory is deliberately pure** — no React, no store
imports in the other direction. Every piece of "hard" logic (sort
semantics, aggregate math, filtering, group assembly) is a plain function of
plain data, independently unit-tested without touching React or Zustand.
The store's job is only to hold state and call these functions at the right
moments; components' job is only to render store state and dispatch store
actions. This separation is what made the 47-test suite possible without
any DOM rendering for most of it.

### Build-vs-buy decisions

**No grid library (AG Grid / MUI DataGrid / etc.).** I considered this
seriously — AG Grid in particular has row grouping, virtualization, and
editing built in. I didn't use it because the spec's hardest requirements
are exactly the ones a grid library tends to own and resist overriding:
async per-cell validation with a three-state lifecycle, aggregates that must
*exclude* in-flight edits, group aggregates recomputed incrementally rather
than from scratch, and undo as an explicit command history rather than the
library's own edit-tracking. Getting AG Grid's `valueSetter`/async
validation/grouping aggregation hooks to produce *this exact* behavior would
have meant fighting the library's model as much as building on it, and the
result would be harder to reason about ("why does it do X" → "because
AG Grid does X by default, and I patched around it") — exactly the failure
mode the brief calls out ("the library does it that way" is not an accepted
justification). Hand-rolling the grouping/sort/filter/aggregate engine is
~400 lines of pure, independently-testable TypeScript (`src/engine/`); that
felt like the right trade for a codebase whose whole point is owning this
behavior precisely.

**`@tanstack/react-virtual` for virtualization**, not a hand-rolled
windower. Virtualizing a *flat* list of fixed-height rows is a solved,
narrow problem (compute visible range from scroll offset + row heights,
render only that slice, absolutely position each row). `react-virtual` does
exactly that and nothing more — it has no opinion about grouping, sorting,
editing, or data shape, so none of those remain "library concerns." I treat
it as a primitive, not a grid solution: my code still owns the entire flat
list it virtualizes (`buildFlatView()`), including which rows are group
headers vs. data rows and what order they're in. Hand-rolling this specific
piece (binary-search the scroll offset into row heights, maintain an
overscan window) is a well-understood ~100 line exercise I could have taken
on, but it wouldn't have demonstrated anything the rest of the codebase
doesn't already — the interesting, spec-mandated complexity is in
`engine/`, not in the windowing math. I'd call hand-rolling this a
reasonable bonus with time left over, not a differentiator worth the risk
here.

**Zustand** for the store, over Redux/plain Context/`useReducer`. The
requirements (undo as command history, O(1) incremental aggregate updates,
async edit lifecycle, derived view state) all point at one coherent state
machine rather than multiple `useState` islands — but they don't need
Redux's middleware/devtools machinery. Zustand gives a single store with
selector-based subscriptions (`useGridStore(s => s.acceptedEdits.get(i))`)
so a component only re-renders when the *slice it actually reads* changes
by reference — critical at 50k rows, where an unrelated row's pending-edit
resolving must not re-render every other row. Plain Context would force
either one giant context (everything re-renders on every change) or a maze
of split contexts; `useReducer` alone doesn't give the ergonomic
selector-based subscriptions without extra wiring. See "State Management"
below for the row-identity decision this all hinges on.

## State model

### Row identity: array index, not `id`

The generator seeds duplicate `id`s (`rows[i].id = rows[i-1].id` every 9973
rows — see `ASSUMPTIONS.md`). Every piece of app state that references "a
row" — `acceptedEdits`, `pendingEdits`, `rejectedFlash`, undo/redo
commands, scroll/flash targets — is keyed by **`RowIndex` (the row's
position in the array `generateRows()` returns)**, never by `id`. The
generator is deterministic and the raw array is never mutated or reordered
(only *views* — arrays of indices — are reordered), so the index is stable
for the app's lifetime. This is the one decision everything else in the
state model follows from.

### The store (`useGridStore.ts`)

```ts
rawRows: HcpRecord[]              // immutable, generated once
groupIndex: GroupIndex            // static Region→Territory→RowIndex[], built once

search: string                    // debounced, committed value (not every keystroke)
regionFilter: string
sort: { column, direction }
expandedRegions: Set<string>
expandedTerritories: Set<string>  // "Region||Territory"

acceptedEdits: Map<RowIndex, { value, previousValue, acceptedAt }>
pendingEdits:  Map<RowIndex, { value, previousValue, requestId, startedAt }>
rejectedFlash: Map<RowIndex, { reason, attemptedValue, revertedTo, at }>

undoStack: EditCommand[]          // only *accepted* edits ever land here
redoStack: EditCommand[]

filterResult: FilterResult        // derived, recomputed by actions (not components)
aggregates: AggregateStore        // derived, recomputed/incrementally-updated by actions
flatView: FlatViewItem[]          // derived, recomputed by actions — what the grid renders

lastOpLabel / lastOpMs            // footer instrumentation
scrollToRowIndex / flashRowIndex  // one-shot signals for undo/redo "scroll into view"
```

`filterResult`, `aggregates`, and `flatView` are **derived state that lives
in the store, recomputed by the actions that can affect them** — not
`useMemo` in a component. This is deliberate: it's what lets an accepted
edit update aggregates in O(1) (see below) instead of recomputing from
scratch, which a component-level `useMemo` keyed on "the edits map changed"
could not distinguish from "rebuild everything."

Why not persist the *flat view's children* (the fully rendered list)
directly? Because sort/filter/grouping are cheap to redescribe from
`rawRows` + `groupIndex` + small derived maps, but expensive to keep
manually synchronized if expressed as mutable rendered state. Keeping
`rawRows` as the one immutable source of truth, with everything else as a
pure function of it plus small, independently-changing inputs, is what
makes "aggregates don't recompute 50k rows on every keystroke" achievable
without manual cache invalidation bugs.

### Event flow, start to finish

```
user types in search box
  → SearchInput (local state, instant) --debounce 150ms--> store.setSearch()
      → computeFilter() [O(n) over 50k rows]
      → buildAggregates() [O(n), only over the NEW filtered set]
      → buildFlatView() [O(territories) + O(rows in expanded groups)]
      → one Zustand setState → selectors re-render only what changed

user commits a Calls edit (Enter/blur)
  → EditableCallsCell → store.commitEdit(rowIndex, value)
      → pendingEdits.set(rowIndex, …)  [cell flips to "pending", locked]
      → validateCalls(value)  [300-900ms, black box]
      → on resolve: acceptedEdits.set(...), applyCallsDelta() [O(1)],
        undoStack.push(command), buildFlatView() [only if sort/grouping
        depends on calls/cpi — otherwise this is still called but is cheap]
      → on reject: rejectedFlash.set(rowIndex, { reason, revertedTo })
```

## Virtualization approach

`buildFlatView()` (`src/engine/flatView.ts`) produces a single flat array
mixing three item kinds — `{type:'region'}`, `{type:'territory'}`,
`{type:'row', rowIndex}` — in final display order, honoring expand/collapse,
the active filter, and the active sort. `VirtualGrid.tsx` hands this array's
`.length` to `useVirtualizer({ count, estimateSize, overscan: 12 })` and
renders only the rows the virtualizer says are in range, each absolutely
positioned via `transform: translateY(...)`. Row heights are fixed per item
type (36px data rows, 36/42px group headers) so `estimateSize` is exact, not
a guess — no `measureElement` remeasure pass needed.

The footer's "rows in DOM: N of M" is the actual count of DOM nodes the
virtualizer currently renders (via `getVirtualItems().length`, lifted up
through a callback prop), not a theoretical number — at a typical viewport
this sits around 25-35 rows regardless of whether 50,000 or 6 rows are in
the current `flatView`.

## Performance strategy

Four separate techniques, each targeting a specific "don't do this" pitfall
from the brief:

1. **Search is debounced (150ms) in the component**, not the store — the
   store's `search` field (and therefore the expensive filter/aggregate/
   flat-view rebuild) only changes after the user pauses typing. Keystrokes
   themselves never touch the 50k-row recompute path.

2. **Pending edits never trigger a recompute.** `flatView`'s dependencies
   are `rawRows`, `groupIndex`, `filterResult`, `aggregates`,
   `acceptedEdits`, `sort`, and expand/collapse state — `pendingEdits` and
   `rejectedFlash` are not in that list. A cell entering/leaving the
   "pending" (spinner) or "rejected" (flash) state re-renders *only that
   cell* (via a `useGridStore(s => s.pendingEdits.get(rowIndex))` selector,
   which Zustand compares by reference — untouched rows' map entries keep
   the same object identity across a `Map` copy, so `Object.is` correctly
   skips them). The 50k-row structures are untouched until the edit is
   actually **accepted**.

3. **Aggregates update in O(1) per accepted edit, not O(n).**
   `applyCallsDelta()` (`src/engine/aggregates.ts`) adjusts exactly the
   affected territory's and region's `sumCalls` by the edit's delta,
   immutably. A full `buildAggregates()` rescan only happens on the
   comparatively rare events that actually change *which rows count*: the
   initial load and a search/region-filter change. An accepted edit — even
   though it's "just" one row out of 50,000 — never triggers an O(n) pass.
   This is covered by `aggregates.test.ts`.

4. **Zustand selector subscriptions** keep re-renders scoped to the slice a
   component actually reads. `Toolbar` re-renders on undo/redo/pending-count
   changes but not on scroll; a `DataRow` re-renders on its own accepted-
   edit/flash state but not on a sibling row's. This matters more than usual
   here because `VirtualGrid` itself re-renders on every `flatView` change
   (unavoidable — it owns the list), so keeping the ~30 visible `DataRow`/
   `EditableCallsCell` instances cheap and independently-memoized is what
   keeps scrolling smooth.

The footer's "last op" timing (`lastOpLabel` / `lastOpMs`, measured with
`performance.now()` around each store action) is there specifically so this
isn't a claim without a receipt — `sort`/`search`/`filter`/`edit-accepted`/
`undo` all report their own wall-clock cost live in the UI.

## Edit lifecycle & concurrency (FR-4)

```
idle --click--> editing --Enter/blur--> [commitEdit]
                   |                         |
                Esc/blur-unchanged        pendingEdits.set(...)
                   |                         |
                   v                         v
                 idle                     pending (locked, spinner,
                                           excluded from aggregates)
                                              |
                                validateCalls() settles
                                   /                    \
                              resolve                  reject
                                 |                         |
                      acceptedEdits.set(...)    rejectedFlash.set(...)
                      aggregate delta (O(1))    (reverts to previous value,
                      undoStack.push(command)    shows reason, auto-clears
                      "saved" flash (1.2s)        after 6s or on retry)
```

- **Locked while pending** (documented in `ASSUMPTIONS.md`): a second
  commit attempt on a row that's still awaiting its validator response is a
  no-op, enforced in both the UI (a pending cell doesn't render as
  clickable/editable) and defensively in the store action itself.
- **Undo/redo is a command stack, not snapshots.** Each accepted edit
  pushes `{ rowIndex, previousValue, newValue, timestamp }`; undo/redo
  apply/reverse exactly that delta against `acceptedEdits` and the
  aggregate store — there is no "restore the whole row/table to how it
  looked at time T" snapshot anywhere. This is what makes undo correctness
  independent of the current sort/filter/grouping: it operates on
  `RowIndex` + a value delta, never on "the 4th visible row."
- **Undo on a filtered-out or collapsed-group row still works** (tested in
  `useGridStore.test.ts`) and additionally auto-expands the row's
  region/territory and scrolls/flashes it into view, so the user can see
  what just happened even if it wasn't currently visible.
- **Redo never re-validates** — see `ASSUMPTIONS.md` for the reasoning, and
  the FR-6 section below for how this extends to bulk operations.

## FR-5 design: bulk edit with partial failure

*Design only — not implemented in code; see "Scope" for why.*

### Selection

Add `selectedRows: Set<RowIndex>` to the store. A checkbox column lets rows
be selected individually; a checkbox in each **territory** header selects/
deselects every row in that territory *that currently passes the active
filter* (not rows hidden by search/region filter — "select what you can
see"), with the usual indeterminate state when some-but-not-all are
selected. Selection is keyed by `RowIndex`, so — consistent with
everything else — it survives sort/filter/grouping changes untouched. A row
that becomes filtered out stays selected but isn't visually indicated; this
mirrors ordinary multi-select UX (e.g. a spreadsheet, an email client) and
avoids silently losing someone's selection because they adjusted a filter
mid-task.

### Launching the operation

Clicking "+10% Calls" with a non-empty selection:

1. Snapshots the target set: every selected `RowIndex` **except** rows
   already locked by an unrelated in-flight edit (single or bulk — the same
   per-row lock from FR-4 applies uniformly) and rows where
   `round(effectiveValue * 1.1) === effectiveValue` (a true no-op, e.g.
   `calls = 0`) — these are silently excluded from the attempt, not counted
   as rejections (nothing was ever asked of the validator for them).
2. Creates a `BulkOperation` record:
   ```ts
   interface BulkOperation {
     id: string;
     kind: "percent-increase";
     percent: number;                 // 10
     rowIndices: RowIndex[];          // the snapshot from step 1
     results: Map<RowIndex, "pending" | { outcome: "accepted"; previousValue: number; newValue: number }
                                       | { outcome: "rejected"; reason: string }>;
     startedAt: number;
   }
   ```
3. For **every** row in `rowIndices`, *immediately and synchronously*: marks
   it `pendingEdits` (reusing the exact single-edit pending shape, tagged
   with `bulkOpId`) and fires `validateCalls(newValue)` — all N calls launch
   in the same tick, genuinely concurrent, not queued one-after-another.
4. The store tracks **multiple concurrent `BulkOperation`s** in
   `activeBulkOps: Map<string, BulkOperation>`, not a single "is a bulk
   op running" flag — concurrency is still governed entirely by the
   per-row lock, so two *disjoint* bulk operations (or a bulk op and an
   unrelated single edit) can be in flight at once without conflict. This
   falls out of the architecture for free: nothing about FR-5 needs a
   global "busy" flag once per-row locking already exists.

### As each row settles (independently, in arbitrary order)

Each row's own cell transitions exactly like a single-cell edit — pending →
accepted (value updates, aggregate delta applied, "saved" flash) or pending
→ rejected (reverts, shows its own reason) — so the per-row visuals the
user already understands from FR-4 apply unchanged. In parallel, the
outcome is recorded into that `BulkOperation`'s `results` map, and a
toolbar progress chip shows live counts ("7 of 11 settled…").

### Finalizing: exactly one undo step

Once every row in `rowIndices` has settled:

1. Build the **accepted subset only** into a single command:
   ```ts
   interface BulkEditCommand {
     type: "bulk-edit-calls";
     bulkOpId: string;
     percent: number;
     entries: Array<{ rowIndex: RowIndex; previousValue: number; newValue: number }>;
     timestamp: number;
   }
   ```
2. Push **this one object** onto `undoStack` (not one push per row) —
   directly satisfying "the applied subset must form exactly one undo
   step." If the accepted subset is empty (everything rejected), **nothing
   is pushed** — there's nothing to undo.
3. Clear `activeBulkOps[bulkOpId]`.
4. Surface a dismissible summary banner: **"8 applied, 2 rejected, 1
   skipped"** (skipped = excluded in step 1, e.g. already locked), with an
   expandable per-row breakdown of rejection reasons (grouped/counted where
   reasons repeat, e.g. "2× exceeds per-HCP call cap (60)").

### Undo/redo of the bulk command

`undo()` on a `BulkEditCommand` reverts every entry in one pass: for each
`{rowIndex, previousValue}`, apply the same "restore to previousValue, or
remove the override entirely if that equals the original source value"
rule used for single edits — but compute all the territory/region aggregate
deltas together and apply them as **one** aggregate-store update (not N
sequential ones), since they're all happening as a result of one user
action. It auto-expands every affected region/territory, and scrolls to the
row with the lowest `RowIndex` among the entries (a single, deterministic
scroll target even though many rows changed) with a toast noting the full
scope ("Reverted 8 edits across 3 territories"). The whole revert is one
`redoStack` push, symmetric with the one `undoStack` pop.

**Redo never re-validates — and for a bulk command this is provably safe**,
not just a convenience: `entries` only ever contains rows that *already
passed* validation once (rejected rows were never included). So redoing a
bulk command can never itself produce a new partial failure; it's always
total.

## FR-6 design: undo at scale

*Design only — not implemented in code.* This section directly answers the
four hard cases the spec names.

**1. Applied subset of a partially-failed bulk op as one undo step** — this
*is* the `BulkEditCommand` design above: the command's `entries` field *is*
the applied subset, by construction (rejected/skipped rows are never added
to it), so "exactly one step" isn't an extra rule layered on top — it falls
directly out of "there's one command object pushed per bulk operation,
containing only what succeeded."

**2. Undoing a change in a collapsed group** — implemented today for
single-cell undo (`ensureExpanded()` + `scrollToRowIndex` + `flashRowIndex`
in `useGridStore.ts`, covered by `useGridStore.test.ts`'s "undo works
correctly against a row that is currently filtered out of view" case). For
a *bulk* undo touching rows across multiple territories/regions, there's no
single "the" group to expand — the design above expands **all** affected
groups but scrolls/flashes only the lowest-`RowIndex` row, with the summary
toast making the full scope legible without requiring N scroll animations.

**3. Whether redo re-validates** — no, for both single and bulk commands
(see FR-4 and FR-5 above). The unifying principle: undo/redo is *replaying
the user's own already-approved history*, not re-submitting a business
transaction. The validator is a gate on *new* values entering the system,
not on values leaving and re-entering the undo stack.

**4. Affected row excluded by the current search/filter** — handled
uniformly, with no bulk-specific logic needed. Each entry's data-layer
revert (`acceptedEdits` update) always applies, unconditionally — the data
model has no concept of "filtered," only the aggregate/view layer does. The
*aggregate* delta for a given entry only applies if that row currently
passes `filterResult.mask` **at the moment of the undo** (which can differ
from the filter that was active when the original bulk op ran — e.g. the
user changed the region filter in between). This is exactly
`applyCallsDelta`'s existing filter-mask check, applied once per entry; a
bulk undo is simply N independent applications of a rule that already has
to exist for the single-edit case. Concretely: undoing a bulk op fully
reverts the underlying data for every entry regardless of what's currently
filtered, but only visibly moves the footer/aggregate numbers for the
entries that are presently in view.

### State shape (consolidated)

```ts
type Command = SingleEditCommand | BulkEditCommand; // discriminated by `type`
undoStack: Command[];
redoStack: Command[];
activeBulkOps: Map<string, BulkOperation>;
selectedRows: Set<RowIndex>;
```

Both command kinds funnel through one shared per-row "revert/reapply a
Calls value" primitive (the same logic `undo()`/`redo()` already use for
`SingleEditCommand` in the current code) so there is exactly one place that
knows how to answer "does reverting this value mean deleting the
override or setting it to something" — a bulk undo is not a parallel
implementation, it's N calls to that same primitive plus one batched
aggregate update and one combined scroll/toast.

## CPI (FR-7)

`CPI = Calls ÷ TRx × 100`, computed identically at row and group level —
`computeCpi(calls, trx)` returns `number | undefined`, never `NaN`/
`Infinity`. Group-level CPI uses **`Σ Calls ÷ Σ TRx × 100`** ("ratio of
sums"), not an average of each row's CPI — see `ASSUMPTIONS.md` for why
that's the correct aggregation for a rate metric. `formatCpi()` renders
`undefined` as `—`; a real `0` (e.g. `calls=0, trx=200`) renders as `0`,
deliberately distinct from "undefined."

## Runtime white-labelling (FR-8)

`resolveTheme()` (`src/theme/validateTheme.ts`) validates **every field
independently** against `DEFAULT_THEME` — a bad hex color, an out-of-range
or non-numeric `radius`, or a missing field never discards the rest of a
tenant's config; each bad field just falls back on its own
(`theme-config.ts`'s `meridian` entry ships exactly this: an invalid
`primary` and a non-numeric `radius`, alongside otherwise-valid fields, and
`validateTheme.test.ts` asserts the good fields are honored while the bad
ones fall back). Access to the config object itself is wrapped
defensively, so even a config that throws on property access can't crash
rendering. The resolved theme is applied as CSS custom properties
(`--color-primary`, `--radius`, etc.) on `document.documentElement`, so any
component can consume it without prop-drilling, and switching tenants (via
the toolbar dropdown or `?tenant=` in the URL) re-applies them instantly —
no rebuild, no reload.

**Edit-lifecycle colors (pending/rejected/saved) are deliberately *not*
part of the themeable palette.** They're a separate, fixed semantic layer
(`--state-pending-*`, `--state-rejected-*`, `--state-saved-*` in
`index.css`) with contrast chosen independently of any tenant's brand
colors. A tenant's `primary` could in principle be red — if "rejected" were
themed from the same palette, that would be actively misleading. Keeping
validation feedback on a fixed channel is what the spec's "edited-cell
states must remain clearly distinguishable under every provided theme"
requirement is actually asking for, and it's the one thing in the whole
app I chose to make *not* configurable.

## Testing

```bash
npm test
```

47 tests across 6 files:

- `engine/values.test.ts`, `sort.test.ts`, `filter.test.ts`,
  `aggregates.test.ts` — pure-function unit tests for coercion, CPI,
  null-handling, stability, incremental aggregate deltas. No React, no
  store, no timers.
- `theme/validateTheme.test.ts` — per-field fallback, including against the
  actual malformed `meridian` config from the provided `theme-config.ts`.
- `store/useGridStore.test.ts` — the integration suite, covering:
  - **Edit lifecycle**: pending excluded from aggregates → accepted updates
    value + O(1) aggregate delta + undo stack; rejection reverts and
    surfaces the reason; a cell locked while pending refuses a second
    commit (and never calls the validator a second time).
  - **Race / partial-failure scenario** (required minimum): two
    *independent* rows committed concurrently, resolved **out of order**
    (the later commit resolves first) — asserts each row's own value lands
    correctly with no cross-contamination; a second test resolves one row's
    promise and rejects the other's concurrently, asserting the accepted
    row updates while the rejected one reverts, fully independently.
  - **Undo/redo**: reverts/reapplies value + aggregate; confirms redo never
    re-calls the validator; confirms undo of a row currently excluded by
    the active filter still updates the data layer and signals a scroll.

The validator is mocked via `vi.mock` with a hand-rolled `deferred()`
helper (resolve/reject controlled explicitly by each test), rather than
fake timers — this makes "B resolves before A" and "A accepts while B
rejects, concurrently" directly expressible and fully deterministic,
without racing real `setTimeout`s or fighting fake-timer/promise
interleaving. The brief explicitly allows mocking the validator in tests;
this is that.

## Scope, descopes, and what I'd do differently

**Implemented in code:** FR-1 (virtualized grid + footer), FR-2 (two-level
grouping with live, incrementally-updated aggregates), FR-3 (three-state
sort incl. group reordering by aggregate, debounced search, region filter,
documented null-handling), FR-4 (full async edit lifecycle + command-based
undo/redo, incl. collapsed-group scroll-into-view), FR-7 (CPI), FR-8
(runtime theming with per-field validation). Bonus: JSON change-set export
with no-op dedup, performance instrumentation surfaced live in the footer.

**Design-only, as the spec allows:** FR-5 and FR-6, written up in full
above (state shape, event flow, all four FR-6 edge cases named in the
spec). I chose to spend the available time making FR-1-4/7/8 and their test
coverage solid rather than racing to also implement FR-5/6 shallowly —
partial-failure bulk editing done *badly* (e.g., not actually achieving
"exactly one undo step," or silently losing the independent-concurrency
property) would have been worse than a complete design plus a correctly-
scoped admission that it's not built. The design reuses the same primitives
(per-row locking, the single-edit revert logic, `RowIndex` identity) the
implemented code already has, specifically so it would be a continuation of
the existing architecture rather than a parallel one if built next.

**Not attempted:**
- Hand-rolled virtualization (used `@tanstack/react-virtual` instead — see
  "Build-vs-buy" above for the reasoning).
- Full keyboard navigation (arrow keys between cells, F2 to edit). Today:
  click-to-edit, Enter to commit, Esc to cancel, global Ctrl+Z/Ctrl+Shift+Z
  for undo/redo (suppressed while an input has focus, so native text-field
  undo isn't hijacked). Arrow-key cell navigation across the virtualized
  grid is a reasonable next step but didn't fit in the time available
  alongside getting the edit/undo semantics and their tests right.
- Column pinning / a third grouping level. The `engine/` layer (group
  index, flat-view builder, aggregate store) generalizes to a third level
  without a rewrite — `GroupIndex` would need one more nesting level and
  `buildFlatView` one more loop — but I didn't want to add surface area
  that reduces confidence in the two levels actually required.
- Selection UI (checkboxes) — only built where FR-5 needed it on paper; no
  code, since FR-5 itself is design-only.

## Time spent

Roughly a full day of focused work: project setup and the `engine/` pure
functions first (fastest to get right in isolation), then the store, then
components, then a CSS flex-sizing bug I caught by actually launching the
app in a browser and screenshotting it rather than trusting the build to
typecheck+lint, then the test suite, then these docs. The flex/virtualizer
height bug (a child's inherited `height: 100%` resolving against the whole
grid instead of its own absolutely-positioned wrapper, collapsing the
scrollable area to zero) is exactly the kind of thing that passes
`tsc`/`lint`/`vitest` cleanly while rendering nothing — worth noting
because it's the reason I verified visually before calling anything done.
