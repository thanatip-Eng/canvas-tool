import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apiKey = searchParams.get('apiKey');
  const canvasUrl = searchParams.get('canvasUrl');
  const courseId = searchParams.get('courseId');

  if (!apiKey || !canvasUrl || !courseId) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  try {
    const allStudents: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/users?enrollment_type[]=student&include[]=enrollments&per_page=100`;
    
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

      const students = await response.json();
      allStudents.push(...students);

      // Check for next page
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

    return NextResponse.json({ students: allStudents });
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch students' 
    }, { status: 500 });
  }
}
