import * as XLSX from 'xlsx';
import type { ParsedFile, RegistrarFile, MasterAssignment, ParsedMasterData, RegOnlyStudent, MasterDataStats } from '@/types';
import { CANVAS_FIXED_COLS, MASTER_FIXED_COLS, ASSIGNMENT_ID_REGEX, EXCLUDE_PATTERNS } from '@/lib/constants';
import { getPointsRowStart } from '@/lib/canvas-utils';

// ========== Master Data Headers ==========

const MASTER_HEADERS_PREFIX = [
  'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
  'Reg Status', 'สถานะจับคู่',
];

const REG_ONLY_HEADERS = ['ID', 'ชื่อ', 'นามสกุล', 'Reg Status', 'Lec Section', 'Lab Section'];

// ========== Build Master Data ==========

interface BuildMasterDataResult {
  mainHeaders: string[];
  pointsPossibleRow: (string | number | null)[];
  mainRows: (string | number | null)[][];
  regOnlyHeaders: string[];
  regOnlyRows: string[][];
  stats: MasterDataStats;
}

/**
 * สร้าง master data จาก Canvas export + registrar files.
 * Returns sheet data ready for XLSX export.
 */
export function buildMasterData(
  canvasData: ParsedFile,
  registrarFiles: RegistrarFile[],
): BuildMasterDataResult {
  // 1. Extract assignment columns from Canvas headers
  const canvasHeaders = canvasData.headers;
  const assignmentCols = extractMasterAssignmentCols(canvasHeaders);

  // 2. Build master headers: A-F prefix + assignment names
  const mainHeaders = [
    ...MASTER_HEADERS_PREFIX,
    ...assignmentCols.map(a => a.header),
  ];

  // 3. Get Points Possible row from Canvas data
  const ppRowStart = getPointsRowStart(canvasData.rows);
  const canvasPPRow = ppRowStart === 1 ? canvasData.rows[0] : null;
  const pointsPossibleRow: (string | number | null)[] = [
    ...new Array(MASTER_FIXED_COLS).fill(''),
    ...assignmentCols.map(a => canvasPPRow ? (canvasPPRow[a.canvasIndex] || '') : ''),
  ];

  // 4. Build registrar lookup: ID → { name, sname, regStatus, section }
  const regLookup = new Map<string, { name: string; sname: string; regStatus: string; lecSection: string; labSection: string }>();
  const allRegIds = new Set<string>();

  for (const rf of registrarFiles) {
    const regHeaders = rf.data.headers.map(h => (h || '').toLowerCase().trim());
    const regIdIdx = regHeaders.findIndex(h => h === 'id');
    const regNameIdx = regHeaders.findIndex(h => h === 'name');
    const regSnameIdx = regHeaders.findIndex(h => h === 'sname');
    const wStatusIdx = 3; // Column D (hardcoded, no header)

    for (const row of rf.data.rows) {
      const id = (row[regIdIdx] || '').trim();
      if (!id) continue;
      allRegIds.add(id);
      if (!regLookup.has(id)) {
        regLookup.set(id, {
          name: row[regNameIdx] || '',
          sname: row[regSnameIdx] || '',
          regStatus: wStatusIdx < row.length ? (row[wStatusIdx] || '').trim() : '',
          lecSection: rf.lecSection,
          labSection: rf.labSection,
        });
      }
    }
  }

  // 5. Build main data rows from Canvas students
  const dataRowStart = ppRowStart === 1 ? 1 : 0;
  const canvasRows = canvasData.rows.slice(dataRowStart);

  // Find Canvas column indices for A-F
  const cHeaders = canvasHeaders.map(h => (h || '').toLowerCase());
  const sisIdx = cHeaders.findIndex(h => h === 'sis user id');
  const idIdx = cHeaders.findIndex(h => h === 'id');
  const loginIdx = cHeaders.findIndex(h => h.includes('sis login'));
  const integIdx = cHeaders.findIndex(h => h.includes('integration'));
  const sectionIdx = cHeaders.findIndex(h => h === 'section');

  const mainRows: (string | number | null)[][] = [];
  let matchedCount = 0;
  let canvasOnlyCount = 0;
  const canvasSisIds = new Set<string>();

  for (const row of canvasRows) {
    const studentName = row[0] || '';
    // Skip "Test Student" rows
    if (!studentName || studentName.toLowerCase() === 'test student') continue;

    const canvasId = idIdx >= 0 ? row[idIdx] || '' : '';
    const sisUserId = sisIdx >= 0 ? (row[sisIdx] || '').trim() : '';
    const sisLoginId = loginIdx >= 0 ? row[loginIdx] || '' : '';
    const integrationId = integIdx >= 0 ? row[integIdx] || '' : '';
    const section = sectionIdx >= 0 ? row[sectionIdx] || '' : '';

    canvasSisIds.add(sisUserId);

    // Lookup registrar
    const regInfo = sisUserId ? regLookup.get(sisUserId) : null;
    const regStatus = regInfo?.regStatus || '';
    const matchStatus = regInfo ? 'ตรงกัน' : 'เฉพาะ Canvas';

    if (regInfo) matchedCount++;
    else canvasOnlyCount++;

    // Build row: A-F + Reg Status + Match Status + assignment scores
    const masterRow: (string | number | null)[] = [
      studentName,
      canvasId,
      sisUserId,
      sisLoginId,
      integrationId,
      section,
      regStatus,
      matchStatus,
      ...assignmentCols.map(a => row[a.canvasIndex] || ''),
    ];
    mainRows.push(masterRow);
  }

  // 6. Build reg-only sheet
  const regOnlyRows: string[][] = [];
  for (const [id, info] of regLookup) {
    if (!canvasSisIds.has(id)) {
      regOnlyRows.push([
        id,
        info.name,
        info.sname,
        info.regStatus,
        info.lecSection,
        info.labSection,
      ]);
    }
  }

  return {
    mainHeaders,
    pointsPossibleRow,
    mainRows,
    regOnlyHeaders: REG_ONLY_HEADERS,
    regOnlyRows,
    stats: {
      totalStudents: mainRows.length,
      matchedCount,
      canvasOnlyCount,
      regOnlyCount: regOnlyRows.length,
      assignmentCount: assignmentCols.length,
    },
  };
}

// ========== Extract Assignment Columns ==========

interface AssignmentCol {
  header: string;
  canvasIndex: number;
  id: string;
}

/**
 * Extract valid assignment columns from Canvas headers.
 * Filters out excluded patterns (read only, current score, etc.)
 * Similar to extractAssignments() but returns canvasIndex for row mapping.
 */
function extractMasterAssignmentCols(headers: string[]): AssignmentCol[] {
  const cols: AssignmentCol[] = [];
  headers.forEach((h, i) => {
    if (i >= CANVAS_FIXED_COLS && h) {
      const lower = h.toLowerCase();
      const isExcluded = EXCLUDE_PATTERNS.some(p => lower.includes(p));
      const idMatch = h.match(ASSIGNMENT_ID_REGEX);
      const hasAssignmentId = ASSIGNMENT_ID_REGEX.test(h);

      if (!isExcluded && (hasAssignmentId || (!lower.includes('point') && !lower.includes('score')))) {
        cols.push({
          header: h,
          canvasIndex: i,
          id: idMatch ? idMatch[1] : '',
        });
      }
    }
  });
  return cols;
}

// ========== Parse Master Data XLSX ==========

/**
 * Parse a master data XLSX buffer into ParsedMasterData.
 * Reads both sheets: "ข้อมูลหลัก" (main) and "เฉพาะทะเบียน" (reg-only).
 */
export function parseMasterDataBuffer(buffer: Uint8Array): ParsedMasterData {
  const wb = XLSX.read(buffer, { type: 'array' });

  // Sheet 1: main data
  const mainSheetName = wb.SheetNames[0];
  const mainWs = wb.Sheets[mainSheetName];
  const mainRaw: string[][] = XLSX.utils.sheet_to_json(mainWs, { header: 1, defval: '' });

  if (mainRaw.length < 2) {
    throw new Error('Master data file is empty or invalid');
  }

  const headers = mainRaw[0].map(h => String(h ?? ''));

  // Row 2 = Points Possible row (check if it starts with empty and has numbers after MASTER_FIXED_COLS)
  // Row 3+ = student data
  let pointsPossibleRow: string[] = [];
  let dataStartRow = 1;

  // Check if row 1 looks like a points possible row (first cell empty or contains no student name)
  const potentialPPRow = mainRaw[1];
  if (potentialPPRow && potentialPPRow.length > MASTER_FIXED_COLS) {
    const firstVal = String(potentialPPRow[0] || '').trim();
    // Points row: first cell is empty or starts with a non-name pattern
    if (!firstVal || firstVal.toLowerCase().includes('point')) {
      pointsPossibleRow = potentialPPRow.map(c => String(c ?? ''));
      dataStartRow = 2;
    }
  }

  const rows = mainRaw.slice(dataStartRow).map(r => r.map(c => String(c ?? '')));

  // Extract assignments from headers (columns after MASTER_FIXED_COLS)
  const assignments: MasterAssignment[] = [];
  for (let i = MASTER_FIXED_COLS; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    const idMatch = h.match(ASSIGNMENT_ID_REGEX);
    const pp = pointsPossibleRow[i] ? parseFloat(pointsPossibleRow[i]) : null;
    assignments.push({
      name: h,
      id: idMatch ? idMatch[1] : '',
      columnIndex: i,
      pointsPossible: pp && !isNaN(pp) ? pp : null,
    });
  }

  // Build student lookup: SIS User ID (column 2) → row index
  const studentMap = new Map<string, number>();
  rows.forEach((row, idx) => {
    const sisUserId = (row[2] || '').trim(); // Column C = SIS User ID
    if (sisUserId) studentMap.set(sisUserId, idx);
  });

  // Sheet 2: reg-only students
  const regOnlyStudents: RegOnlyStudent[] = [];
  if (wb.SheetNames.length > 1) {
    const regWs = wb.Sheets[wb.SheetNames[1]];
    const regRaw: string[][] = XLSX.utils.sheet_to_json(regWs, { header: 1, defval: '' });
    for (let i = 1; i < regRaw.length; i++) {
      const row = regRaw[i];
      if (row[0]) {
        regOnlyStudents.push({
          id: String(row[0] || ''),
          name: String(row[1] || ''),
          surname: String(row[2] || ''),
          regStatus: String(row[3] || ''),
          section: row[4] ? `Lec ${row[4]} / Lab ${row[5] || '000'}` : '',
        });
      }
    }
  }

  return {
    headers,
    pointsPossibleRow,
    rows,
    assignments,
    studentMap,
    regOnlyStudents,
    sourceInfo: { canvasFileId: '', registrarFileIds: [] },
  };
}
