import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const courseId = request.nextUrl.searchParams.get('courseId');
    const quizId = request.nextUrl.searchParams.get('quizId');
    if (!courseId || !quizId) {
      return NextResponse.json({ error: 'courseId and quizId are required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const questionsRes: Response = await fetch(
      `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=100`,
      { headers }
    );

    let questions: any[] = [];
    if (questionsRes.ok) {
      questions = await questionsRes.json();
    }

    const allSubmissions: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions?include[]=submission&include[]=submission_history&per_page=100`;

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json({
          submissions: [],
          questions,
          error: `Canvas API Error: ${response.status} - ${errorText}`,
        });
      }

      const data = await response.json();
      if (data.quiz_submissions) {
        allSubmissions.push(...data.quiz_submissions);
      }

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    const submissionsWithAnswers: any[] = [];
    for (const submission of allSubmissions) {
      let answers: any[] = [];

      if (submission.submission_history && submission.submission_history.length > 0) {
        const lastAttempt = submission.submission_history[submission.submission_history.length - 1];
        if (lastAttempt.submission_data) {
          answers = lastAttempt.submission_data;
        }
      }

      if (answers.length === 0) {
        try {
          const answersRes: Response = await fetch(
            `${canvasUrl}/api/v1/quiz_submissions/${submission.id}/questions`,
            { headers }
          );
          if (answersRes.ok) {
            const answersData = await answersRes.json();
            answers = answersData.quiz_submission_questions || [];
          }
        } catch {
          // Non-critical
        }
      }

      submissionsWithAnswers.push({ ...submission, answers });
    }

    return NextResponse.json({ submissions: submissionsWithAnswers, questions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
