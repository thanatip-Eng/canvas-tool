import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const allCourses: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`;

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: `Canvas API Error: ${response.status} - ${errorText}` },
          { status: response.status }
        );
      }

      const courses = await response.json();
      allCourses.push(...courses);

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    return NextResponse.json({ courses: allCourses });
  } catch (err) {
    return toErrorResponse(err);
  }
}
