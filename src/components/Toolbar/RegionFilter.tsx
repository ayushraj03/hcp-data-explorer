import { useGridStore } from "../../store/useGridStore";

export function RegionFilter() {
  const regions = useGridStore((s) => s.groupIndex.regionOrder);
  const regionFilter = useGridStore((s) => s.regionFilter);
  const setRegionFilter = useGridStore((s) => s.setRegionFilter);

  return (
    <select
      className="region-filter"
      value={regionFilter}
      onChange={(e) => setRegionFilter(e.target.value)}
      aria-label="Filter by region"
    >
      <option value="all">All regions</option>
      {regions.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}
