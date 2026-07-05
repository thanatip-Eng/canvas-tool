import type { ParsedFile } from '@/types';

// ========== MS Form parsing ==========

export interface AttendanceForm {
  emailCol: number;
  timeCol: number;      // -1 if not detected
  entries: Map<string, string>; // lowercased email -> submission time raw string
  droppedRowIndices: number[]; // rows skipped because email was missing/invalid
}

/**
 * Detect email + submission-time columns in a MS Form Excel export.
 * MS Form typically emits: ID, Start time, Completion time, Email, Name, ...questions.
 * Falls back to scanning values for an @ pattern if header names don't match.
 */
export function detectMsFormColumns(file: ParsedFile): { emailCol: number; timeCol: number } {
  const lower = file.headers.map(h => (h || '').toLowerCase().trim());

  const emailByHeader = lower.findIndex(h =>
    h === 'email' ||
    h === 'อีเมล' ||
    h.includes('email address') ||
    h.startsWith('email')
  );

  let emailCol = emailByHeader;
  if (emailCol < 0) {
    // Fall back: first column whose sample rows contain an @
    const sampleSize = Math.min(20, file.rows.length);
    for (let c = 0; c < file.headers.length; c++) {
      let atCount = 0;
      for (let r = 0; r < sampleSize; r++) {
        if ((file.rows[r]?.[c] || '').includes('@')) atCount++;
      }
      if (atCount > sampleSize / 2) { emailCol = c; break; }
    }
  }

  const timeCol = lower.findIndex(h =>
    h === 'completion time' ||
    h === 'submission time' ||
    h === 'submitted' ||
    h === 'time' ||
    h === 'end time' ||
    h.includes('เวลาส่ง') ||
    h.includes('เวลาที่ส่ง')
  );

  return { emailCol, timeCol };
}

export function parseAttendanceForm(file: ParsedFile): AttendanceForm {
  const { emailCol, timeCol } = detectMsFormColumns(file);
  const entries = new Map<string, string>();
  const droppedRowIndices: number[] = [];
  if (emailCol < 0) return { emailCol, timeCol, entries, droppedRowIndices };

  file.rows.forEach((row, idx) => {
    const email = (row[emailCol] || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      // Track only rows that had *some* content so we don't flag pure blank rows
      if (row.some(c => (c || '').trim() !== '')) droppedRowIndices.push(idx);
      return;
    }
    // If duplicate submissions, keep the earliest (or first seen when no time col)
    const time = timeCol >= 0 ? (row[timeCol] || '').trim() : '';
    if (!entries.has(email)) {
      entries.set(email, time);
    } else if (time && entries.get(email)) {
      const prev = parseFormTime(entries.get(email)!);
      const curr = parseFormTime(time);
      if (prev && curr && curr < prev) entries.set(email, time);
    }
  });

  return { emailCol, timeCol, entries, droppedRowIndices };
}

/**
 * Parse a MS Form time string into a Date, tolerating common formats.
 * Returns null if the string is empty or unparseable.
 */
export function parseFormTime(s: string): Date | null {
  const raw = (s || '').trim();
  if (!raw) return null;
  // Try native parsing first (handles ISO 8601 + most locale strings)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  // Try Excel serial number
  const n = Number(raw);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    // Excel serial: days since 1899-12-30
    const ms = (n - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  return null;
}

// ========== Scoring rules ==========

export interface AttendanceScoreRule {
  bothScore: number;
  checkInOnlyScore: number;
  checkOutOnlyScore: number;
  neitherScore: number;
  /** ISO datetime string. If set, check-in submissions later than this count as missing. */
  checkInCutoff?: string;
  /** ISO datetime string. If set, check-out submissions earlier than this count as missing. */
  checkOutEarliest?: string;
}

export const DEFAULT_ATTENDANCE_RULE: AttendanceScoreRule = {
  bothScore: 1,
  checkInOnlyScore: 0.5,
  checkOutOnlyScore: 0.5,
  neitherScore: 0,
};

export type AttendanceReason =
  | 'both'          // both check-in + check-out valid
  | 'checkInOnly'   // only check-in valid; check-out never submitted
  | 'checkOutOnly'  // only check-out valid; check-in never submitted
  | 'absent'        // neither submitted at all
  | 'bothInvalid';  // both submitted but both violated timing windows

export interface AttendanceEval {
  email: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInSubmitted: boolean;
  checkOutSubmitted: boolean;
  checkInValid: boolean;
  checkOutValid: boolean;
  score: number;
  reason: AttendanceReason;
  /** Human-readable notes surfaced in UI (e.g. "check-in ผ่านเวลา"). */
  notes: string[];
}

type WindowStatus = 'valid' | 'out-of-window';

function checkWindow(rawTime: string, cutoff: string | undefined, kind: 'in' | 'out'): WindowStatus {
  if (!cutoff) return 'valid';
  const submitted = parseFormTime(rawTime);
  const limit = parseFormTime(cutoff);
  if (!submitted || !limit) return 'valid'; // Fail-open when we can't parse
  const withinWindow = kind === 'in' ? submitted <= limit : submitted >= limit;
  return withinWindow ? 'valid' : 'out-of-window';
}

/**
 * Merge a check-in form + check-out form into per-email attendance evals.
 * Emits an eval for every email that appeared in either form.
 */
export function evaluateAttendance(
  checkInForm: AttendanceForm,
  checkOutForm: AttendanceForm,
  rule: AttendanceScoreRule
): AttendanceEval[] {
  const allEmails = new Set<string>([
    ...checkInForm.entries.keys(),
    ...checkOutForm.entries.keys(),
  ]);

  const out: AttendanceEval[] = [];
  for (const email of allEmails) {
    const inTime = checkInForm.entries.get(email);
    const outTime = checkOutForm.entries.get(email);
    const inSubmitted = inTime !== undefined;
    const outSubmitted = outTime !== undefined;
    const inWindow = inSubmitted ? checkWindow(inTime!, rule.checkInCutoff, 'in') : 'valid';
    const outWindow = outSubmitted ? checkWindow(outTime!, rule.checkOutEarliest, 'out') : 'valid';
    const inValid = inSubmitted && inWindow === 'valid';
    const outValid = outSubmitted && outWindow === 'valid';

    const notes: string[] = [];
    if (inSubmitted && inWindow === 'out-of-window') notes.push('check-in ผ่านเวลาที่กำหนด');
    if (outSubmitted && outWindow === 'out-of-window') notes.push('check-out ก่อนเวลาที่กำหนด');

    let score: number;
    let reason: AttendanceReason;
    if (inValid && outValid) { score = rule.bothScore; reason = 'both'; }
    else if (inValid && !outSubmitted) { score = rule.checkInOnlyScore; reason = 'checkInOnly'; }
    else if (outValid && !inSubmitted) { score = rule.checkOutOnlyScore; reason = 'checkOutOnly'; }
    else if (inValid) { score = rule.checkInOnlyScore; reason = 'checkInOnly'; }
    else if (outValid) { score = rule.checkOutOnlyScore; reason = 'checkOutOnly'; }
    else if (inSubmitted || outSubmitted) { score = rule.neitherScore; reason = 'bothInvalid'; }
    else { score = rule.neitherScore; reason = 'absent'; }

    out.push({
      email,
      checkInTime: inTime ?? null,
      checkOutTime: outTime ?? null,
      checkInSubmitted: inSubmitted,
      checkOutSubmitted: outSubmitted,
      checkInValid: inValid,
      checkOutValid: outValid,
      score,
      reason,
      notes,
    });
  }

  return out.sort((a, b) => a.email.localeCompare(b.email));
}

// ========== Canvas matching ==========

/** Find the email column in a Canvas gradebook export. */
export function findCanvasEmailCol(headers: string[]): number {
  const lower = headers.map(h => (h || '').toLowerCase());
  const loginIdx = lower.findIndex(h => h === 'sis login id');
  if (loginIdx >= 0) return loginIdx;
  return lower.findIndex(h => h.includes('email'));
}

export type MatchReason = AttendanceReason | 'unmatched';

export interface AttendanceMatchRow {
  canvasName: string;
  canvasId: string;
  canvasEmail: string;
  matched: boolean;
  checkInTime: string | null;
  checkOutTime: string | null;
  score: number | null;
  reason: MatchReason;
  notes: string[];
  rowIndex: number;
}

export interface FormOnlyEmail {
  email: string;
  inCheckIn: boolean;
  inCheckOut: boolean;
}

export interface AttendanceMatchResult {
  rows: AttendanceMatchRow[];
  /** Emails present in either MS Form but with no matching Canvas student. */
  formOnlyEmails: FormOnlyEmail[];
}

/**
 * Match Canvas students against attendance evals by email.
 * Canvas rows without a matching email get null score + 'unmatched' reason.
 * Also emits Form emails that have no Canvas counterpart so the UI can flag them.
 */
export function matchAttendanceToCanvas(
  canvasData: ParsedFile,
  evals: AttendanceEval[],
  checkInEmails: Set<string>,
  checkOutEmails: Set<string>,
): AttendanceMatchResult {
  const emailCol = findCanvasEmailCol(canvasData.headers);
  const evalMap = new Map(evals.map(e => [e.email.toLowerCase(), e]));
  const canvasEmails = new Set<string>();

  const rows: AttendanceMatchRow[] = canvasData.rows.map((row, idx) => {
    const canvasEmail = (row[emailCol] || '').toLowerCase().trim();
    if (canvasEmail) canvasEmails.add(canvasEmail);
    const evalRow = canvasEmail ? evalMap.get(canvasEmail) : undefined;
    return {
      canvasName: row[0] || '',
      canvasId: row[1] || '',
      canvasEmail: row[emailCol] || '',
      matched: !!evalRow,
      checkInTime: evalRow?.checkInTime ?? null,
      checkOutTime: evalRow?.checkOutTime ?? null,
      score: evalRow ? evalRow.score : null,
      reason: evalRow ? evalRow.reason : 'unmatched',
      notes: evalRow?.notes ?? [],
      rowIndex: idx,
    };
  });

  const formOnlyEmails: FormOnlyEmail[] = [];
  const allFormEmails = new Set<string>([...checkInEmails, ...checkOutEmails]);
  for (const email of allFormEmails) {
    if (canvasEmails.has(email)) continue;
    formOnlyEmails.push({
      email,
      inCheckIn: checkInEmails.has(email),
      inCheckOut: checkOutEmails.has(email),
    });
  }
  formOnlyEmails.sort((a, b) => a.email.localeCompare(b.email));

  return { rows, formOnlyEmails };
}
