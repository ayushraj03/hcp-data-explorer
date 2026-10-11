import type { SortableColumn } from "../../store/types";

export interface ColumnDef {
  key: SortableColumn;
  label: string;
  width: string; // CSS grid track
  align: "left" | "right";
  sortable: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: "id", label: "ID", width: "140px", align: "left", sortable: true },
  { key: "name", label: "HCP Name", width: "1fr", align: "left", sortable: true },
  { key: "specialty", label: "Specialty", width: "160px", align: "left", sortable: true },
  { key: "calls", label: "Calls", width: "90px", align: "right", sortable: true },
  { key: "trx", label: "TRx", width: "90px", align: "right", sortable: true },
  { key: "nrx", label: "NRx", width: "90px", align: "right", sortable: true },
  { key: "cpi", label: "CPI", width: "70px", align: "right", sortable: true },
];

export const GRID_TEMPLATE_COLUMNS = COLUMNS.map((c) => c.width).join(" ");

export const DATA_ROW_HEIGHT = 36;
export const REGION_ROW_HEIGHT = 42;
export const TERRITORY_ROW_HEIGHT = 36;
