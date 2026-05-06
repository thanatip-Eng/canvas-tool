import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const groupId = request.nextUrl.searchParams.get('groupId');
    if (!groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 });
    }

    const allMembers: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/groups/${groupId}/memberships?per_page=100`;

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

      const members = await response.json();
      allMembers.push(...members);

      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
        const match = nextLink?.match(/<([^>]+)>/);
        if (match) nextUrl = match[1];
      }
    }

    return NextResponse.json({ members: allMembers });
  } catch (err) {
    return toErrorResponse(err);
  }
}
