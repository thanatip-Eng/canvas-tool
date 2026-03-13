import { ParsedFile, AssignmentInfo } from '@/types';
import {
  CANVAS_FIXED_COLS,
  ASSIGNMENT_ID_REGEX,
  EXCLUDE_PATTERNS,
  POINTS_ROW_MARKER,
} from '@/lib/constants';

/**
 * Validate that a parsed file looks like a Canvas gradebook export.
 * Checks that the first column header is "student" and the second or third
 * column contains "id" or "sis".
 */
export function validateCanvasFile(data: ParsedFile): boolean {
  const headers = data.headers.map((h) => (h || '').toLowerCase());
  return headers[0] === 'student' && (headers[1] === 'id' || headers[2]?.includes('sis'));
}

/**
 * Determine the starting row index for student data, skipping the
 * "Points Possible" row if present.
 * Returns 1 if the first row starts with the points marker, otherwise 0.
 */
export function getPointsRowStart(rows: string[][]): number {
  return rows[0]?.[0]?.toLowerCase().includes(POINTS_ROW_MARKER) ? 1 : 0;
}

/**
 * Extract assignment columns from Canvas export headers.
 * Skips the first CANVAS_FIXED_COLS columns (Student, ID, SIS User ID, etc.)
 * and filters out excluded patterns (e.g. "current score", "final point").
 *
 * Each returned AssignmentInfo includes:
 * - index: the column index in the original headers
 * - name: the full header text
 * - id: the assignment ID extracted from parentheses, or empty string
 */
export function extractAssignments(headers: string[]): AssignmentInfo[] {
  const assignments: AssignmentInfo[] = [];
  headers.forEach((h, i) => {
    if (i >= CANVAS_FIXED_COLS && h) {
      const lower = h.toLowerCase();
      const isExcluded = EXCLUDE_PATTERNS.some((p) => lower.includes(p));
      const idMatch = h.match(ASSIGNMENT_ID_REGEX);
      const hasAssignmentId = ASSIGNMENT_ID_REGEX.test(h);

      if (!isExcluded && (hasAssignmentId || (!lower.includes('point') && !lower.includes('score')))) {
        assignments.push({
          index: i,
          name: h,
          id: idMatch ? idMatch[1] : '',
        });
      }
    }
  });
  return assignments;
}
