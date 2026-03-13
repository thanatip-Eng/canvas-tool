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
    const allQuizzes: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/quizzes?per_page=100`;
    
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
          console.log('Quiz API permission denied, returning empty array');
          return NextResponse.json({ quizzes: [], message: 'No permission to access quizzes' });
        }
        const errorText = await response.text();
        console.error('Quiz API Error:', response.status, errorText);
        return NextResponse.json({ 
          error: `Canvas API Error: ${response.status} - ${errorText}` 
        }, { status: response.status });
      }

      const quizzes = await response.json();
      
      // Handle case where response is not an array
      if (Array.isArray(quizzes)) {
        allQuizzes.push(...quizzes);
      } else {
        console.log('Unexpected quiz response format:', quizzes);
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

    return NextResponse.json({ quizzes: allQuizzes });
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    return NextResponse.json({ 
      quizzes: [],
      error: 'Failed to fetch quizzes' 
    });
  }
}
