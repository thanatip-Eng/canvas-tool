import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apiKey = searchParams.get('apiKey');
  const canvasUrl = searchParams.get('canvasUrl');
  const categoryId = searchParams.get('categoryId');

  if (!apiKey || !canvasUrl || !categoryId) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  try {
    const allGroups: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/group_categories/${categoryId}/groups?per_page=100`;
    
    // Handle pagination
    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json({ 
          error: `Canvas API Error: ${response.status} - ${errorText}` 
        }, { status: response.status });
      }

      const groups = await response.json();
      allGroups.push(...groups);

      // Check for next page in Link header
      const linkHeader = response.headers.get('Link');
      nextUrl = null;
      if (linkHeader) {
        const links = linkHeader.split(',');
        const nextLink = links.find((link: string) => link.includes('rel="next"'));
        if (nextLink) {
          const match = nextLink.match(/<([^>]+)>/);
          if (match) {
            nextUrl = match[1];
          }
        }
      }
    }

    return NextResponse.json({ groups: allGroups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch groups' 
    }, { status: 500 });
  }
}
