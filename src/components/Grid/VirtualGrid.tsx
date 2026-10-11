import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGridStore } from "../../store/useGridStore";
import { DATA_ROW_HEIGHT, REGION_ROW_HEIGHT, TERRITORY_ROW_HEIGHT, GRID_TEMPLATE_COLUMNS } from "./columns";
import { ColumnHeaderRow } from "./ColumnHeaderRow";
import { GroupHeaderRow } from "./GroupHeaderRow";
import { DataRow } from "./DataRow";
import type { FlatViewItem } from "../../store/types";

function sizeFor(item: FlatViewItem): number {
  if (item.type === "region") return REGION_ROW_HEIGHT;
  if (item.type === "territory") return TERRITORY_ROW_HEIGHT;
  return DATA_ROW_HEIGHT;
}

interface Props {
  onDomRowCountChange?: (count: number) => void;
}

export function VirtualGrid({ onDomRowCountChange }: Props) {
  const flatView = useGridStore((s) => s.flatView);
  const rawRows = useGridStore((s) => s.rawRows);
  const toggleRegion = useGridStore((s) => s.toggleRegion);
  const toggleTerritory = useGridStore((s) => s.toggleTerritory);
  const scrollToRowIndex = useGridStore((s) => s.scrollToRowIndex);
  const consumeScrollSignal = useGridStore((s) => s.consumeScrollSignal);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatView.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => sizeFor(flatView[i]),
    overscan: 12,
  });

  useEffect(() => {
    if (scrollToRowIndex === null) return;
    const idx = flatView.findIndex((item) => item.type === "row" && item.rowIndex === scrollToRowIndex);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "center" });
    }
    consumeScrollSignal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToRowIndex]);

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    onDomRowCountChange?.(virtualItems.length);
  }, [virtualItems.length, onDomRowCountChange]);

  return (
    <div className="virtual-grid" style={{ ["--grid-cols" as string]: GRID_TEMPLATE_COLUMNS }}>
      <ColumnHeaderRow />
      <div ref={scrollRef} className="virtual-grid__scroll" role="rowgroup">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((vItem) => {
            const item = flatView[vItem.index];
            const style: React.CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vItem.size,
              transform: `translateY(${vItem.start}px)`,
            };
            if (item.type === "region") {
              return (
                <div key={vItem.key} style={style}>
                  <GroupHeaderRow
                    level="region"
                    label={item.region}
                    aggregate={item.aggregate}
                    expanded={item.expanded}
                    onToggle={() => toggleRegion(item.region)}
                  />
                </div>
              );
            }
            if (item.type === "territory") {
              return (
                <div key={vItem.key} style={style}>
                  <GroupHeaderRow
                    level="territory"
                    label={item.territory}
                    aggregate={item.aggregate}
                    expanded={item.expanded}
                    onToggle={() => toggleTerritory(item.region, item.territory)}
                  />
                </div>
              );
            }
            return (
              <div key={vItem.key} style={style}>
                <DataRow rowIndex={item.rowIndex} row={rawRows[item.rowIndex]} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
