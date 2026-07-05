import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

/**
 * Rebuild the Canvas gradebook export shape by fanning out roster + assignments + bulk submissions.
 *
 * Returns { headers, rows } where:
 *  - headers = ["Student", "ID", "SIS User ID", "SIS Login ID", "Integration ID", "Section", "Assignment (id)", ...]
 *  - rows[0] = Points Possible sentinel row (matches Canvas CSV export)
 *  - rows[1..] = one row per student
 *
 * Assignment order follows Canvas's `position` field so grade-mapping headers line up with a real export.
 */

interface CanvasEnrollment {
  course_section_id: number;
}

interface CanvasStudent {
  id: number;
  name?: string;
  sortable_name?: string;
  sis_user_id?: string | null;
  login_id?: string | null;
  integration_id?: string | null;
  enrollments?: CanvasEnrollment[];
}

interface CanvasSection {
  id: number;
  name: string;
}

interface CanvasAssignment {
  id: number;
  name: string;
  position?: number;
  points_possible?: number | null;
}

interface CanvasSubmission {
  user_id: number;
  assignment_id: number;
  score: number | null;
}

async function paginatedGet<T>(url: string, apiKey: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Canvas API ${response.status}: ${errorText}`);
    }
    const page = await response.json();
    if (Array.isArray(page)) results.push(...(page as T[]));

    const linkHeader = response.headers.get('Link');
    nextUrl = null;
    if (linkHeader) {
      const nextLink = linkHeader.split(',').find((l) => l.includes('rel="next"'));
      const match = nextLink?.match(/<([^>]+)>/);
      if (match) nextUrl = match[1];
    }
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    const courseId = request.nextUrl.searchParams.get('courseId');
    if (!courseId) {
      return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
    }

    // Fan out the three top-level lookups in parallel.
    const [students, sections, assignments] = await Promise.all([
      paginatedGet<CanvasStudent>(
        `${canvasUrl}/api/v1/courses/${courseId}/users?enrollment_type[]=student&include[]=enrollments&per_page=100`,
        apiKey,
      ),
      paginatedGet<CanvasSection>(
        `${canvasUrl}/api/v1/courses/${courseId}/sections?per_page=100`,
        apiKey,
      ),
      paginatedGet<CanvasAssignment>(
        `${canvasUrl}/api/v1/courses/${courseId}/assignments?per_page=100`,
        apiKey,
      ),
    ]);

    // Bulk submissions endpoint returns one submission per (student, assignment) pair
    // whether or not the student has submitted. student_ids[]=all fetches everyone.
    const submissions = await paginatedGet<CanvasSubmission>(
      `${canvasUrl}/api/v1/courses/${courseId}/students/submissions?student_ids[]=all&per_page=100`,
      apiKey,
    );

    // Sort assignments by position (Canvas gradebook column order)
    const sortedAssignments = [...assignments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Lookup structures
    const sectionNameById = new Map(sections.map((s) => [s.id, s.name]));
    const assignmentColIdx = new Map<number, number>();
    sortedAssignments.forEach((a, i) => assignmentColIdx.set(a.id, i));

    // score matrix: userId -> array of scores (empty string for missing)
    const scoresByUser = new Map<number, string[]>();
    for (const sub of submissions) {
      let row = scoresByUser.get(sub.user_id);
      if (!row) {
        row = new Array(sortedAssignments.length).fill('');
        scoresByUser.set(sub.user_id, row);
      }
      const colIdx = assignmentColIdx.get(sub.assignment_id);
      if (colIdx === undefined) continue;
      row[colIdx] = sub.score == null ? '' : String(sub.score);
    }

    // Headers: 6 fixed cols + assignments as "Name (id)" (matches ASSIGNMENT_ID_REGEX)
    const headers = [
      'Student',
      'ID',
      'SIS User ID',
      'SIS Login ID',
      'Integration ID',
      'Section',
      ...sortedAssignments.map((a) => `${a.name} (${a.id})`),
    ];

    // Points Possible sentinel row — matches getPointsRowStart() detection
    const pointsRow = [
      '    Points Possible',
      '',
      '',
      '',
      '',
      '',
      ...sortedAssignments.map((a) => (a.points_possible == null ? '' : String(a.points_possible))),
    ];

    // Sort students by sortable_name so the export is stable
    const sortedStudents = [...students].sort((a, b) =>
      (a.sortable_name || a.name || '').localeCompare(b.sortable_name || b.name || ''),
    );

    const studentRows: string[][] = sortedStudents.map((s) => {
      const sectionId = s.enrollments?.[0]?.course_section_id;
      const sectionName = sectionId ? sectionNameById.get(sectionId) || '' : '';
      const scores = scoresByUser.get(s.id) || new Array(sortedAssignments.length).fill('');
      return [
        s.sortable_name || s.name || '',
        String(s.id),
        s.sis_user_id ?? '',
        s.login_id ?? '',
        s.integration_id ?? '',
        sectionName,
        ...scores,
      ];
    });

    return NextResponse.json({
      headers,
      rows: [pointsRow, ...studentRows],
      stats: {
        studentCount: sortedStudents.length,
        assignmentCount: sortedAssignments.length,
        submissionCount: submissions.length,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
