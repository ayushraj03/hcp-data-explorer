import { formatCpi, computeCpi } from "../../engine/values";
import type { GroupAggregate } from "../../store/types";

interface Props {
  level: "region" | "territory";
  label: string;
  aggregate: GroupAggregate;
  expanded: boolean;
  onToggle: () => void;
}

export function GroupHeaderRow({ level, label, aggregate, expanded, onToggle }: Props) {
  const cpi = computeCpi(aggregate.sumCalls, aggregate.sumTrx);
  return (
    <div
      className={`grid-row group-row group-row--${level}`}
      role="row"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="cell group-row__label" role="cell" style={{ gridColumn: "1 / 3" }}>
        <span className={`chevron${expanded ? " chevron--open" : ""}`} aria-hidden="true">
          ▶
        </span>
        <span className="group-row__title">{label}</span>
        <span className="group-row__count">({aggregate.count.toLocaleString()} HCPs)</span>
      </div>
      <div className="cell" role="cell" />
      <div className="cell cell--right group-row__agg" role="cell">
        {aggregate.sumCalls.toLocaleString()}
      </div>
      <div className="cell cell--right group-row__agg" role="cell">
        {aggregate.sumTrx.toLocaleString()}
      </div>
      <div className="cell cell--right group-row__agg" role="cell">
        {aggregate.sumNrx.toLocaleString()}
      </div>
      <div className="cell cell--right group-row__agg" role="cell">
        {formatCpi(cpi)}
      </div>
    </div>
  );
}
