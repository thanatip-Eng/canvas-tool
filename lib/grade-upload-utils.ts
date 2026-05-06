import { ASSIGNMENT_ID_REGEX } from '@/lib/constants';
import { buildXlsx } from '@/lib/xlsx-utils';
import type { GradeUploadEntry, UploadMode, ChangeFilter } from '@/types';

// ========== Column Detection ==========

interface UploadableColumn {
  index: number;
  header: string;
  assignmentId: string | null; // extracted from header if present
  sampleValues: string[];
}

/**
 * Detect columns that contain numeric scores suitable for Canvas upload.
 * Uses ASSIGNMENT_ID_REGEX and feature-specific heuristics.
 */
export function detectUploadableColumns(
  headers: string[],
  rows: string[][],
  featureType: string
): UploadableColumn[] {
  const columns: UploadableColumn[] = [];

  // Feature-specific known score column patterns
  const knownPatterns: Record<string, RegExp[]> = {
    'score-mapping': [/คะแนนใหม่/, /new.?score/i],
    'edpuzzle-analysis': [/Edpuzzle Score/, /EP หลังหักสาย/, /Edpuzzle Score \(เต็ม/],
    'auto-grade': [/\[A\]$/, /\[S\]$/, /\[Q\]$/], // assignment columns with type suffix
    'grade-compare': [/คะแนนใหม่/, /new/i],
  };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;

    // Skip known non-score columns
    const skipPatterns = [
      /^Student$/i, /^ID$/i, /^SIS/, /^Integration/i, /^Section$/i,
      /^Reg Status$/i, /^สถานะ/, /^#$/, /^ชื่อ$/, /^รวม$/,
      /^Canvas:/, /^Canvas \(/, /Canvas หัก/, /Canvas สถานะ/,
      /สัดส่วน/, /จำนวนคำถาม/, /Progress/, /Completed/, /Time/i,
      /Edpuzzle Total Grade/, /^EP Time/, /^EP สถานะ/, /^EP ส่ง/,
      /^onTime$/, /จับคู่/,
    ];
    if (skipPatterns.some(p => p.test(h))) continue;

    // Check if header has an assignment ID
    const idMatch = h.match(ASSIGNMENT_ID_REGEX);
    const assignmentId = idMatch ? idMatch[1] : null;

    // Check feature-specific patterns
    const patterns = knownPatterns[featureType] || [];
    const matchesKnown = patterns.some(p => p.test(h));

    // Check if column has numeric values (>50% non-empty values are numbers)
    const values = rows.slice(0, 50).map(r => r[i] || '').filter(v => v !== '');
    const numericCount = values.filter(v => !isNaN(parseFloat(v)) && isFinite(Number(v))).length;
    const isNumeric = values.length > 0 && numericCount / values.length > 0.5;

    if (matchesKnown || assignmentId || isNumeric) {
      columns.push({
        index: i,
        header: h,
        assignmentId,
        sampleValues: values.slice(0, 5),
      });
    }
  }

  return columns;
}

/**
 * Find the column index containing SIS User IDs.
 */
export function detectStudentIdColumn(headers: string[]): number {
  const idx = headers.findIndex(h =>
    /SIS User ID/i.test(h) || /รหัสนักศึกษา/.test(h)
  );
  return idx >= 0 ? idx : -1;
}

/**
 * Find the column index containing student names.
 */
export function detectStudentNameColumn(headers: string[]): number {
  const idx = headers.findIndex(h =>
    /^Student$/i.test(h) || /^ชื่อ$/.test(h) || /^Name$/i.test(h)
  );
  return idx >= 0 ? idx : 0; // default to first column
}

// ========== Grade Extraction ==========

export interface ExtractedGrade {
  sisUserId: string;
  studentName: string;
  score: string;
}

/**
 * Extract grade data from output content.
 */
export function extractGradeData(
  headers: string[],
  rows: string[][],
  scoreColIdx: number,
  studentIdColIdx: number,
  nameColIdx: number
): ExtractedGrade[] {
  const grades: ExtractedGrade[] = [];
  for (const row of rows) {
    const sisUserId = (row[studentIdColIdx] || '').trim();
    const score = (row[scoreColIdx] || '').trim();
    const studentName = row[nameColIdx] || '';
    if (!sisUserId || score === '') continue;
    // Skip non-numeric scores
    if (isNaN(parseFloat(score))) continue;
    grades.push({ sisUserId, studentName, score });
  }
  return grades;
}

// ========== Comparison ==========

export interface CurrentCanvasScore {
  sisUserId: string;
  studentName: string;
  score: string | null;
  canvasUserId?: number;
}

/**
 * Build comparison rows between new grades and current Canvas scores.
 */
export function buildComparisonRows(
  grades: ExtractedGrade[],
  currentScores: Map<string, CurrentCanvasScore>
): GradeUploadEntry[] {
  return grades.map(g => {
    const current = currentScores.get(g.sisUserId);
    const currentScore = current?.score ?? null;
    const newVal = parseFloat(g.score);
    const curVal = currentScore !== null && currentScore !== '' ? parseFloat(currentScore) : null;

    let changeType: GradeUploadEntry['changeType'];
    if (curVal === null || currentScore === '' || currentScore === null) {
      changeType = 'blank_to_score';
    } else if (newVal > curVal) {
      changeType = 'increased';
    } else if (newVal < curVal) {
      changeType = 'decreased';
    } else if (newVal === curVal) {
      changeType = 'unchanged';
    } else {
      changeType = 'new_score';
    }

    return {
      sisUserId: g.sisUserId,
      studentName: g.studentName || current?.studentName || g.sisUserId,
      currentScore,
      newScore: g.score,
      changeType,
    };
  });
}

// ========== Filtering ==========

/**
 * Filter grades based on upload mode.
 */
export function filterGrades(
  entries: GradeUploadEntry[],
  mode: UploadMode,
  changeFilter?: ChangeFilter,
  selectedIds?: Set<string>
): GradeUploadEntry[] {
  switch (mode) {
    case 'all':
      return entries;

    case 'selected':
      return entries.filter(e => selectedIds?.has(e.sisUserId));

    case 'missing-only':
      return entries.filter(e => e.changeType === 'blank_to_score');

    case 'changed':
      return entries.filter(e => {
        if (e.changeType === 'unchanged') return false;
        if (!changeFilter || changeFilter === 'all-changed') return true;
        if (changeFilter === 'increased-only') return e.changeType === 'increased' || e.changeType === 'blank_to_score';
        if (changeFilter === 'decreased-only') return e.changeType === 'decreased';
        return true;
      });

    default:
      return entries;
  }
}

// ========== Backup ==========

/**
 * Build an XLSX buffer with current Canvas scores for backup.
 */
export function buildBackupXlsx(
  assignmentName: string,
  currentScores: Map<string, CurrentCanvasScore>
): Uint8Array {
  const headers = ['SIS User ID', 'Student', 'Score', 'Backup Timestamp'];
  const timestamp = new Date().toISOString();
  const rows = Array.from(currentScores.values()).map(s => [
    s.sisUserId,
    s.studentName,
    s.score ?? '',
    timestamp,
  ]);

  return buildXlsx(headers, rows, `Backup: ${assignmentName}`);
}

/**
 * Build an XLSX buffer with upload results log.
 */
export function buildUploadLogXlsx(
  assignmentName: string,
  entries: GradeUploadEntry[],
  results: Array<{ sisUserId: string; success: boolean; error?: string }>
): Uint8Array {
  const resultMap = new Map(results.map(r => [r.sisUserId, r]));
  const headers = [
    'SIS User ID', 'Student', 'Previous Score', 'New Score',
    'Change', 'Upload Status', 'Error',
  ];
  const rows = entries.map(e => {
    const r = resultMap.get(e.sisUserId);
    return [
      e.sisUserId,
      e.studentName,
      e.currentScore ?? '',
      e.newScore,
      e.changeType === 'increased' ? 'เพิ่มขึ้น'
        : e.changeType === 'decreased' ? 'ลดลง'
        : e.changeType === 'blank_to_score' ? 'ใหม่'
        : e.changeType === 'unchanged' ? 'ไม่เปลี่ยน'
        : e.changeType,
      r?.success ? 'สำเร็จ' : 'ล้มเหลว',
      r?.error ?? '',
    ];
  });

  return buildXlsx(headers, rows, `Upload Log: ${assignmentName}`);
}
