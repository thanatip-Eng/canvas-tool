// ========== Canvas Format Constants ==========

/** Number of fixed columns before assignment columns in Canvas export */
export const CANVAS_FIXED_COLS = 6;

/** Number of fixed columns before assignment columns in Master Data
 * Columns: Student, ID, SIS User ID, SIS Login ID, Integration ID, Section, Reg Status, สถานะจับคู่ */
export const MASTER_FIXED_COLS = 8;

/** Regex to match assignment IDs in Canvas column headers e.g. "Homework 1 (12345)" */
export const ASSIGNMENT_ID_REGEX = /\((\d+)\)/;

/** Regex to extract courseCode(6) + lecSection(3) + labSection(3) from registrar filename */
export const REGISTRAR_FILENAME_REGEX = /(\d{6})(\d{3})(\d{3})$/;

/** Column patterns to exclude from Canvas assignments */
export const EXCLUDE_PATTERNS = [
  'current point', 'final point', 'current score',
  'final score', 'unposted', 'read only', 'imported assignment'
];

/** Marker for the "Points Possible" row in Canvas export */
export const POINTS_ROW_MARKER = 'point';

// ========== Status Constants ==========

export const STATUS = Object.freeze({
  MATCH: 'match',
  MATCHED: 'matched',
  NOT_FOUND: 'not_found',
  CANVAS_ONLY: 'canvas-only',
  REG_ONLY: 'reg-only',
});

export const STATUS_LABELS: Record<string, string> = {
  [STATUS.MATCH]: 'ปกติ',
  [STATUS.MATCHED]: 'จับคู่สำเร็จ',
  [STATUS.NOT_FOUND]: 'ไม่พบ',
  [STATUS.CANVAS_ONLY]: 'มีใน Canvas เท่านั้น',
  [STATUS.REG_ONLY]: 'มีในทะเบียนเท่านั้น',
};

export const STATUS_COLORS: Record<string, string> = {
  [STATUS.MATCH]: 'text-[var(--color-success)]',
  [STATUS.MATCHED]: 'text-[var(--color-success)]',
  [STATUS.NOT_FOUND]: 'text-[var(--color-danger)]',
  [STATUS.CANVAS_ONLY]: 'text-[var(--color-warning)]',
  [STATUS.REG_ONLY]: 'text-[var(--color-danger)]',
};
