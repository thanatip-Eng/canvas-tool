import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const courseId = request.nextUrl.searchParams.get('courseId');
    const assignmentId = request.nextUrl.searchParams.get('assignmentId');
    if (!courseId || !assignmentId) {
      return NextResponse.json({ error: 'courseId and assignmentId are required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const assignmentRes: Response = await fetch(
      `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      { headers }
    );

    if (!assignmentRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch assignment' }, { status: 400 });
    }

    const assignment = await assignmentRes.json();

    const newQuizzesRes: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes`,
      { headers }
    );

    let newQuizzes: any[] = [];
    if (newQuizzesRes.ok) {
      newQuizzes = await newQuizzesRes.json();
    }

    const matchingQuiz = newQuizzes.find(
      (q: any) => q.assignment_id === parseInt(assignmentId) || q.title === assignment.name
    );

    if (!matchingQuiz) {
      return NextResponse.json({
        error: 'Could not find matching New Quiz',
        isNewQuiz: true,
      });
    }

    const quizId = matchingQuiz.id;

    const itemsRes: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/items`,
      { headers }
    );

    let items: any[] = [];
    if (itemsRes.ok) {
      items = await itemsRes.json();
    }

    let submissions: any[] = [];

    // New Quizzes API exposes submissions through several inconsistent endpoints;
    // try them in order until one returns data.
    const method1Res: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions?per_page=100`,
      { headers }
    );
    if (method1Res.ok) {
      const data = await method1Res.json();
      submissions = Array.isArray(data) ? data : data.submissions || [];
    }

    if (submissions.length === 0) {
      const method2Res: Response = await fetch(
        `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/quiz_submissions?include[]=submission&per_page=100`,
        { headers }
      );
      if (method2Res.ok) {
        const data = await method2Res.json();
        submissions = Array.isArray(data) ? data : data.quiz_submissions || [];
      }
    }

    if (submissions.length === 0) {
      const usersRes: Response = await fetch(
        `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submission_users?per_page=100`,
        { headers }
      );
      if (usersRes.ok) {
        const users = await usersRes.json();
        if (Array.isArray(users) && users.length > 0) {
          for (const user of users.slice(0, 100)) {
            const userSubRes: Response = await fetch(
              `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions?user_id=${user.id}`,
              { headers }
            );
            if (userSubRes.ok) {
              const userSub = await userSubRes.json();
              if (userSub) submissions.push(userSub);
            }
          }
        }
      }
    }

    if (submissions.length === 0) {
      const assignSubRes: Response = await fetch(
        `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=submission_history&include[]=submission_comments&per_page=100`,
        { headers }
      );
      if (assignSubRes.ok) {
        const assignSubs = await assignSubRes.json();
        submissions = assignSubs.map((sub: any) => ({
          user_id: sub.user_id,
          submitted_at: sub.submitted_at,
          score: sub.score,
          attempt: sub.attempt,
          workflow_state: sub.workflow_state,
          answers: [],
        }));
      }
    }

    const submissionsWithAnswers: any[] = [];
    for (const submission of submissions) {
      let answers: any[] = submission.answers || [];

      if (answers.length === 0 && submission.id) {
        try {
          const detailRes: Response = await fetch(
            `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submission.id}?include[]=submission`,
            { headers }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            answers = detail.answers || detail.submission_data || [];
          }
        } catch {
          // Non-critical
        }
      }

      if (answers.length === 0 && submission.id) {
        try {
          const sessionRes: Response = await fetch(
            `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submission.id}/session`,
            { headers }
          );
          if (sessionRes.ok) {
            const session = await sessionRes.json();
            answers = session.answers || session.events || [];
          }
        } catch {
          // Non-critical
        }
      }

      submissionsWithAnswers.push({ ...submission, answers });
    }

    return NextResponse.json({
      isNewQuiz: true,
      quizId,
      quizTitle: matchingQuiz.title,
      items,
      submissions: submissionsWithAnswers,
      submissionCount: submissionsWithAnswers.length,
      note: submissions.length === 0
        ? 'New Quizzes API อาจไม่เปิดให้เข้าถึง submissions โดยตรง ลองใช้ Quiz Statistics ใน Canvas แทน'
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
