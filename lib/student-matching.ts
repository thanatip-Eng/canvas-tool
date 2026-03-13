import { ParsedFile, ScoreColumns, MappingResultEntry } from '@/types';
import { STATUS } from '@/lib/constants';
import { getPointsRowStart } from '@/lib/canvas-utils';

// ========== Column Index Helpers ==========

interface CanvasColumnIndices {
  idIdx: number;
  sisIdx: number;
  emailIdx: number;
}

/**
 * Find the relevant column indices in a Canvas export file.
 * Returns indices for ID, SIS User ID, and email columns.
 */
export function findCanvasColumnIndices(headers: string[]): CanvasColumnIndices {
  const lower = headers.map((h) => (h || '').toLowerCase());
  return {
    idIdx: lower.findIndex((h) => h === 'id'),
    sisIdx: lower.findIndex((h) => h === 'sis user id' || h === 'sis login id'),
    emailIdx: lower.findIndex((h) => h.includes('email') || h === 'sis login id'),
  };
}

/**
 * Find the relevant column indices in a score/external file.
 * Returns indices for student ID and email columns.
 */
export function findScoreColumnIndices(headers: string[]): ScoreColumns {
  const lower = headers.map((h) => (h || '').toLowerCase());
  return {
    idIdx: lower.findIndex((h) => h === 'id' || h === 'student id' || h === 'sis user id'),
    emailIdx: lower.findIndex((h) => h.includes('email') || h === 'sis login id'),
  };
}

// ========== Score Lookup ==========

interface ScoreLookup {
  emailMap: Map<string, string[]>;
  idMap: Map<string, string[]>;
}

/**
 * Build O(1) lookup maps from score file rows.
 * Creates two maps:
 * - emailMap: lowercase email -> row data
 * - idMap: student ID -> row data
 * First occurrence wins (duplicates are ignored).
 */
export function buildScoreLookup(scoreRows: string[][], scoreCols: ScoreColumns): ScoreLookup {
  const emailMap = new Map<string, string[]>();
  const idMap = new Map<string, string[]>();

  scoreRows.forEach((sRow) => {
    const email = (sRow[scoreCols.emailIdx] || '').toLowerCase().trim();
    const id = (sRow[scoreCols.idIdx] || '').trim();
    if (email && !emailMap.has(email)) emailMap.set(email, sRow);
    if (id && !idMap.has(id)) idMap.set(id, sRow);
  });

  return { emailMap, idMap };
}

// ========== Student Matching ==========

/**
 * Match Canvas students to score file students using O(n+m) algorithm.
 * Priority: Email match > ID match.
 *
 * @param canvasData - Parsed Canvas gradebook export
 * @param scoreData - Parsed external score file
 * @param assignmentIdx - Column index of the target assignment in Canvas
 * @param mode - 'score' to use the score column value, 'attend' to use attendScore
 * @param scoreColIdx - Column index in score file to pull the score from
 * @param attendScore - Fixed score to assign when mode is 'attend'
 * @returns Array of mapping result entries, one per Canvas student
 */
export function performStudentMatching(
  canvasData: ParsedFile,
  scoreData: ParsedFile,
  assignmentIdx: number,
  mode: 'score' | 'attend',
  scoreColIdx: number,
  attendScore: string
): MappingResultEntry[] {
  const canvasCols = findCanvasColumnIndices(canvasData.headers);
  const scoreCols = findScoreColumnIndices(scoreData.headers);
  const { emailMap, idMap } = buildScoreLookup(scoreData.rows, scoreCols);

  const startRow = getPointsRowStart(canvasData.rows);

  return canvasData.rows.slice(startRow).map((cRow, ri) => {
    const name = cRow[0] || '';
    const cId = (cRow[canvasCols.idIdx] || '').trim();
    const cSis = (cRow[canvasCols.sisIdx] || '').trim();
    const cEmail = (cRow[canvasCols.emailIdx] || '').toLowerCase().trim();

    let newScore: string | null = null;
    let matchedBy = '';

    // Priority: Email > ID (O(1) lookup via Map)
    const emailMatch = cEmail ? emailMap.get(cEmail) : undefined;
    if (emailMatch) {
      matchedBy = 'email';
      newScore = mode === 'score' ? (emailMatch[scoreColIdx] || '') : attendScore;
    } else {
      const idMatch = idMap.get(cId) || idMap.get(cSis);
      if (idMatch) {
        matchedBy = 'id';
        newScore = mode === 'score' ? (idMatch[scoreColIdx] || '') : attendScore;
      }
    }

    const existingScore = (cRow[assignmentIdx] || '').trim();

    return {
      rowIndex: ri + startRow,
      canvasName: name,
      canvasId: cId || cSis,
      canvasEmail: cRow[canvasCols.emailIdx] || '',
      status: newScore !== null ? STATUS.MATCHED : STATUS.NOT_FOUND,
      matchedScore: newScore ?? undefined,
      matchedBy: matchedBy || undefined,
      canvasScore: existingScore || undefined,
    };
  });
}
