import { ParsedFile, ScoreColumns, MappingResultEntry, StudentMatchingResult, ExternalOrphan, UnmatchReason } from '@/types';
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

interface ScoreLookupEntry {
  row: string[];
  externalRowIndex: number;
}

interface ScoreLookup {
  emailMap: Map<string, ScoreLookupEntry>;
  idMap: Map<string, ScoreLookupEntry>;
}

/**
 * Build O(1) lookup maps from score file rows.
 * Creates two maps:
 * - emailMap: lowercase email -> row data + original index
 * - idMap: student ID -> row data + original index
 * First occurrence wins (duplicates are ignored).
 */
export function buildScoreLookup(scoreRows: string[][], scoreCols: ScoreColumns): ScoreLookup {
  const emailMap = new Map<string, ScoreLookupEntry>();
  const idMap = new Map<string, ScoreLookupEntry>();

  scoreRows.forEach((sRow, externalRowIndex) => {
    const email = (sRow[scoreCols.emailIdx] || '').toLowerCase().trim();
    const id = (sRow[scoreCols.idIdx] || '').trim();
    const entry: ScoreLookupEntry = { row: sRow, externalRowIndex };
    if (email && !emailMap.has(email)) emailMap.set(email, entry);
    if (id && !idMap.has(id)) idMap.set(id, entry);
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
): StudentMatchingResult {
  const canvasCols = findCanvasColumnIndices(canvasData.headers);
  const scoreCols = findScoreColumnIndices(scoreData.headers);
  const lookup = buildScoreLookup(scoreData.rows, scoreCols);
  const { emailMap, idMap } = lookup;
  const consumedRows = new Set<number>();

  const startRow = getPointsRowStart(canvasData.rows);

  const entries: MappingResultEntry[] = canvasData.rows.slice(startRow).map((cRow, ri) => {
    const name = cRow[0] || '';
    const cId = (cRow[canvasCols.idIdx] || '').trim();
    const cSis = (cRow[canvasCols.sisIdx] || '').trim();
    const cEmail = (cRow[canvasCols.emailIdx] || '').toLowerCase().trim();

    let matchedRow: string[] | null = null;
    let matchedBy = '';

    // Priority: Email > ID (O(1) lookup via Map)
    const emailMatch = cEmail ? emailMap.get(cEmail) : undefined;
    if (emailMatch) {
      matchedBy = 'email';
      matchedRow = emailMatch.row;
      consumedRows.add(emailMatch.externalRowIndex);
    } else {
      const idMatch = idMap.get(cId) || idMap.get(cSis);
      if (idMatch) {
        matchedBy = 'id';
        matchedRow = idMatch.row;
        consumedRows.add(idMatch.externalRowIndex);
      }
    }

    const existingScore = (cRow[assignmentIdx] || '').trim();
    const base: MappingResultEntry = {
      rowIndex: ri + startRow,
      canvasName: name,
      canvasId: cId || cSis,
      canvasEmail: cRow[canvasCols.emailIdx] || '',
      status: STATUS.NOT_FOUND,
      canvasScore: existingScore || undefined,
    };

    if (!matchedRow) {
      return { ...base, unmatchReason: 'external-missing' as UnmatchReason };
    }

    let newScore: string;
    let unmatchReason: UnmatchReason | undefined;

    if (mode === 'attend') {
      newScore = attendScore;
    } else {
      const raw = (matchedRow[scoreColIdx] || '').trim();
      if (raw === '') {
        unmatchReason = 'external-blank';
        newScore = '';
      } else if (isNaN(parseFloat(raw))) {
        unmatchReason = 'external-nonnumeric';
        newScore = raw;
      } else {
        newScore = raw;
      }
    }

    return {
      ...base,
      status: unmatchReason ? STATUS.NOT_FOUND : STATUS.MATCHED,
      matchedScore: unmatchReason ? undefined : newScore,
      matchedBy,
      unmatchReason,
    };
  });

  // Compute orphans: external rows that were never consumed (and have some identifier)
  const orphans: ExternalOrphan[] = [];
  scoreData.rows.forEach((sRow, idx) => {
    if (consumedRows.has(idx)) return;
    const email = (sRow[scoreCols.emailIdx] || '').trim();
    const id = (sRow[scoreCols.idIdx] || '').trim();
    if (!email && !id) return; // skip rows with no identifier at all
    const score = scoreColIdx >= 0 ? (sRow[scoreColIdx] || '').trim() : '';
    orphans.push({ externalRowIndex: idx, email, id, score });
  });

  return { entries, orphans };
}
