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

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // First, get the assignment to find the quiz ID
    const assignmentRes: Response = await fetch(
      `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      { headers }
    );

    if (!assignmentRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch assignment' }, { status: 400 });
    }

    const assignment = await assignmentRes.json();
    console.log('Assignment:', assignment.name, 'ID:', assignment.id);

    // List all New Quizzes in the course
    const newQuizzesRes: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes`,
      { headers }
    );

    let newQuizzes: any[] = [];
    if (newQuizzesRes.ok) {
      newQuizzes = await newQuizzesRes.json();
      console.log('Found', newQuizzes.length, 'New Quizzes');
    }

    // Find matching quiz
    const matchingQuiz = newQuizzes.find((q: any) => 
      q.assignment_id === parseInt(assignmentId) || 
      q.title === assignment.name
    );

    if (!matchingQuiz) {
      return NextResponse.json({ 
        error: 'Could not find matching New Quiz',
        isNewQuiz: true
      });
    }

    const quizId = matchingQuiz.id;
    console.log('Matched Quiz ID:', quizId, 'Title:', matchingQuiz.title);

    // Get quiz items (questions)
    const itemsRes: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/items`,
      { headers }
    );

    let items: any[] = [];
    if (itemsRes.ok) {
      items = await itemsRes.json();
      console.log('Quiz items count:', items.length);
    }

    // Try multiple methods to get submissions
    let submissions: any[] = [];

    // Method 1: Direct quiz submissions endpoint
    console.log('Trying Method 1: /submissions endpoint');
    const method1Res: Response = await fetch(
      `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions?per_page=100`,
      { headers }
    );
    if (method1Res.ok) {
      const data = await method1Res.json();
      submissions = Array.isArray(data) ? data : (data.submissions || []);
      console.log('Method 1 submissions:', submissions.length);
    }

    // Method 2: Try quiz_submissions with include
    if (submissions.length === 0) {
      console.log('Trying Method 2: /quiz_submissions endpoint');
      const method2Res: Response = await fetch(
        `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/quiz_submissions?include[]=submission&per_page=100`,
        { headers }
      );
      if (method2Res.ok) {
        const data = await method2Res.json();
        submissions = Array.isArray(data) ? data : (data.quiz_submissions || []);
        console.log('Method 2 submissions:', submissions.length);
      }
    }

    // Method 3: Get submission_users first, then fetch each
    if (submissions.length === 0) {
      console.log('Trying Method 3: submission_users endpoint');
      const usersRes: Response = await fetch(
        `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submission_users?per_page=100`,
        { headers }
      );
      if (usersRes.ok) {
        const users = await usersRes.json();
        console.log('Submission users:', users.length || 'unknown');
        
        // Try to get submissions for each user
        if (Array.isArray(users) && users.length > 0) {
          for (const user of users.slice(0, 100)) { // Limit to 100
            const userSubRes: Response = await fetch(
              `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions?user_id=${user.id}`,
              { headers }
            );
            if (userSubRes.ok) {
              const userSub = await userSubRes.json();
              if (userSub) submissions.push(userSub);
            }
          }
        }
        console.log('Method 3 submissions:', submissions.length);
      }
    }

    // Method 4: Use reports endpoint to get a CSV-like export
    if (submissions.length === 0) {
      console.log('Trying Method 4: reports endpoint');
      const reportsRes: Response = await fetch(
        `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/reports`,
        { headers }
      );
      if (reportsRes.ok) {
        const reports = await reportsRes.json();
        console.log('Reports available:', reports);
      }
    }

    // Method 5: Fallback - get from assignment submissions and try to extract data
    if (submissions.length === 0) {
      console.log('Trying Method 5: Assignment submissions with submission_history');
      const assignSubRes: Response = await fetch(
        `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=submission_history&include[]=submission_comments&per_page=100`,
        { headers }
      );
      if (assignSubRes.ok) {
        const assignSubs = await assignSubRes.json();
        console.log('Assignment submissions:', assignSubs.length);
        
        // These won't have the actual answers but at least have user info and attempt data
        submissions = assignSubs.map((sub: any) => ({
          user_id: sub.user_id,
          submitted_at: sub.submitted_at,
          score: sub.score,
          attempt: sub.attempt,
          workflow_state: sub.workflow_state,
          // Note: actual answers are in external system
          answers: []
        }));
        console.log('Method 5 submissions:', submissions.length);
      }
    }

    // For each submission, try to get detailed answers
    const submissionsWithAnswers: any[] = [];
    for (const submission of submissions) {
      let answers: any[] = submission.answers || [];
      
      // Try to get individual submission detail
      if (answers.length === 0 && submission.id) {
        try {
          const detailRes: Response = await fetch(
            `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submission.id}?include[]=submission`,
            { headers }
          );
          if (detailRes.ok) {
            const detail = await detailRes.json();
            answers = detail.answers || detail.submission_data || [];
          }
        } catch (e) {
          console.log('Could not fetch submission detail');
        }
      }

      // Try session endpoint
      if (answers.length === 0 && submission.id) {
        try {
          const sessionRes: Response = await fetch(
            `${canvasUrl}/api/quiz/v1/courses/${courseId}/quizzes/${quizId}/submissions/${submission.id}/session`,
            { headers }
          );
          if (sessionRes.ok) {
            const session = await sessionRes.json();
            answers = session.answers || session.events || [];
          }
        } catch (e) {
          console.log('Could not fetch session');
        }
      }

      submissionsWithAnswers.push({
        ...submission,
        answers: answers
      });
    }

    return NextResponse.json({
      isNewQuiz: true,
      quizId: quizId,
      quizTitle: matchingQuiz.title,
      items: items,
      submissions: submissionsWithAnswers,
      submissionCount: submissionsWithAnswers.length,
      note: submissions.length === 0 ? 
        'New Quizzes API อาจไม่เปิดให้เข้าถึง submissions โดยตรง ลองใช้ Quiz Statistics ใน Canvas แทน' : 
        null
    });

  } catch (error) {
    console.error('Error fetching New Quiz submissions:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch New Quiz submissions',
      details: String(error)
    }, { status: 500 });
  }
}
