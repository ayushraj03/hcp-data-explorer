# Assumptions & Data-Quality Decisions

This file documents every data-quality issue found in `generateRows()`, how
it's handled (rendering / sorting / aggregation / edit identity), and every
ambiguity in the spec that I resolved on my own judgment. Nothing here is
sanitized silently — the goal was to make each issue visible and each
decision explicit, per the brief.

## Data-quality issues found in the generator

The generator seeds five distinct issues, roughly in order of how much they
influenced the architecture:

### 1. Duplicate HCP IDs — `id` is not a valid row identity

```js
if (i > 0 && i % 9973 === 0) id = rows[i - 1].id;
```

Every 9973rd row silently reuses the *previous* row's `id`. With 50,000 rows
that's 5 collisions. This single line drove a core architectural decision:

**Decision:** every piece of app state that needs to reference "a row" —
edits, selection, undo commands, scroll targets — is keyed by **array
index** (`RowIndex = number`), never by `id`. The generator is deterministic
and the raw `HcpRecord[]` is never mutated or reordered (only *views*, i.e.
arrays of indices, are reordered), so the index is stable for the life of
the app. `id` is still displayed and is still a valid **search** target
(searching `HCP-009974` correctly matches both rows that happen to share an
id with their predecessor) — it's just never used as a key. See
`src/store/types.ts` (top-of-file comment) and `src/engine/values.ts`.

### 2. Null specialty

```js
if (i > 0 && i % 97 === 0) specialty = null;
```

**Decision:** rendered as the literal word **`null`**, in italic/red, rather
than blank — hiding it as an empty cell would make a real data gap look like
a rendering bug. (The provided wireframe shows exactly this treatment, which
confirmed the approach.) For sorting, `null` specialty sorts after every
named specialty, in both ascending and descending order (see "Sort
semantics" below).

### 3. `calls` stored as a string

```js
if (i > 0 && i % 211 === 0) calls = String(calls);
```

The `calls: number | string` union isn't incidental — roughly 1 in 211 rows
really does carry a numeric value as a string (e.g. `"24"`).

**Decision:** coerced leniently via `Number(x)` wherever a numeric value is
needed (sort, aggregate, CPI, display) — see `parseCalls()` in
`src/engine/values.ts`. The coerced number is what's shown in the cell, not
the raw string with quotes; once a row is on screen there's no visible
difference between a row that started as `24` and one that started as
`"24"`. If the string were ever *not* numeric, `parseCalls` returns `null`
and the row is excluded from `Σ Calls` (and counted in a diagnostic
`unparsedCalls` field) rather than silently coerced to `0`, which would
understate a real value. In this dataset that branch is never actually hit
(the generator always stringifies a real number), but the code treats it as
a real possibility rather than assuming the generator's current behavior.

### 4. Calls outlier far above the business cap

```js
if (i > 0 && i % 12007 === 0) calls = 99999;
```

The validator enforces a cap of 60 on *new* edits, but ~4 pre-existing rows
already sit at 99,999 — a value that could never be saved today.

**Decision:** displayed as-is (imperfect source data must be surfaced, not
hidden or silently clamped), with an amber/bold style and a tooltip
("exceeds per-HCP call cap (60) — pre-existing data issue") so it reads as a
flagged anomaly rather than a normal value. It still participates normally
in sums/sorts/CPI like any other number. If the user tries to *edit* that
cell, the new value is subject to the same cap as everything else — there's
no special grandfathering.

### 5. `trx = 0`

```js
if (i > 0 && i % 577 === 0) trx = 0;
```

**Decision:** `CPI = Calls ÷ TRx × 100` is mathematically undefined at
`TRx = 0`. `computeCpi()` returns `undefined` (never `NaN`/`Infinity`), and
the UI renders `—`. Importantly this is *not* the same as a CPI of 0:
`Calls = 0, TRx = 200` is a real, legitimate 0% and renders as `0`, not `—`.
The row's `TRx = 0` still counts normally toward the group's `Σ TRx`, `Σ
Calls`, and HCP count — only the row-level (and, if every row in a group has
`TRx = 0`, the group-level) CPI is undefined.

### 6. `"National"` as a region name

`REGIONS` includes `"National"` alongside five geographic regions, and it
gets `National / T1..T8` territories like any other. This isn't a defect so
much as a modeling trap — it's tempting to special-case it. **Decision:**
treated as an ordinary region with no special handling; the spec says "6
regions," and National is simply one of them.

## Ambiguities resolved

### Sort semantics for values that don't compare cleanly

Null/undefined values (`specialty: null`, unparseable `calls`, undefined
CPI) **always sort after every defined value, in both ascending and
descending order.** A value that jumps from last to first when you flip the
sort direction reads as broken in an operational grid — "missing" should
mean "missing," not "secretly the largest/smallest value," regardless of
direction. (This was also the one real bug caught by the test suite: an
earlier version of the comparator flipped the null-handling branch along
with everything else on `desc`, which `sort.test.ts` now guards against.)

### Group reordering on sort (FR-3)

"Groups reorder by their aggregate value of that column" is well-defined
for the four numeric columns (Calls, TRx, NRx, CPI). For the three
non-numeric columns (ID, Name, Specialty) there's no sensible aggregate to
reorder groups by, so **groups keep their natural (first-seen-in-source)
order** when sorting by a non-numeric column or when sort is off; only the
*rows inside* each territory reorder. Row-level sort is always stable,
using row index as the tiebreaker, independent of which column is active.

### Default expand/collapse state

All regions start **collapsed**. The grid opens as a clean 6-row overview
(one row per region, each showing live aggregates) rather than dumping
thousands of rows immediately — consistent with grouping being primarily a
navigation tool. The footer's "rows in DOM" count makes this visible
immediately (e.g. "6 of 6 visible rows" at load).

### Empty groups after filtering

A region/territory whose filtered row count is 0 is omitted entirely, not
shown as an empty header with "(0 HCPs)". Searching for "Meera" shouldn't
leave 40+ empty region/territory headers cluttering the view.

### Aggregate CPI formula

Group-level CPI is `Σ Calls ÷ Σ TRx × 100` ("ratio of sums"), **not** the
average of each row's individual CPI ("sum/average of ratios"). Ratio-of-
sums is the standard way to aggregate a rate metric — it weights each HCP by
their actual TRx volume rather than letting a low-volume HCP with an
extreme personal CPI skew the group average. It also composes correctly: a
region's CPI equals what you'd get from directly summing all its rows,
regardless of how territories are grouped underneath it.

### Row identity vs. column identity for edits

Only `calls` is editable, so an edit only ever needs to be keyed by
`RowIndex` — there's no need for a `(row, column)` compound key. If a
second editable column were added later, the edit maps would need to become
`Map<RowIndex, Map<ColumnKey, EditState>>`; noted here so it's clear the
current single-level `Map<RowIndex, …>` is a deliberate simplification, not
an oversight.

### Locked-cell concurrency rule (FR-4)

"What happens if the user attempts to edit a cell whose previous commit is
still in flight?" — **the cell is locked**: while a row is `pending`,
clicking it or pressing Enter is a no-op (enforced both in the UI, which
doesn't render an editable state for a pending cell, and defensively in the
store action itself). The first in-flight request always wins; there is
never more than one outstanding validator call per row. This also means
there's no real "late response overwrites a newer one" race *for a single
row* — but the store still tags each pending edit with a monotonic
`requestId` and checks it before applying a result, as a defensive
guard against that invariant ever being violated by a future change.

### Invalid local input

If the user clears the cell, types non-numeric text, or leaves it blank and
then blurs/presses Enter, that's treated as a **cancel** (revert to the
previous display value) — not a commit, and not a call to the validator.
Only a value that actually parses to a finite number, and differs from the
current effective value, triggers `validateCalls()`. Client-side format
errors never reach the async layer.

### Undo/redo scope and semantics (FR-4)

- The command history (`undoStack`/`redoStack`) only records **accepted**
  edits. A rejected commit never enters history — there's nothing to undo
  since nothing changed.
- **Undo and redo never re-invoke the validator.** Undo/redo are treated as
  client-side history navigation over values the user already successfully
  committed once, not new business transactions — the same logic a text
  editor applies to Ctrl+Z (it doesn't re-ask permission to retype a
  character). The `useGridStore.test.ts` "undo/redo" suite asserts
  `validateCalls` isn't called again on redo. (FR-6 revisits this question
  for *bulk* operations, where I land somewhere more nuanced — see
  README.md.)
- Undoing all the way back to a row's **original source value** removes the
  row's entry from `acceptedEdits` entirely (rather than leaving a no-op
  override in place), so the cell's "this was edited" affordance correctly
  disappears too.
- Global `Ctrl+Z` / `Ctrl+Shift+Z` shortcuts are suppressed while a cell's
  edit `<input>` has focus, so the browser's native text-field undo governs
  the in-progress, uncommitted draft; our command stack only ever governs
  committed, validator-accepted values.
- Undoing a change to a row that's currently filtered out, or inside a
  collapsed group, still updates the data/aggregates correctly (it's keyed
  by `RowIndex`, independent of the current view) and additionally
  auto-expands the row's region/territory and scrolls it into view with a
  brief highlight, so the user can see what just happened.
- The undo history is capped at 200 commands (`MAX_UNDO_HISTORY`) to bound
  memory on a long editing session; oldest entries fall off first.

### Rejection flash lifetime

A rejected cell's "reverted + reason" state is shown for 6 seconds and then
auto-clears back to idle, or clears immediately if the user retries the
edit (which supersedes it) or clicks elsewhere. It's never silently
swallowed before the user has had a chance to see it.

### Search behavior

Search matches **name OR id**, case-insensitive substring (not prefix-only).
It auto-expands every region/territory that contains at least one match —
implemented as a view-time overlay on top of the user's manual
expand/collapse state (a union, computed fresh on each render of the flat
view), not a mutation of it. This means clearing the search restores
exactly whatever the user had manually expanded/collapsed before searching,
rather than leaving search-expanded groups open forever.

### Export change-set deduplication (bonus)

The exported JSON diff includes only rows whose *current* accepted value
differs from the *original source* value — if a row is edited and then
edited back to its original value (two separate, independently-validated
commits), it's excluded from the export as a net no-op, per the bonus spec.
