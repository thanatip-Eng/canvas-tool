import { ParsedFile, RegistrarFile, CheckEntry } from '@/types';
import { STATUS, REGISTRAR_FILENAME_REGEX } from '@/lib/constants';
import { getPointsRowStart } from '@/lib/canvas-utils';

// ========== Types ==========

interface ParsedRegFilename {
  courseCode: string;
  lecSection: string;
  labSection: string;
}

interface CanvasStudent {
  name: string;
  canvasId: string;
  sisId: string;
  section: string;
  row: string[];
}

interface SectionResult {
  label: string;
  filename: string;
  courseCode: string;
  lecSection: string;
  labSection: string;
  matched: CheckEntry[];
  canvasOnly: CheckEntry[];
  regOnly: CheckEntry[];
  regTotal: number;
}

interface StatusCheckResult {
  sections: SectionResult[];
  allEntries: CheckEntry[];
  canvasOnlyStudents: CheckEntry[];
  canvasTotal: number;
  regTotal: number;
  totalMatched: number;
  totalIssues: number;
}

// ========== Filename Parsing ==========

/**
 * Parse a registrar filename to extract course code and section numbers.
 * Expected format: {courseCode:6}{lecSection:3}{labSection:3}.csv
 * e.g. "261111802000.csv" -> { courseCode: "261111", lecSection: "802", labSection: "000" }
 */
export function parseRegFilename(filename: string): ParsedRegFilename | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const match = base.match(REGISTRAR_FILENAME_REGEX);
  if (match) {
    return {
      courseCode: match[1],
      lecSection: match[2],
      labSection: match[3],
    };
  }
  return null;
}

// ========== Canvas Student Extraction ==========

/**
 * Extract student records from a parsed Canvas gradebook export.
 * Skips the "Points Possible" row if present, and filters out "Test Student".
 */
export function extractCanvasStudents(canvasData: ParsedFile): CanvasStudent[] {
  const headers = canvasData.headers.map((h) => (h || '').toLowerCase());
  const cSisIdx = headers.findIndex((h) => h === 'sis user id');
  const cIdIdx = headers.findIndex((h) => h === 'id');
  const cSectionIdx = headers.findIndex((h) => h === 'section');
  const startRow = getPointsRowStart(canvasData.rows);

  return canvasData.rows
    .slice(startRow)
    .map((row) => ({
      name: row[0] || '',
      canvasId: row[cIdIdx] || '',
      sisId: (row[cSisIdx] || '').trim(),
      section: row[cSectionIdx] || '',
      row,
    }))
    .filter((s) => s.name && s.name.toLowerCase() !== 'test student');
}

// ========== Section Comparison ==========

/**
 * Compare Canvas students against a single registrar file section.
 * Uses O(1) Map/Set lookups for efficient matching.
 *
 * @param canvasStudents - All Canvas students
 * @param canvasBySisId - Map of SIS ID -> Canvas student for O(1) lookup
 * @param regFile - The registrar file to compare against
 * @returns Section result with matched and reg-only students
 */
export function compareSection(
  canvasStudents: CanvasStudent[],
  canvasBySisId: Map<string, CanvasStudent>,
  regFile: RegistrarFile
): SectionResult {
  const regHeaders = regFile.data.headers.map((h) => (h || '').toLowerCase().trim());
  const regIdIdx = regHeaders.findIndex((h) => h === 'id');
  const regNameIdx = regHeaders.findIndex((h) => h === 'name');
  const regSnameIdx = regHeaders.findIndex((h) => h === 'sname');
  const regFacIdIdx = regHeaders.findIndex((h) => h === 'facid');
  const regFacNameIdx = regHeaders.findIndex((h) => h === 'facname');

  const sectionLabel = `วิชา ${regFile.courseCode} | Lec ${regFile.lecSection} | Lab ${regFile.labSection}`;

  const regStudents = regFile.data.rows
    .map((row) => ({
      id: (row[regIdIdx] || '').trim(),
      name: row[regNameIdx] || '',
      sname: row[regSnameIdx] || '',
      facId: regFacIdIdx >= 0 ? row[regFacIdIdx] || '' : '',
      facName: regFacNameIdx >= 0 ? row[regFacNameIdx] || '' : '',
    }))
    .filter((s) => s.id);

  const regIdSet = new Set(regStudents.map((s) => s.id));
  // Build registrar lookup Map for O(1) access
  const regById = new Map(regStudents.map((s) => [s.id, s]));
  const matched: CheckEntry[] = [];
  const regOnly: CheckEntry[] = [];

  // Check Canvas students against this registrar section
  canvasStudents.forEach((cs) => {
    if (!cs.sisId) return;
    if (regIdSet.has(cs.sisId)) {
      const regStudent = regById.get(cs.sisId);
      matched.push({
        id: cs.sisId,
        name: cs.name,
        surname: regStudent ? `${regStudent.name} ${regStudent.sname}` : '',
        canvasSection: cs.section,
        status: STATUS.MATCH,
        section: sectionLabel,
      });
    }
  });

  // Registrar students not in Canvas (O(1) lookup via Map)
  regStudents.forEach((rs) => {
    if (!canvasBySisId.has(rs.id)) {
      regOnly.push({
        id: rs.id,
        name: '-',
        surname: `${rs.name} ${rs.sname}`,
        canvasSection: '-',
        status: STATUS.REG_ONLY,
        section: sectionLabel,
      });
    }
  });

  return {
    label: sectionLabel,
    filename: regFile.filename,
    courseCode: regFile.courseCode,
    lecSection: regFile.lecSection,
    labSection: regFile.labSection,
    matched,
    canvasOnly: [],
    regOnly,
    regTotal: regStudents.length,
  };
}

// ========== Canvas-Only Detection ==========

/**
 * Find students who are in Canvas but not in any registrar file.
 */
export function findCanvasOnlyStudents(
  canvasStudents: CanvasStudent[],
  allRegIds: Set<string>
): CheckEntry[] {
  return canvasStudents
    .filter((cs) => cs.sisId && !allRegIds.has(cs.sisId))
    .map((cs) => ({
      id: cs.sisId,
      name: cs.name,
      surname: '-',
      canvasSection: cs.section,
      status: STATUS.CANVAS_ONLY,
      section: 'ไม่พบในทะเบียน',
    }));
}

// ========== Build All Registrar IDs ==========

/**
 * Collect all student IDs from all registrar files into a single Set
 * for O(1) lookup when finding Canvas-only students.
 */
export function buildAllRegIds(registrarFiles: RegistrarFile[]): Set<string> {
  const allRegIds = new Set<string>();
  registrarFiles.forEach((rf) => {
    const regHeaders = rf.data.headers.map((h) => (h || '').toLowerCase().trim());
    const regIdIdx = regHeaders.findIndex((h) => h === 'id');
    rf.data.rows.forEach((row) => {
      const id = (row[regIdIdx] || '').trim();
      if (id) allRegIds.add(id);
    });
  });
  return allRegIds;
}

// ========== Full Status Check ==========

/**
 * Perform a complete status check comparing Canvas enrollment against
 * all registrar files. Returns aggregated results with stats.
 */
export function performStatusCheck(
  canvasData: ParsedFile,
  registrarFiles: RegistrarFile[]
): StatusCheckResult {
  const canvasStudents = extractCanvasStudents(canvasData);

  // Build Canvas SIS ID Map once for O(1) lookups
  const canvasBySisId = new Map<string, CanvasStudent>();
  canvasStudents.forEach((cs) => {
    if (cs.sisId) canvasBySisId.set(cs.sisId, cs);
  });

  const allEntries: CheckEntry[] = [];
  const sectionResults: SectionResult[] = [];

  registrarFiles.forEach((regFile) => {
    const result = compareSection(canvasStudents, canvasBySisId, regFile);
    sectionResults.push(result);
    allEntries.push(...result.matched, ...result.regOnly);
  });

  const allRegIds = buildAllRegIds(registrarFiles);
  const canvasOnlyStudents = findCanvasOnlyStudents(canvasStudents, allRegIds);
  allEntries.push(...canvasOnlyStudents);

  const totalMatched = allEntries.filter((e) => e.status === STATUS.MATCH).length;
  const totalRegOnly = allEntries.filter((e) => e.status === STATUS.REG_ONLY).length;

  return {
    sections: sectionResults,
    allEntries,
    canvasOnlyStudents,
    canvasTotal: canvasStudents.length,
    regTotal: registrarFiles.reduce(
      (sum, f) => sum + f.data.rows.filter((r) => r.some((c) => c)).length,
      0
    ),
    totalMatched,
    totalIssues: canvasOnlyStudents.length + totalRegOnly,
  };
}
