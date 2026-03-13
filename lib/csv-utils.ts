import * as XLSX from 'xlsx';
import { ParsedFile } from '@/types';

/**
 * Parse a CSV or Excel file into a ParsedFile structure.
 * CSV files are parsed with a custom parser that handles quoted fields.
 * Excel files are parsed using the XLSX library.
 */
export function parseFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const name = file.name.toLowerCase();

    if (name.endsWith('.csv')) {
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).map((line) => {
          const result: string[] = [];
          let cell = '';
          let inQuotes = false;
          for (const ch of line) {
            if (ch === '"') {
              inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
              result.push(cell.trim());
              cell = '';
            } else {
              cell += ch;
            }
          }
          result.push(cell.trim());
          return result;
        });
        resolve({
          headers: lines[0] || [],
          rows: lines.slice(1).filter((r) => r.some((c) => c)),
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        resolve({
          headers: (json[0] || []).map((h) => h?.toString() || ''),
          rows: json.slice(1).map((r) => r.map((c) => c?.toString() || '')),
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    }
  });
}

/**
 * Parse a CSV or Excel file from a Blob (e.g. downloaded from Firebase Storage).
 * Determines file type from the provided filename extension.
 */
export function parseFileFromBlob(blob: Blob, filename: string): Promise<ParsedFile> {
  // Convert Blob to File so we can reuse parseFile()
  const file = new File([blob], filename, { type: blob.type });
  return parseFile(file);
}

/**
 * Escape a value for safe inclusion in a CSV field.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 */
export function escapeCSV(val: string | number | null | undefined): string {
  const v = String(val || '');
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

/**
 * Download a CSV string as a file with UTF-8 BOM for proper Thai character display.
 * The filename is suffixed with the current date (YYYY-MM-DD).
 */
export function downloadCSV(csvContent: string, filenamePrefix: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
