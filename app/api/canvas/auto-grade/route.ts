import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

/**
 * Batch endpoint: fetches all assignments, their submissions, late policy,
 * and quiz question details (for quizzes with file upload questions).
 *
 * Supports both Classic Quizzes (is_quiz_assignment + quiz_id) and
 * New Quizzes (is_quiz_lti_assignment / is_new_quiz) with different APIs.
 */
export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const courseId = request.nextUrl.searchParams.get('courseId');
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // 1. Fetch all assignments (with pagination)
    const allAssignments: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/assignments?per_page=100`;

    while (nextUrl) {
      const res: Response = await fetch(nextUrl, { headers });
      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `Canvas assignments error: ${res.status} - ${errText}` },
          { status: res.status }
        );
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        allAssignments.push(
          ...data.map((a: any) => ({
            ...a,
            is_new_quiz:
              a.is_quiz_lti_assignment ||
              a.external_tool_tag_attributes?.url?.includes('quiz-lti') ||
              (a.submission_types?.includes('external_tool') &&
                a.external_tool_tag_attributes?.url?.includes('quiz')),
          }))
        );
      }
      nextUrl = parseLinkNext(res.headers.get('Link'));
    }

    // 2. Fetch late policy
    let latePolicy: any = null;
    try {
      const lpRes: Response = await fetch(
        `${canvasUrl}/api/v1/courses/${courseId}/late_policy`,
        { headers }
      );
      if (lpRes.ok) {
        const lpData = await lpRes.json();
        latePolicy = lpData.late_policy || null;
      }
    } catch {
      // Non-critical
    }

    // 3. Fetch submissions for each assignment (batched, 5 concurrent)
    const submissionsByAssignment: Record<string, any[]> = {};
    const BATCH_SIZE = 5;

    for (let i = 0; i < allAssignments.length; i += BATCH_SIZE) {
      const batch = allAssignments.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (assignment) => {
          const subs: any[] = [];
          let subUrl: string | null =
            `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignment.id}/submissions?include[]=user&per_page=100`;

          while (subUrl) {
            const subRes: Response = await fetch(subUrl, { headers });
            if (!subRes.ok) break;
            const subData = await subRes.json();
            if (Array.isArray(subData)) subs.push(...subData);
            subUrl = parseLinkNext(subRes.headers.get('Link'));
          }

          return { assignmentId: assignment.id, submissions: subs };
        })
      );

      for (const r of results) {
        submissionsByAssignment[String(r.assignmentId)] = r.submissions;
      }
    }

    // 4. Fetch quiz questions for quiz assignments (Classic + New Quizzes)
    const quizInfo: Record<string, { questions: any[]; quizSubmissions: any[] }> = {};

    const classicQuizAssignments = allAssignments.filter(
      (a) => a.is_quiz_assignment && a.quiz_id && a.published
    );

    for (let i = 0; i < classicQuizAssignments.length; i += BATCH_SIZE) {
      const batch = classicQuizAssignments.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((assignment) =>
          fetchClassicQuizInfo(canvasUrl, courseId, assignment, headers)
        )
      );
      for (const r of results) {
        if (r) quizInfo[String(r.assignmentId)] = r;
      }
    }

    const newQuizAssignments = allAssignments.filter(
      (a) => a.is_new_quiz && !a.is_quiz_assignment && a.published
    );

    if (newQuizAssignments.length > 0) {
      let newQuizzes: any[] = [];
      try {
        const nqRes: Response = await fetch(
          `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes`,
          { headers }
        );
        if (nqRes.ok) {
          newQuizzes = await nqRes.json();
        }
      } catch {
        // Non-critical
      }

      if (newQuizzes.length > 0) {
        for (let i = 0; i < newQuizAssignments.length; i += BATCH_SIZE) {
          const batch = newQuizAssignments.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((assignment) =>
              fetchNewQuizInfo(canvasUrl, courseId, assignment, newQuizzes, headers)
            )
          );
          for (const r of results) {
            if (r) quizInfo[String(r.assignmentId)] = r;
          }
        }
      }
    }

    return NextResponse.json({
      assignments: allAssignments,
      submissionsByAssignment,
      latePolicy,
      quizInfo,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function fetchClassicQuizInfo(
  canvasUrl: string,
  courseId: string,
  assignment: any,
  headers: Record<string, string>
): Promise<{ assignmentId: number; questions: any[]; quizSubmissions: any[] } | null> {
  let questions: any[] = [];
  try {
    const qRes: Response = await fetch(
      `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${assignment.quiz_id}/questions?per_page=100`,
      { headers }
    );
    if (qRes.ok) {
      questions = await qRes.json();
    }
  } catch {
    return null;
  }

  const hasFileUpload = questions.some(
    (q: any) => q.question_type === 'file_upload_question'
  );

  let quizSubmissions: any[] = [];
  if (hasFileUpload) {
    try {
      let qsUrl: string | null =
        `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${assignment.quiz_id}/submissions?include[]=submission&include[]=submission_history&per_page=100`;
      while (qsUrl) {
        const qsRes: Response = await fetch(qsUrl, { headers });
        if (!qsRes.ok) break;
        const qsData = await qsRes.json();
        if (qsData.quiz_submissions) {
          quizSubmissions.push(...qsData.quiz_submissions);
        }
        qsUrl = parseLinkNext(qsRes.headers.get('Link'));
      }
    } catch {
      // Non-critical
    }
  }

  return {
    assignmentId: assignment.id,
    questions: normalizeQuestions(questions, 'classic'),
    quizSubmissions,
  };
}

async function fetchNewQuizInfo(
  canvasUrl: string,
  courseId: string,
  assignment: any,
  newQuizzes: any[],
  headers: Record<string, string>
): Promise<{ assignmentId: number; questions: any[]; quizSubmissions: any[] } | null> {
  const matchingQuiz = newQuizzes.find(
    (q: any) => q.assignment_id === assignment.id || q.title === assignment.name
  );

  if (!matchingQuiz) return null;

  const quizId = matchingQuiz.id;

  let items: any[] = [];
  try {
    const itemsRes: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/items`,
      { headers }
    );
    if (itemsRes.ok) {
      items = await itemsRes.json();
    }
  } catch {
    return null;
  }

  return {
    assignmentId: assignment.id,
    questions: normalizeQuestions(items, 'new'),
    quizSubmissions: [],
  };
}

function normalizeQuestions(
  questions: any[],
  source: 'classic' | 'new'
): any[] {
  if (source === 'classic') {
    return questions.map((q: any) => ({
      id: q.id,
      question_name: q.question_name || q.question_text?.substring(0, 50) || `Question ${q.id}`,
      question_type: q.question_type,
      points_possible: q.points_possible || 0,
    }));
  }

  return questions.map((item: any) => {
    const entry = item.entry || {};
    const itemType = entry.item_type || item.item_type || '';
    const interactionSlug = entry.interaction_type_slug || '';

    const isFileUpload =
      itemType === 'file_upload' ||
      interactionSlug === 'file-upload' ||
      itemType === 'File Upload' ||
      (typeof itemType === 'string' && itemType.toLowerCase().includes('file'));

    return {
      id: item.id,
      question_name: entry.title || item.title || `Item ${item.id}`,
      question_type: isFileUpload ? 'file_upload_question' : itemType,
      points_possible: entry.points_possible ?? item.points_possible ?? 0,
    };
  });
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
  if (!nextLink) return null;
  const match = nextLink.match(/<([^>]+)>/);
  return match ? match[1] : null;
}
