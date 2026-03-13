import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apiKey = searchParams.get('apiKey');
  const canvasUrl = searchParams.get('canvasUrl');
  const courseId = searchParams.get('courseId');
  const quizId = searchParams.get('quizId');

  if (!apiKey || !canvasUrl || !courseId || !quizId) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  try {
    // First get quiz questions
    const questionsRes: Response = await fetch(
      `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let questions: any[] = [];
    if (questionsRes.ok) {
      questions = await questionsRes.json();
      console.log(`Found ${questions.length} questions for quiz ${quizId}`);
    } else {
      console.log('Could not fetch questions:', questionsRes.status);
    }

    // Get quiz submissions with submission history
    const allSubmissions: any[] = [];
    let nextUrl: string | null = `${canvasUrl}/api/v1/courses/${courseId}/quizzes/${quizId}/submissions?include[]=submission&include[]=submission_history&per_page=100`;
    
    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Quiz submissions error:', response.status, errorText);
        return NextResponse.json({ 
          submissions: [],
          questions: questions,
          error: `Canvas API Error: ${response.status}` 
        });
      }

      const data = await response.json();
      console.log('Quiz submissions response keys:', Object.keys(data));
      
      if (data.quiz_submissions) {
        allSubmissions.push(...data.quiz_submissions);
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

    console.log(`Found ${allSubmissions.length} quiz submissions`);

    // For each submission, try to get the submission events/answers
    const submissionsWithAnswers: any[] = [];
    
    for (const submission of allSubmissions) {
      let answers: any[] = [];
      
      // Try to get answers from submission_history first
      if (submission.submission_history && submission.submission_history.length > 0) {
        const lastAttempt = submission.submission_history[submission.submission_history.length - 1];
        if (lastAttempt.submission_data) {
          answers = lastAttempt.submission_data;
        }
      }

      // If no answers from history, try the questions endpoint
      if (answers.length === 0) {
        try {
          const answersRes: Response = await fetch(
            `${canvasUrl}/api/v1/quiz_submissions/${submission.id}/questions`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (answersRes.ok) {
            const answersData = await answersRes.json();
            answers = answersData.quiz_submission_questions || [];
          }
        } catch (err) {
          console.log('Could not fetch submission questions:', err);
        }
      }

      submissionsWithAnswers.push({
        ...submission,
        answers: answers
      });
    }

    return NextResponse.json({ 
      submissions: submissionsWithAnswers,
      questions: questions
    });
  } catch (error) {
    console.error('Error fetching quiz submissions:', error);
    return NextResponse.json({ 
      submissions: [],
      questions: [],
      error: 'Failed to fetch quiz submissions' 
    });
  }
}
