/**
 * Utility functions for CMU OBE Score Mapping feature.
 *
 * CMU OBE exports are HTML pages with JSON data in a data-page attribute.
 * This module extracts student data and maps Canvas scores into OBE format.
 */

import * as XLSX from 'xlsx';

// --- Types ---

export interface ObeStudent {
  id: number;          // internal gradebook id
  studentId: string;   // e.g. "600610807"
  name: string;        // Thai full name
  nameEn: string;      // English full name
  sec: string;         // e.g. "001"
  lab: string;         // e.g. "000"
  grade: string | null;
  score: number | null;
}

export interface CanvasAssignment {
  name: string;
  index: number;       // column index in Canvas CSV
}

export interface CanvasStudentScore {
  sisUserId: string;
  name: string;
  scores: Map<string, string>;  // assignment name → score value
  totalScore: number;
}

export interface ObeMappingResult {
  mappedStudents: ObeMappedStudent[];
  assignments: CanvasAssignment[];
  matchedCount: number;
  unmatchedObe: ObeStudent[];     // in OBE but not in Canvas
  unmatchedCanvas: CanvasStudentScore[];  // in Canvas but not in OBE
}

export interface ObeMappedStudent {
  studentId: string;
  name: string;
  sec: string;
  lab: string;
  totalScore: number;
  assignmentScores: (string | number)[];  // ordered by assignments array
  matched: boolean;
}

// --- Constants ---

/** Canvas CSV fixed columns count (Student, ID, SIS User ID, SIS Login ID, Integration ID, Section) */
const CANVAS_FIXED_COLS = 6;

/** Regex to detect assignment columns (contain assignment ID in parentheses) */
const ASSIGNMENT_ID_REGEX = /\(\d+\)$/;

/** Patterns to exclude from assignment columns */
const EXCLUDE_PATTERNS = [
  /^current\s+score/i,
  /^final\s+score/i,
  /^current\s+points/i,
  /^final\s+points/i,
  /^current\s+grade/i,
  /^final\s+grade/i,
  /^unposted\s+current/i,
  /^unposted\s+final/i,
  /^override\s+score/i,
  /^override\s+grade/i,
];

// --- OBE File Parsing ---

/**
 * Parse CMU OBE HTML file to extract student list.
 * The OBE export is an HTML page with JSON data in a data-page attribute.
 */
export function parseObeFile(htmlContent: string): {
  students: ObeStudent[];
  courseName: string;
  courseNo: string;
  errors: string[];
} {
  const errors: string[] = [];

  // Extract data-page JSON from HTML
  const match = htmlContent.match(/data-page="([^"]+)"/);
  if (!match) {
    errors.push('ไม่พบข้อมูล data-page ในไฟล์ CMU OBE — ไฟล์อาจไม่ถูกต้อง');
    return { students: [], courseName: '', courseNo: '', errors };
  }

  let data: Record<string, unknown>;
  try {
    // Unescape HTML entities
    const raw = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'");
    data = JSON.parse(raw);
  } catch {
    errors.push('ไม่สามารถ parse JSON จากไฟล์ OBE ได้');
    return { students: [], courseName: '', courseNo: '', errors };
  }

  const props = data.props as Record<string, unknown> | undefined;
  if (!props) {
    errors.push('ไม่พบ props ในข้อมูล OBE');
    return { students: [], courseName: '', courseNo: '', errors };
  }

  const gradebook = (props.gradebook || {}) as Record<string, unknown>;
  const courseName = (gradebook.title as string) || '';
  const courseNo = String(gradebook.no || '');

  // Students can be in props.students or gradebook.students
  const rawStudents = (props.students || gradebook.students || []) as Record<string, unknown>[];

  const students: ObeStudent[] = rawStudents.map((s) => ({
    id: (s.id as number) || 0,
    studentId: String(s.student_id || ''),
    name: (s.student_name as string) || `${s.first_name_th || ''} ${s.last_name_th || ''}`.trim(),
    nameEn: (s.student_name_en as string) || `${s.first_name_en || ''} ${s.last_name_en || ''}`.trim(),
    sec: String(s.sec || ''),
    lab: String(s.lab || ''),
    grade: (s.grade as string) || null,
    score: (s.score as number) || null,
  }));

  // Sort by studentId
  students.sort((a, b) => a.studentId.localeCompare(b.studentId));

  return { students, courseName, courseNo, errors };
}

// --- Canvas File Parsing ---

/**
 * Parse Canvas export to extract assignments and student scores.
 */
export function parseCanvasForObe(headers: string[], rows: string[][]): {
  assignments: CanvasAssignment[];
  students: CanvasStudentScore[];
  errors: string[];
} {
  const errors: string[] = [];

  // Find SIS User ID column
  const sisIdx = headers.findIndex(h => /sis\s*user\s*id/i.test(h.trim()));
  if (sisIdx === -1) {
    errors.push('ไม่พบคอลัมน์ "SIS User ID" ในไฟล์ Canvas');
    return { assignments: [], students: [], errors };
  }

  // Find Student name column
  const nameIdx = headers.findIndex(h => /^student$/i.test(h.trim()));

  // Identify assignment columns (from CANVAS_FIXED_COLS onward, matching ID pattern)
  const assignments: CanvasAssignment[] = [];
  for (let i = CANVAS_FIXED_COLS; i < headers.length; i++) {
    const h = headers[i].trim();
    if (!h) continue;
    if (!ASSIGNMENT_ID_REGEX.test(h)) continue;
    if (EXCLUDE_PATTERNS.some(p => p.test(h))) continue;
    assignments.push({ name: h, index: i });
  }

  if (assignments.length === 0) {
    errors.push('ไม่พบคอลัมน์ assignment ในไฟล์ Canvas');
    return { assignments: [], students: [], errors };
  }

  // Parse student rows
  const students: CanvasStudentScore[] = [];
  for (const row of rows) {
    const sisId = (row[sisIdx] || '').trim();
    if (!sisId) continue;
    // Skip points possible row
    if (/^point/i.test((row[0] || '').trim())) continue;
    // Skip test student
    if (/test\s*student/i.test((row[nameIdx >= 0 ? nameIdx : 0] || ''))) continue;

    const scores = new Map<string, string>();
    let total = 0;
    for (const a of assignments) {
      const val = (row[a.index] || '').trim();
      scores.set(a.name, val);
      const num = parseFloat(val);
      if (!isNaN(num)) total += num;
    }

    students.push({
      sisUserId: sisId,
      name: nameIdx >= 0 ? (row[nameIdx] || '').trim() : '',
      scores,
      totalScore: total,
    });
  }

  return { assignments, students, errors };
}

// --- Mapping ---

/**
 * Map Canvas scores into OBE student list.
 */
export function mapObeScores(
  obeStudents: ObeStudent[],
  canvasStudents: CanvasStudentScore[],
  assignments: CanvasAssignment[]
): ObeMappingResult {
  // Build Canvas lookup
  const canvasLookup = new Map<string, CanvasStudentScore>();
  for (const cs of canvasStudents) {
    canvasLookup.set(cs.sisUserId, cs);
  }

  const obeIds = new Set(obeStudents.map(s => s.studentId));
  const mappedStudents: ObeMappedStudent[] = [];
  let matchedCount = 0;
  const unmatchedObe: ObeStudent[] = [];

  for (const os of obeStudents) {
    const cs = canvasLookup.get(os.studentId);
    if (cs) {
      matchedCount++;
      const assignmentScores = assignments.map(a => {
        const val = cs.scores.get(a.name) || '';
        const num = parseFloat(val);
        return isNaN(num) ? val : num;
      });
      mappedStudents.push({
        studentId: os.studentId,
        name: os.name,
        sec: os.sec,
        lab: os.lab,
        totalScore: cs.totalScore,
        assignmentScores,
        matched: true,
      });
    } else {
      unmatchedObe.push(os);
      mappedStudents.push({
        studentId: os.studentId,
        name: os.name,
        sec: os.sec,
        lab: os.lab,
        totalScore: 0,
        assignmentScores: assignments.map(() => ''),
        matched: false,
      });
    }
  }

  const unmatchedCanvas = canvasStudents.filter(cs => !obeIds.has(cs.sisUserId));

  return { mappedStudents, assignments, matchedCount, unmatchedObe, unmatchedCanvas };
}

// --- Excel Export ---

/**
 * Generate OBE-format Excel file.
 * Columns: A=รหัสนศ., B=ชื่อ-สกุล, C=Section, D=คะแนนรวม, E+= assignments
 */
export function generateObeXlsx(
  result: ObeMappingResult,
  courseNo: string,
  courseName: string
): Uint8Array {
  const wb = XLSX.utils.book_new();

  // Clean assignment names (remove ID suffix for readability)
  const cleanAssignmentNames = result.assignments.map(a =>
    a.name.replace(/\s*\(\d+\)$/, '')
  );

  // Build header row
  const headers = ['รหัสนักศึกษา', 'ชื่อ-สกุล', 'Section', 'คะแนนรวม', ...cleanAssignmentNames];

  // Build data rows
  const dataRows = result.mappedStudents.map(s => [
    s.studentId,
    s.name,
    `${s.sec}/${s.lab}`,
    s.matched ? s.totalScore : '',
    ...s.assignmentScores,
  ]);

  const sheetData = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Auto-width columns
  const colWidths = headers.map((h, colIdx) => {
    let maxLen = h.length;
    for (const row of dataRows) {
      const val = row[colIdx];
      const len = val != null ? String(val).length : 0;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'OBE Scores');

  // Add unmatched Canvas students sheet
  if (result.unmatchedCanvas.length > 0) {
    const ucHeaders = ['SIS User ID', 'ชื่อ (Canvas)', 'คะแนนรวม'];
    const ucRows = result.unmatchedCanvas.map(s => [s.sisUserId, s.name, s.totalScore]);
    const ucData = [ucHeaders, ...ucRows];
    const ucWs = XLSX.utils.aoa_to_sheet(ucData);
    ucWs['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ucWs, 'Not In OBE');
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf);
}
