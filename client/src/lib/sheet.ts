import { fileName } from '@shared/docx';
import { XLSX_TYPE, xlsxFile, type SheetCell } from '@shared/xlsx';
import { shareOrSave } from './download';
import { todayKey } from './format';

/** A table as an Excel file - Google Drive opens it as Google Sheets - named "<name>-<date>.xlsx". */
export function saveSheet(name: string, header: string[], rows: SheetCell[][]): Promise<void> {
  return shareOrSave(fileName(`${name}-${todayKey()}`, 'xlsx'), new Blob([xlsxFile(name, header, rows) as BlobPart], { type: XLSX_TYPE }));
}
