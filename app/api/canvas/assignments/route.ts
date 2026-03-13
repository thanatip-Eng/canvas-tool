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
    const allAssignments: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/assignments?per_page=100`;
    
    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // If 403/401, might be permission issue
        if (response.status === 403 || response.status === 401) {
          console.log('Assignment API permission denied, returning empty array');
          return NextResponse.json({ assignments: [], message: 'No permission to access assignments' });
        }
        const errorText = await response.text();
        console.error('Assignment API Error:', response.status, errorText);
        return NextResponse.json({ 
          error: `Canvas API Error: ${response.status} - ${errorText}` 
        }, { status: response.status });
      }

      const assignments = await response.json();
      
      // Handle case where response is not an array
      if (Array.isArray(assignments)) {
        // Mark which assignments are New Quizzes
        const enrichedAssignments = assignments.map((a: any) => ({
          ...a,
          is_new_quiz: a.is_quiz_lti_assignment || 
                       (a.external_tool_tag_attributes?.url?.includes('quiz-lti')) ||
                       (a.submission_types?.includes('external_tool') && 
                        a.external_tool_tag_attributes?.url?.includes('quiz'))
        }));
        allAssignments.push(...enrichedAssignments);
      } else {
        console.log('Unexpected assignment response format:', assignments);
      }

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

    return NextResponse.json({ assignments: allAssignments });
  } catch (error) {
    console.error('Error fetching assignments:', error);
    return NextResponse.json({ 
      assignments: [],
      error: 'Failed to fetch assignments' 
    });
  }
}
