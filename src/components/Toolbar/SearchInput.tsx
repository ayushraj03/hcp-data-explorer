import { useEffect, useRef, useState } from "react";
import { useGridStore } from "../../store/useGridStore";

const DEBOUNCE_MS = 150;

/**
 * Debounced locally: the input stays instantly responsive (controlled by
 * local state), while the store's committed `search` — which drives the
 * O(n) filter/aggregate/flat-view rebuild — only updates ~150ms after the
 * user stops typing. This is what keeps keystrokes from ever touching the
 * 50k-row recompute path directly.
 */
export function SearchInput() {
  const setSearch = useGridStore((s) => s.setSearch);
  const [value, setValue] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [value, setSearch]);

  return (
    <input
      type="search"
      className="search-input"
      placeholder="Search name or ID…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label="Search name or ID"
    />
  );
}
