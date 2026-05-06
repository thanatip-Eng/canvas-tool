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

    const allAssignments: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/assignments?per_page=100`;

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          return NextResponse.json({ assignments: [], message: 'No permission to access assignments' });
        }
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Canvas API Error: ${response.status} - ${errorText}` },
          { status: response.status }
        );
      }

      const assignments = await response.json();
      if (Array.isArray(assignments)) {
        allAssignments.push(
          ...assignments.map((a: any) => ({
            ...a,
            is_new_quiz:
              a.is_quiz_lti_assignment ||
              a.external_tool_tag_attributes?.url?.includes('quiz-lti') ||
              (a.submission_types?.includes('external_tool') &&
                a.external_tool_tag_attributes?.url?.includes('quiz')),
          }))
        );
      }

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    return NextResponse.json({ assignments: allAssignments });
  } catch (err) {
    return toErrorResponse(err);
  }
}
