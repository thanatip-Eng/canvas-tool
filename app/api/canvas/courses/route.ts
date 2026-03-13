import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apiKey = searchParams.get('apiKey');
  const canvasUrl = searchParams.get('canvasUrl');

  if (!apiKey || !canvasUrl) {
    return NextResponse.json({ error: 'Missing API Key or Canvas URL' }, { status: 400 });
  }

  try {
    const allCourses: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`;
    
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

      const courses = await response.json();
      allCourses.push(...courses);

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

    return NextResponse.json({ courses: allCourses });
  } catch (error) {
    console.error('Error fetching courses:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch courses. Please check your Canvas URL and API Key.' 
    }, { status: 500 });
  }
}
