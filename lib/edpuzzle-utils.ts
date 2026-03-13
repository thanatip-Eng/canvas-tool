/**
 * Utilities for parsing and analyzing Edpuzzle playlist score exports.
 *
 * Edpuzzle exports have this column structure:
 * - Fixed columns (0-8): Role, Last name, First name, Username, Total grade,
 *   Total time spent, Progress (out of N) (%), Time turned in, On time?
 * - Per-clip columns (repeating 4 per clip):
 *   (x of N) Grade, (x of N) Video watched (%), (x of N) Time spent, (x of N) Time turned in
 *
 * Student ID is derived from the first 9 characters of the "First name" column.
 */

import { ParsedFile } from '@/types';

// ========== Constants ==========

const EDPUZZLE_FIXED_COLS = 9;
const COLS_PER_CLIP = 4;

// ========== Types ==========

export interface EdpuzzleClip {
  index: number;        // 1-based clip number
  totalClips: number;   // N
  hasGrades: boolean;   // true if at least one student has a non-empty grade for this clip
  questionCount: number; // user-provided; 0 = no embedded questions
}

export interface EdpuzzleStudent {
  studentId: string;       // First 9 chars of First name (= SIS User ID)
  firstName: string;       // Full First name field (includes ID prefix)
  lastName: string;
  totalGrade: string;      // Edpuzzle's own total grade (may be empty)
  progress: number;        // 0-100 (percentage)
  totalClips: number;      // N
  onTime: string;          // "Not turned in" or date text
  clipGrades: (number | null)[]; // Grade per clip (null = not attempted/no grade)
}

export interface EdpuzzleParsed {
  totalClips: number;
  clips: EdpuzzleClip[];
  students: EdpuzzleStudent[];
  rawHeaders: string[];
}

// ========== Parsing ==========

/**
 * Parse an Edpuzzle file that was already parsed into ParsedFile format.
 * Handles both CSV and XLSX variants.
 */
export function parseEdpuzzleData(data: ParsedFile): EdpuzzleParsed {
  const headers = data.headers;

  // Detect total clips (N) from "Progress (out of N) (%)" header
  const progressHeader = headers.find(h => /progress\s*\(out of\s+\d+\)/i.test(h));
  const nMatch = progressHeader?.match(/out of\s+(\d+)/i);
  const totalClips = nMatch ? parseInt(nMatch[1], 10) : 0;

  if (totalClips === 0) {
    throw new Error('ไม่พบจำนวนคลิปในไฟล์ — ไม่ใช่ไฟล์ Edpuzzle export');
  }

  // Find column indices for fixed fields
  const hLower = headers.map(h => (h || '').toLowerCase().trim());
  const roleIdx = hLower.findIndex(h => h === 'role');
  const lastNameIdx = hLower.findIndex(h => h.includes('last name'));
  const firstNameIdx = hLower.findIndex(h => h.includes('first name'));
  const totalGradeIdx = hLower.findIndex(h => h === 'total grade');
  const progressIdx = hLower.findIndex(h => h.includes('progress'));
  const onTimeIdx = hLower.findIndex(h => h.includes('on time'));

  // Build clip metadata
  // Each clip has 4 columns starting at EDPUZZLE_FIXED_COLS + (clipIdx * 4)
  const clips: EdpuzzleClip[] = [];
  for (let i = 0; i < totalClips; i++) {
    clips.push({
      index: i + 1,
      totalClips,
      hasGrades: false, // will be updated after parsing students
      questionCount: 0,  // user will set this
    });
  }

  // Parse students
  const students: EdpuzzleStudent[] = [];
  for (const row of data.rows) {
    // Skip non-student rows
    const role = (row[roleIdx] || '').trim().toLowerCase();
    if (role !== 'student') continue;

    const firstName = (row[firstNameIdx] || '').trim();
    const lastName = (row[lastNameIdx] || '').trim();
    const studentId = firstName.substring(0, 9).trim();

    const totalGrade = (row[totalGradeIdx] || '').trim();
    const progressVal = parseFloat((row[progressIdx] || '0').trim()) || 0;
    const onTime = (row[onTimeIdx] || '').trim();

    // Extract per-clip grades
    const clipGrades: (number | null)[] = [];
    for (let c = 0; c < totalClips; c++) {
      const gradeColIdx = EDPUZZLE_FIXED_COLS + c * COLS_PER_CLIP;
      const gradeStr = (row[gradeColIdx] || '').trim();
      if (gradeStr === '' || gradeStr === '-') {
        clipGrades.push(null);
      } else {
        const val = parseFloat(gradeStr);
        clipGrades.push(isNaN(val) ? null : val);
        if (!isNaN(val)) {
          clips[c].hasGrades = true;
        }
      }
    }

    students.push({
      studentId,
      firstName,
      lastName,
      totalGrade,
      progress: progressVal,
      totalClips,
      onTime,
      clipGrades,
    });
  }

  return { totalClips, clips, students, rawHeaders: headers };
}

/**
 * Validate that a parsed file looks like an Edpuzzle export.
 */
export function validateEdpuzzleFile(data: ParsedFile): boolean {
  const hLower = data.headers.map(h => (h || '').toLowerCase().trim());
  const hasRole = hLower.some(h => h === 'role');
  const hasProgress = hLower.some(h => h.includes('progress') && h.includes('out of'));
  const hasGrade = hLower.some(h => h.includes('grade'));
  return hasRole && hasProgress && hasGrade;
}

// ========== Score Calculation ==========

/**
 * Calculate the weighted Edpuzzle score for a student.
 *
 * Formula: Σ(grade_i × questions_i) / Σ(questions_i)
 *
 * Only clips with questionCount > 0 are included in the calculation.
 * Returns null if no clips have questions or all grades are null.
 */
export function calculateWeightedScore(
  clipGrades: (number | null)[],
  clips: EdpuzzleClip[]
): number | null {
  let totalWeightedScore = 0;
  let totalQuestions = 0;

  for (let i = 0; i < clips.length; i++) {
    const qCount = clips[i].questionCount;
    if (qCount <= 0) continue; // Skip clips with no questions

    const grade = clipGrades[i];
    if (grade !== null) {
      totalWeightedScore += grade * qCount;
    }
    // Even if grade is null (not attempted), still count questions toward denominator
    totalQuestions += qCount;
  }

  if (totalQuestions === 0) return null;
  return totalWeightedScore / totalQuestions;
}

/**
 * Count how many clips a student has completed (non-null grade).
 */
export function countCompletedClips(clipGrades: (number | null)[]): number {
  return clipGrades.filter(g => g !== null).length;
}

// ========== File Parsing Helper ==========

/**
 * Parse an Edpuzzle file (which may have a broken extension or no extension).
 * Tries CSV parsing first, then falls back to XLSX.
 */
export function parseEdpuzzleFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // Try reading as text first (CSV)
    reader.onload = (e) => {
      const text = e.target?.result as string;
      // Check if it looks like CSV (has quotes and commas)
      if (text && (text.startsWith('"') || text.startsWith('\uFEFF"') || text.includes('","'))) {
        // Parse as CSV
        const cleanText = text.replace(/^\uFEFF/, ''); // Remove BOM if present
        const lines = cleanText.split(/\r?\n/).map(line => {
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
          rows: lines.slice(1).filter(r => r.some(c => c)),
        });
      } else {
        // Try as XLSX
        const xlsxReader = new FileReader();
        xlsxReader.onload = async (xe) => {
          try {
            const XLSX = await import('xlsx');
            const data = new Uint8Array(xe.target?.result as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            resolve({
              headers: (json[0] || []).map(h => h?.toString() || ''),
              rows: json.slice(1).map(r => r.map(c => c?.toString() || '')),
            });
          } catch {
            reject(new Error('ไม่สามารถอ่านไฟล์ Edpuzzle ได้ — รูปแบบไฟล์ไม่ถูกต้อง'));
          }
        };
        xlsxReader.onerror = () => reject(xlsxReader.error);
        xlsxReader.readAsArrayBuffer(file);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'UTF-8');
  });
}
