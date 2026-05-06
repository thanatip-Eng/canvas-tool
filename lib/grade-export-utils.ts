/**
 * Utility functions for Grade Export feature.
 * Reads a registrar grade submission template (.xlsx), maps Canvas grades into it,
 * and produces a new .xlsx preserving the original template structure.
 */

import * as XLSX from 'xlsx';

// --- Types ---

export interface CanvasStudent {
  sisUserId: string;
  name: string;
  finalGrade: string;
}

export interface TemplateStudent {
  rowIndex: number; // 0-based row in sheet (actual Excel row)
  no: string;
  studentId: string;
  name: string;
  grade: string;
  secLec: string;
  secLab: string;
  modular: string;
}

export interface GradeMapping {
  studentId: string;
  studentName: string; // from template
  canvasName: string;  // from Canvas
  grade: string;
  source: 'canvas' | 'existing';
  status: 'filled' | 'skipped' | 'not_found';
}

export interface GradeExportResult {
  mappings: GradeMapping[];
  filledCount: number;
  skippedCount: number;  // already had grade in template
  notInTemplate: CanvasStudent[];  // in Canvas but not in template
  notInCanvas: TemplateStudent[];  // in template but not in Canvas (no grade filled)
  templateStudents: TemplateStudent[];
}

// --- Constants ---

/** The template header row is at row 7 (0-based index 6) */
const TEMPLATE_HEADER_ROW = 6;

/** Expected column mapping in template (0-based) */
const COL = {
  NO: 0,
  STUDENT_ID: 1,
  NAME_START: 2, // Name may span columns C-D (merged cells)
  GRADE: 4,      // Column E
  SECLEC: 5,     // Column F
  SECLAB: 6,     // Column G
  MODULAR: 7,    // Column H
} as const;

// --- Canvas File Parsing ---

/**
 * Parse Canvas export CSV/XLSX to extract students with FinalGrade.
 * Canvas format: columns A-F are student info, last column is FinalGrade.
 */
export function parseCanvasFile(headers: string[], rows: string[][]): {
  students: CanvasStudent[];
  errors: string[];
} {
  const errors: string[] = [];

  // Find SIS User ID column (typically column C, index 2)
  const sisIdx = headers.findIndex(h =>
    /sis\s*user\s*id/i.test(h.trim())
  );
  if (sisIdx === -1) {
    errors.push('ไม่พบคอลัมน์ "SIS User ID" ในไฟล์ Canvas');
    return { students: [], errors };
  }

  // Find FinalGrade column (must be the last data column)
  const finalGradeIdx = headers.findIndex(h =>
    /final\s*grade/i.test(h.trim())
  );
  if (finalGradeIdx === -1) {
    errors.push('ไม่พบคอลัมน์ "FinalGrade" ในไฟล์ Canvas — คอลัมน์สุดท้ายต้องชื่อ FinalGrade');
    return { students: [], errors };
  }

  // Find Student name column
  const nameIdx = headers.findIndex(h =>
    /^student$/i.test(h.trim())
  );

  // Skip "Points Possible" row and "Test Student" rows
  const students: CanvasStudent[] = [];
  for (const row of rows) {
    const sisId = (row[sisIdx] || '').trim();
    if (!sisId) continue;
    // Skip points possible row
    if (/^point/i.test((row[0] || '').trim())) continue;
    // Skip test student
    if (/test\s*student/i.test((row[nameIdx >= 0 ? nameIdx : 0] || ''))) continue;

    const grade = (row[finalGradeIdx] || '').trim();
    const name = nameIdx >= 0 ? (row[nameIdx] || '').trim() : '';

    students.push({
      sisUserId: sisId,
      name,
      finalGrade: grade,
    });
  }

  return { students, errors };
}

// --- Template Parsing ---

/**
 * Parse the registrar grade submission template.
 * Returns raw workbook (for later modification) and parsed student list.
 */
export function parseTemplate(data: Uint8Array): {
  workbook: XLSX.WorkBook;
  students: TemplateStudent[];
  errors: string[];
  gradeColIndex: number;
} {
  const errors: string[] = [];
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];

  // Read all rows as 2D array
  const allRows: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (allRows.length <= TEMPLATE_HEADER_ROW + 1) {
    errors.push('ไฟล์เทมเพลตมีข้อมูลน้อยเกินไป');
    return { workbook, students: [], errors, gradeColIndex: -1 };
  }

  // Find header row — look for "StudentID" or "No." starting from row 6-8
  let headerRowIdx = -1;
  let gradeColIdx = -1;
  let studentIdColIdx = -1;
  let noColIdx = -1;

  for (let r = Math.max(0, TEMPLATE_HEADER_ROW - 1); r <= Math.min(allRows.length - 1, TEMPLATE_HEADER_ROW + 2); r++) {
    const row = allRows[r];
    if (!row) continue;
    const hasStudentId = row.some(cell => /student\s*id/i.test(String(cell).trim()));
    const hasNo = row.some(cell => /^no\.?$/i.test(String(cell).trim()));
    if (hasStudentId || hasNo) {
      headerRowIdx = r;
      // Find column indices
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c]).trim().toLowerCase();
        if (/^no\.?$/.test(val)) noColIdx = c;
        if (/student\s*id/.test(val)) studentIdColIdx = c;
        if (/^grade$/.test(val)) gradeColIdx = c;
      }
      break;
    }
  }

  if (headerRowIdx === -1 || studentIdColIdx === -1) {
    errors.push('ไม่พบหัวตาราง (StudentID) ในเทมเพลต');
    return { workbook, students: [], errors, gradeColIndex: -1 };
  }

  if (gradeColIdx === -1) {
    errors.push('ไม่พบคอลัมน์ "Grade" ในเทมเพลต');
    return { workbook, students: [], errors, gradeColIndex: -1 };
  }

  // Find name columns (between StudentID and Grade)
  const nameStartCol = studentIdColIdx + 1;

  // Parse student data rows (after header)
  const students: TemplateStudent[] = [];
  for (let r = headerRowIdx + 1; r < allRows.length; r++) {
    const row = allRows[r];
    if (!row) continue;

    const studentId = String(row[studentIdColIdx] || '').trim();
    if (!studentId || !/^\d+$/.test(studentId)) continue; // Skip non-student rows

    // Collect name from columns between StudentID and Grade
    const nameParts: string[] = [];
    for (let c = nameStartCol; c < gradeColIdx; c++) {
      const part = String(row[c] || '').trim();
      if (part) nameParts.push(part);
    }

    students.push({
      rowIndex: r,
      no: String(row[noColIdx >= 0 ? noColIdx : 0] || '').trim(),
      studentId,
      name: nameParts.join(' '),
      grade: String(row[gradeColIdx] || '').trim(),
      secLec: String(row[gradeColIdx + 1] || '').trim(),
      secLab: String(row[gradeColIdx + 2] || '').trim(),
      modular: String(row[gradeColIdx + 3] || '').trim(),
    });
  }

  return { workbook, students, errors, gradeColIndex: gradeColIdx };
}

// --- Grade Mapping ---

/**
 * Map Canvas grades into template students.
 */
export function mapGrades(
  canvasStudents: CanvasStudent[],
  templateStudents: TemplateStudent[]
): GradeExportResult {
  // Build lookup from Canvas: SIS User ID → student
  const canvasLookup = new Map<string, CanvasStudent>();
  for (const s of canvasStudents) {
    canvasLookup.set(s.sisUserId, s);
  }

  // Build set of template student IDs for reverse check
  const templateIds = new Set(templateStudents.map(s => s.studentId));

  const mappings: GradeMapping[] = [];
  let filledCount = 0;
  let skippedCount = 0;
  const notInCanvas: TemplateStudent[] = [];

  for (const ts of templateStudents) {
    const cs = canvasLookup.get(ts.studentId);

    if (ts.grade) {
      // Already has a grade — skip
      mappings.push({
        studentId: ts.studentId,
        studentName: ts.name,
        canvasName: cs?.name || '',
        grade: ts.grade,
        source: 'existing',
        status: 'skipped',
      });
      skippedCount++;
    } else if (cs) {
      // Match found, fill grade
      mappings.push({
        studentId: ts.studentId,
        studentName: ts.name,
        canvasName: cs.name,
        grade: cs.finalGrade,
        source: 'canvas',
        status: 'filled',
      });
      filledCount++;
    } else {
      // Not in Canvas
      mappings.push({
        studentId: ts.studentId,
        studentName: ts.name,
        canvasName: '',
        grade: '',
        source: 'canvas',
        status: 'not_found',
      });
      notInCanvas.push(ts);
    }
  }

  // Find Canvas students not in template
  const notInTemplate = canvasStudents.filter(cs => !templateIds.has(cs.sisUserId));

  return {
    mappings,
    filledCount,
    skippedCount,
    notInTemplate,
    notInCanvas,
    templateStudents,
  };
}

// --- Excel Export ---

/**
 * Generate the final Excel file by modifying the original template workbook.
 * Fills Grade column for matched students, adds a "Not In Template" sheet.
 */
export function generateExportXlsx(
  workbook: XLSX.WorkBook,
  result: GradeExportResult,
  gradeColIndex: number
): Uint8Array {
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];

  // Build lookup: studentId → grade to fill
  const gradeToFill = new Map<string, string>();
  for (const m of result.mappings) {
    if (m.status === 'filled' && m.grade) {
      gradeToFill.set(m.studentId, m.grade);
    }
  }

  // Write grades into the worksheet
  for (const ts of result.templateStudents) {
    const grade = gradeToFill.get(ts.studentId);
    if (grade && !ts.grade) {
      // Convert row/col to cell address
      const cellAddr = XLSX.utils.encode_cell({ r: ts.rowIndex, c: gradeColIndex });
      if (!ws[cellAddr]) {
        ws[cellAddr] = { t: 's', v: grade };
      } else {
        ws[cellAddr].v = grade;
      }
    }
  }

  // Add "Not In Template" sheet if there are unmatched Canvas students
  if (result.notInTemplate.length > 0) {
    const nitHeaders = ['SIS User ID', 'Name', 'FinalGrade'];
    const nitRows = result.notInTemplate.map(s => [s.sisUserId, s.name, s.finalGrade]);
    const nitData = [nitHeaders, ...nitRows];
    const nitWs = XLSX.utils.aoa_to_sheet(nitData);
    nitWs['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(workbook, nitWs, 'Not In Template');
  }

  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf);
}
