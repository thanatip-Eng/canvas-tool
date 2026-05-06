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

    const allSubmissions: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&include[]=submission_comments&include[]=rubric_assessment&per_page=100`;

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json({
          submissions: [],
          error: `Canvas API Error: ${response.status} - ${errorText}`,
        });
      }

      const submissions = await response.json();
      allSubmissions.push(...submissions);

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    let assignmentDetails: { id: number; name: string; due_at: string | null; points_possible: number | null } | null = null;
    try {
      const assignmentRes: Response = await fetch(
        `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}`,
        { headers }
      );
      if (assignmentRes.ok) {
        const aData = await assignmentRes.json();
        assignmentDetails = {
          id: aData.id,
          name: aData.name,
          due_at: aData.due_at ?? null,
          points_possible: aData.points_possible ?? null,
        };
      }
    } catch {
      // Non-critical
    }

    return NextResponse.json({ submissions: allSubmissions, assignment: assignmentDetails });
  } catch (err) {
    return toErrorResponse(err);
  }
}
