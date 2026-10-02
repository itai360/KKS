import { saveFile } from './download';
import { todayKey } from './format';

type Cell = string | number | null | undefined;

/** A table as a CSV file Excel opens correctly (Hebrew included, thanks to the BOM), named "<name>-<date>.csv". */
export function saveCsv(name: string, header: string[], rows: Cell[][]): Promise<void> {
  const cell = (v: Cell) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  return saveFile(`${name}-${todayKey()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
