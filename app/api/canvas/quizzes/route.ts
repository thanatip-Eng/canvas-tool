import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const courseId = request.nextUrl.searchParams.get('courseId');
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
    }

    const allQuizzes: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/quizzes?per_page=100`;

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          return NextResponse.json({ quizzes: [], message: 'No permission to access quizzes' });
        }
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Canvas API Error: ${response.status} - ${errorText}` },
          { status: response.status }
        );
      }

      const quizzes = await response.json();
      if (Array.isArray(quizzes)) {
        allQuizzes.push(...quizzes);
      }

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    return NextResponse.json({ quizzes: allQuizzes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
