import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apiKey = searchParams.get('apiKey');
  const canvasUrl = searchParams.get('canvasUrl');
  const courseId = searchParams.get('courseId');
  const assignmentId = searchParams.get('assignmentId');

  if (!apiKey || !canvasUrl || !courseId || !assignmentId) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  try {
    const allSubmissions: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&include[]=submission_comments&include[]=rubric_assessment&per_page=100`;
    
    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Assignment submissions error:', response.status, errorText);
        return NextResponse.json({ 
          submissions: [],
          error: `Canvas API Error: ${response.status}` 
        });
      }

      const submissions = await response.json();
      console.log(`Fetched ${submissions.length} submissions for assignment ${assignmentId}`);
      
      // Log first submission to see structure
      if (submissions.length > 0) {
        console.log('Sample submission keys:', Object.keys(submissions[0]));
        console.log('Sample submission body:', submissions[0].body?.substring(0, 100));
      }
      
      allSubmissions.push(...submissions);

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

    return NextResponse.json({ submissions: allSubmissions });
  } catch (error) {
    console.error('Error fetching assignment submissions:', error);
    return NextResponse.json({ 
      submissions: [],
      error: 'Failed to fetch assignment submissions' 
    });
  }
}
