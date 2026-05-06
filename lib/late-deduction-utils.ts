/**
 * Utilities for calculating Canvas-style late submission deductions.
 *
 * Canvas late policy formula:
 *   intervals_late = ceil(seconds_late / interval_seconds)
 *   deduction_pct  = intervals_late * deduction_per_interval
 *   adjusted       = original * (1 - deduction_pct / 100)
 *   adjusted       = max(adjusted, original * minimum_percent / 100)
 */

// ========== Types ==========

/** Canvas course late policy (from GET /api/v1/courses/:id/late_policy) */
export interface CanvasLatePolicy {
  late_submission_deduction_enabled: boolean;
  late_submission_deduction: number;         // e.g., 10 → 10% per interval
  late_submission_interval: 'hour' | 'day';
  late_submission_minimum_percent_enabled: boolean;
  late_submission_minimum_percent: number;    // e.g., 5 → floor at 5% of original
}

/** Manual late policy fallback (when Canvas policy is unavailable) */
export interface ManualLatePolicy {
  deductionPercent: number;
  interval: 'hour' | 'day';
  minimumPercent: number;
}

/** Result of late deduction calculation */
export interface LateDeductionResult {
  originalScore: number;
  adjustedScore: number;
  secondsLate: number;
  intervalsLate: number;
  deductionPercent: number;
  isLate: boolean;
}

// ========== Timestamp Parsing ==========

/**
 * Parse an Edpuzzle "Time turned in" string into a Date.
 * Returns null for empty strings, "Not turned in", or unparseable values.
 */
export function parseEdpuzzleTimestamp(raw: string): Date | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (!lower || lower.includes('not turned in') || lower === '-') return null;

  // Try native Date parse (handles ISO 8601, US locale "Mar 5, 2026 10:30 AM", etc.)
  const d = new Date(raw.trim());
  if (!isNaN(d.getTime())) return d;

  return null;
}

// ========== Calculation ==========

/**
 * Apply Canvas-style late deduction to a score.
 *
 * @param originalScore  The pre-deduction score (0-100 percentage, or points)
 * @param submittedAt    When the student submitted (from Edpuzzle "Time turned in")
 * @param dueAt          The assignment due date (from Canvas)
 * @param policy         Canvas or manual late policy configuration
 */
export function calculateLateDeduction(
  originalScore: number,
  submittedAt: Date,
  dueAt: Date,
  policy: CanvasLatePolicy | ManualLatePolicy
): LateDeductionResult {
  // Check if deduction is enabled
  const enabled = 'late_submission_deduction_enabled' in policy
    ? policy.late_submission_deduction_enabled
    : true;

  if (!enabled) {
    return {
      originalScore,
      adjustedScore: originalScore,
      secondsLate: 0,
      intervalsLate: 0,
      deductionPercent: 0,
      isLate: false,
    };
  }

  // Extract policy parameters
  const deductionPerInterval = 'late_submission_deduction' in policy
    ? policy.late_submission_deduction
    : (policy as ManualLatePolicy).deductionPercent;

  const interval: 'hour' | 'day' = 'late_submission_interval' in policy
    ? policy.late_submission_interval
    : (policy as ManualLatePolicy).interval;

  const minimumPercent = 'late_submission_minimum_percent_enabled' in policy
    ? (policy.late_submission_minimum_percent_enabled
        ? policy.late_submission_minimum_percent
        : 0)
    : (policy as ManualLatePolicy).minimumPercent;

  // Calculate lateness
  const diffMs = submittedAt.getTime() - dueAt.getTime();
  const secondsLate = Math.max(0, Math.floor(diffMs / 1000));

  if (secondsLate === 0) {
    return {
      originalScore,
      adjustedScore: originalScore,
      secondsLate: 0,
      intervalsLate: 0,
      deductionPercent: 0,
      isLate: false,
    };
  }

  // Canvas uses ceiling: 1 second late = 1 full interval
  const intervalSeconds = interval === 'hour' ? 3600 : 86400;
  const intervalsLate = Math.ceil(secondsLate / intervalSeconds);

  // Calculate deduction (cap at 100%)
  const deductionPercent = Math.min(intervalsLate * deductionPerInterval, 100);
  const deductedScore = originalScore * (1 - deductionPercent / 100);
  const minimumScore = originalScore * (minimumPercent / 100);
  const adjustedScore = Math.max(deductedScore, minimumScore);

  return {
    originalScore,
    adjustedScore: Math.round(adjustedScore * 100) / 100,
    secondsLate,
    intervalsLate,
    deductionPercent,
    isLate: true,
  };
}
