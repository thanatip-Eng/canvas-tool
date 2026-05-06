/**
 * Utility functions for Auto-Grading feature.
 *
 * Fetches Canvas assignments + submissions, categorizes them as:
 *   - auto: quiz/external tool — use Canvas score directly
 *   - quiz_mixed: quiz with file upload questions — Canvas auto-score + full marks for file uploads
 *   - submission: online upload/text — full marks if submitted, late penalty if late
 *
 * Generates Canvas-importable CSV.
 */

import {
  calculateLateDeduction,
  type CanvasLatePolicy,
  type LateDeductionResult,
} from '@/lib/late-deduction-utils';

// ========== Types ==========

export type GradingType = 'auto' | 'submission' | 'quiz_mixed';

export interface AutoGradeAssignment {
  id: number;
  name: string;
  pointsPossible: number;
  dueAt: string | null;
  gradingType: GradingType;
  submissionTypes: string[];
  published: boolean;
  /** For quiz_mixed: info about file upload questions */
  fileUploadQuestions?: QuizFileUploadQuestion[];
}

export interface QuizFileUploadQuestion {
  questionId: number;
  questionName: string;
  pointsPossible: number;
}

export interface AutoGradeStudent {
  userId: number;
  name: string;
  sortableName: string;
  sisUserId: string;
  loginId: string;
  section: string;
  scores: Map<number, AutoGradeScore>; // assignmentId → score
}

export interface AutoGradeScore {
  assignmentId: number;
  originalScore: number | null;
  adjustedScore: number;
  pointsPossible: number;
  submitted: boolean;
  late: boolean;
  secondsLate: number;
  deductionInfo?: LateDeductionResult;
  status: 'graded' | 'on_time' | 'late' | 'missing';
  /** For quiz_mixed: breakdown of how score was computed */
  quizBreakdown?: {
    autoScore: number;
    fileUploadScore: number;
  };
}

export interface AutoGradeResult {
  assignments: AutoGradeAssignment[];
  students: AutoGradeStudent[];
  latePolicy: CanvasLatePolicy | null;
  stats: {
    totalStudents: number;
    totalAssignments: number;
    autoGradedCount: number;
    submissionCount: number;
    quizMixedCount: number;
  };
}

/** Raw Canvas submission from API */
export interface CanvasSubmission {
  id: number;
  user_id: number;
  assignment_id: number;
  workflow_state: string;
  submitted_at: string | null;
  score: number | null;
  grade: string | null;
  late: boolean;
  missing: boolean;
  seconds_late: number;
  user?: {
    id: number;
    name: string;
    sortable_name: string;
    sis_user_id: string | null;
    login_id: string | null;
  };
}

/** Raw Canvas assignment from API */
export interface CanvasAssignmentRaw {
  id: number;
  name: string;
  points_possible: number | null;
  due_at: string | null;
  submission_types: string[];
  is_quiz_assignment: boolean;
  is_quiz_lti_assignment: boolean;
  is_new_quiz?: boolean;
  quiz_id?: number;
  published: boolean;
  external_tool_tag_attributes?: { url?: string };
}

/** Quiz question from Canvas API */
export interface CanvasQuizQuestion {
  id: number;
  question_name: string;
  question_type: string;
  points_possible: number;
}

/** Quiz submission from Canvas API (includes submission_data per question) */
export interface CanvasQuizSubmission {
  id: number;
  user_id: number;
  score: number | null;
  kept_score: number | null;
  workflow_state: string;
  submission_history?: {
    submission_data?: CanvasQuizSubmissionAnswer[];
  }[];
}

/** Per-question answer in quiz submission */
export interface CanvasQuizSubmissionAnswer {
  question_id: number;
  correct: boolean | string | null;
  points: number;
  text?: string;
  attachment_ids?: number[];
}

/** Quiz info passed from API route */
export interface QuizInfo {
  questions: CanvasQuizQuestion[];
  quizSubmissions: CanvasQuizSubmission[];
}

// ========== Assignment Categorization ==========

/**
 * Determine assignment grading type.
 * If quizInfo is provided and the quiz has file upload questions → 'quiz_mixed'.
 */
export function categorizeAssignment(
  a: CanvasAssignmentRaw,
  quizInfo?: QuizInfo
): GradingType {
  const isQuiz =
    a.is_quiz_assignment ||
    a.is_quiz_lti_assignment ||
    a.is_new_quiz ||
    a.submission_types.includes('online_quiz');

  const isExternalQuiz =
    a.submission_types.includes('external_tool') &&
    a.external_tool_tag_attributes?.url?.includes('quiz');

  if (isQuiz || isExternalQuiz) {
    // Check if quiz has file upload questions
    if (quizInfo && quizInfo.questions.length > 0) {
      const hasFileUpload = quizInfo.questions.some(
        (q) => q.question_type === 'file_upload_question'
      );
      if (hasFileUpload) return 'quiz_mixed';
    }
    return 'auto';
  }

  return 'submission';
}

// ========== Score Computation ==========

/**
 * Compute score for a submission-based assignment.
 */
export function computeSubmissionScore(
  submission: CanvasSubmission,
  pointsPossible: number,
  dueAt: string | null,
  latePolicy: CanvasLatePolicy | null
): AutoGradeScore {
  const isSubmitted =
    submission.workflow_state === 'submitted' ||
    submission.workflow_state === 'graded' ||
    submission.workflow_state === 'pending_review' ||
    (submission.workflow_state !== 'unsubmitted' &&
      !submission.missing &&
      !!submission.submitted_at);

  const base: Omit<AutoGradeScore, 'adjustedScore' | 'status' | 'deductionInfo'> = {
    assignmentId: submission.assignment_id,
    originalScore: null,
    pointsPossible,
    submitted: isSubmitted,
    late: submission.late,
    secondsLate: submission.seconds_late || 0,
  };

  if (!isSubmitted) {
    return { ...base, adjustedScore: 0, status: 'missing' };
  }

  if (!submission.late || submission.seconds_late <= 0) {
    return {
      ...base,
      originalScore: pointsPossible,
      adjustedScore: pointsPossible,
      status: 'on_time',
    };
  }

  if (latePolicy && dueAt && submission.submitted_at) {
    const result = calculateLateDeduction(
      pointsPossible,
      new Date(submission.submitted_at),
      new Date(dueAt),
      latePolicy
    );
    return {
      ...base,
      originalScore: pointsPossible,
      adjustedScore: result.adjustedScore,
      deductionInfo: result,
      status: 'late',
    };
  }

  return {
    ...base,
    originalScore: pointsPossible,
    adjustedScore: pointsPossible,
    status: 'late',
  };
}

/**
 * Compute score for a purely auto-graded assignment (Canvas score directly).
 */
export function computeAutoScore(
  submission: CanvasSubmission,
  pointsPossible: number
): AutoGradeScore {
  const score = submission.score ?? 0;
  return {
    assignmentId: submission.assignment_id,
    originalScore: score,
    adjustedScore: score,
    pointsPossible,
    submitted:
      submission.workflow_state !== 'unsubmitted' && !!submission.submitted_at,
    late: submission.late,
    secondsLate: submission.seconds_late || 0,
    status: submission.score != null ? 'graded' : 'missing',
  };
}

/**
 * Compute score for a quiz with mixed question types (auto-graded + file upload).
 *
 * - Auto-graded questions: keep Canvas score
 * - File upload questions: full marks if file was uploaded
 *
 * Canvas quiz submission `submission_data` has per-question answers.
 * For file upload questions, `attachment_ids` being non-empty means a file was uploaded.
 */
export function computeQuizMixedScore(
  submission: CanvasSubmission,
  pointsPossible: number,
  fileUploadQuestions: QuizFileUploadQuestion[],
  quizSubmission: CanvasQuizSubmission | undefined
): AutoGradeScore {
  const isSubmitted =
    submission.workflow_state === 'submitted' ||
    submission.workflow_state === 'graded' ||
    submission.workflow_state === 'pending_review' ||
    (submission.workflow_state !== 'unsubmitted' &&
      !submission.missing &&
      !!submission.submitted_at);

  if (!isSubmitted) {
    return {
      assignmentId: submission.assignment_id,
      originalScore: null,
      adjustedScore: 0,
      pointsPossible,
      submitted: false,
      late: submission.late,
      secondsLate: submission.seconds_late || 0,
      status: 'missing',
    };
  }

  // Start with Canvas auto-graded score
  const autoScore = submission.score ?? 0;

  // Calculate file upload bonus
  let fileUploadScore = 0;
  const fileUploadQIds = new Set(fileUploadQuestions.map((q) => q.questionId));

  if (quizSubmission) {
    // Get the latest submission_data from submission_history
    const history = quizSubmission.submission_history || [];
    const lastAttempt = history[history.length - 1];
    const submissionData = lastAttempt?.submission_data || [];

    for (const answer of submissionData) {
      if (fileUploadQIds.has(answer.question_id)) {
        // File upload question: check if file was uploaded
        const hasFile =
          (answer.attachment_ids && answer.attachment_ids.length > 0) ||
          (answer.text && answer.text.trim().length > 0);
        if (hasFile) {
          const q = fileUploadQuestions.find(
            (fq) => fq.questionId === answer.question_id
          );
          if (q) fileUploadScore += q.pointsPossible;
        }
      }
    }
  } else {
    // No quiz submission data — if student submitted the quiz, assume
    // they uploaded files for file upload questions (give full marks)
    for (const q of fileUploadQuestions) {
      fileUploadScore += q.pointsPossible;
    }
  }

  const totalScore = autoScore + fileUploadScore;
  const clampedScore = Math.min(totalScore, pointsPossible);

  return {
    assignmentId: submission.assignment_id,
    originalScore: autoScore,
    adjustedScore: clampedScore,
    pointsPossible,
    submitted: true,
    late: submission.late,
    secondsLate: submission.seconds_late || 0,
    status: 'graded',
    quizBreakdown: { autoScore, fileUploadScore },
  };
}

// ========== Result Building ==========

/**
 * Build AutoGradeResult from raw API data.
 */
export function buildAutoGradeResult(
  rawAssignments: CanvasAssignmentRaw[],
  submissionsByAssignment: Map<number, CanvasSubmission[]>,
  latePolicy: CanvasLatePolicy | null,
  quizInfoMap?: Map<number, QuizInfo>,
  typeOverrides?: Map<number, GradingType>
): AutoGradeResult {
  const published = rawAssignments.filter((a) => a.published);

  // Build assignment list with categorization
  const assignments: AutoGradeAssignment[] = published.map((a) => {
    const qi = quizInfoMap?.get(a.id);
    const gradingType = typeOverrides?.get(a.id) ?? categorizeAssignment(a, qi);

    // Extract file upload question info for quiz_mixed
    let fileUploadQuestions: QuizFileUploadQuestion[] | undefined;
    if (gradingType === 'quiz_mixed' && qi) {
      fileUploadQuestions = qi.questions
        .filter((q) => q.question_type === 'file_upload_question')
        .map((q) => ({
          questionId: q.id,
          questionName: q.question_name,
          pointsPossible: q.points_possible,
        }));
    }

    return {
      id: a.id,
      name: a.name,
      pointsPossible: a.points_possible ?? 0,
      dueAt: a.due_at,
      gradingType,
      submissionTypes: a.submission_types,
      published: a.published,
      fileUploadQuestions,
    };
  });

  // Build quiz submission lookup: userId → quizSubmission (per assignment)
  const quizSubLookup = new Map<number, Map<number, CanvasQuizSubmission>>(); // assignmentId → (userId → qs)
  if (quizInfoMap) {
    for (const assignment of assignments) {
      if (assignment.gradingType !== 'quiz_mixed') continue;
      const qi = quizInfoMap.get(assignment.id);
      if (!qi) continue;
      const userMap = new Map<number, CanvasQuizSubmission>();
      for (const qs of qi.quizSubmissions) {
        userMap.set(qs.user_id, qs);
      }
      quizSubLookup.set(assignment.id, userMap);
    }
  }

  // Build student map from all submissions
  const studentMap = new Map<number, AutoGradeStudent>();

  for (const assignment of assignments) {
    const submissions = submissionsByAssignment.get(assignment.id) || [];
    for (const sub of submissions) {
      if (!sub.user) continue;
      if (!sub.user.sis_user_id) continue;

      if (!studentMap.has(sub.user_id)) {
        studentMap.set(sub.user_id, {
          userId: sub.user_id,
          name: sub.user.name,
          sortableName: sub.user.sortable_name,
          sisUserId: sub.user.sis_user_id || '',
          loginId: sub.user.login_id || '',
          section: '',
          scores: new Map(),
        });
      }

      const student = studentMap.get(sub.user_id)!;
      let score: AutoGradeScore;

      if (assignment.gradingType === 'quiz_mixed' && assignment.fileUploadQuestions) {
        const quizSub = quizSubLookup.get(assignment.id)?.get(sub.user_id);
        score = computeQuizMixedScore(
          sub,
          assignment.pointsPossible,
          assignment.fileUploadQuestions,
          quizSub
        );
      } else if (assignment.gradingType === 'auto') {
        score = computeAutoScore(sub, assignment.pointsPossible);
      } else {
        score = computeSubmissionScore(
          sub,
          assignment.pointsPossible,
          assignment.dueAt,
          latePolicy
        );
      }

      student.scores.set(assignment.id, score);
    }
  }

  const students = Array.from(studentMap.values()).sort((a, b) =>
    a.sisUserId.localeCompare(b.sisUserId)
  );

  const autoGradedCount = assignments.filter((a) => a.gradingType === 'auto').length;
  const submissionCount = assignments.filter((a) => a.gradingType === 'submission').length;
  const quizMixedCount = assignments.filter((a) => a.gradingType === 'quiz_mixed').length;

  return {
    assignments,
    students,
    latePolicy,
    stats: {
      totalStudents: students.length,
      totalAssignments: assignments.length,
      autoGradedCount,
      submissionCount,
      quizMixedCount,
    },
  };
}

// ========== CSV Export ==========

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Generate Canvas-importable CSV.
 * Includes submission-type and quiz_mixed assignments (excludes purely auto-graded).
 * If includeAll is true, includes all assignments.
 */
export function generateCanvasImportCSV(
  result: AutoGradeResult,
  includeAll = false
): string {
  const targetAssignments = includeAll
    ? result.assignments
    : result.assignments.filter(
        (a) => a.gradingType === 'submission' || a.gradingType === 'quiz_mixed'
      );

  if (targetAssignments.length === 0) {
    return '';
  }

  const headerCols = [
    'Student',
    'ID',
    'SIS User ID',
    'SIS Login ID',
    'Integration ID',
    'Section',
    ...targetAssignments.map((a) => `${a.name} (${a.id})`),
  ];

  const rows: string[] = [];
  rows.push(headerCols.map(escapeCSV).join(','));

  for (const student of result.students) {
    const cols = [
      student.name,
      String(student.userId),
      student.sisUserId,
      student.loginId,
      '',
      student.section,
      ...targetAssignments.map((a) => {
        const score = student.scores.get(a.id);
        if (!score) return '';
        return String(Math.round(score.adjustedScore * 100) / 100);
      }),
    ];
    rows.push(cols.map(escapeCSV).join(','));
  }

  return '\uFEFF' + rows.join('\n');
}

/**
 * Generate a full XLSX with all scores (for reference, not Canvas import).
 */
export function generateFullXlsx(result: AutoGradeResult): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    '#',
    'SIS User ID',
    'ชื่อ',
    ...result.assignments.map((a) => {
      const typeLabel =
        a.gradingType === 'auto' ? '[A]' : a.gradingType === 'quiz_mixed' ? '[Q]' : '[S]';
      return `${typeLabel} ${a.name}`;
    }),
    'รวม',
  ];

  const rows = result.students.map((student, i) => {
    let total = 0;
    const scores = result.assignments.map((a) => {
      const score = student.scores.get(a.id);
      if (!score) return '';
      total += score.adjustedScore;
      return Math.round(score.adjustedScore * 100) / 100;
    });

    return [
      i + 1,
      student.sisUserId,
      student.name,
      ...scores,
      Math.round(total * 100) / 100,
    ] as (string | number)[];
  });

  return { headers, rows };
}
