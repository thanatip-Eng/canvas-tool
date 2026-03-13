import * as XLSX from 'xlsx';

/**
 * Sheet data definition for building multi-sheet XLSX workbooks.
 */
export interface SheetData {
  name: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Build a single-sheet XLSX workbook and return as Uint8Array.
 */
export function buildXlsx(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  sheetName = 'Sheet1'
): Uint8Array {
  return buildXlsxMultiSheet([{ name: sheetName, headers, rows }]);
}

/**
 * Build a multi-sheet XLSX workbook and return as Uint8Array.
 * Each sheet has its own headers and rows.
 */
export function buildXlsxMultiSheet(sheets: SheetData[]): Uint8Array {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // Combine headers + rows into a single 2D array
    const data: (string | number | null | undefined)[][] = [
      sheet.headers,
      ...sheet.rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Auto-width columns based on content
    const colWidths = sheet.headers.map((h, colIdx) => {
      let maxLen = h.length;
      for (const row of sheet.rows) {
        const val = row[colIdx];
        const len = val != null ? String(val).length : 0;
        if (len > maxLen) maxLen = len;
      }
      return { wch: Math.min(maxLen + 2, 50) }; // cap at 50 chars width
    });
    ws['!cols'] = colWidths;

    // Sanitize sheet name (max 31 chars, no special chars)
    const safeName = sheet.name
      .replace(/[\\/*?:\[\]]/g, '_')
      .substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf);
}

/**
 * Parse an XLSX Blob into headers and rows.
 * Reads the first sheet by default.
 */
export function parseXlsxBlob(blob: Blob): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length === 0) {
          resolve({ headers: [], rows: [] });
          return;
        }
        const headers = raw[0].map((h) => String(h ?? ''));
        const rows = raw.slice(1).map((r) => r.map((c) => String(c ?? '')));
        resolve({ headers, rows });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Download an XLSX buffer as a file in the browser.
 * Filename is suffixed with the current date (YYYY-MM-DD).
 */
export function downloadXlsx(xlsxBuffer: Uint8Array, filenamePrefix: string): void {
  const blob = new Blob([xlsxBuffer.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
