import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCanvasCreds, toErrorResponse } from '@/lib/api-auth';

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_GRADES_PER_REQUEST = 1000;

interface GradeEntry {
  sisUserId: string;
  score: string;
}

interface UploadResult {
  sisUserId: string;
  success: boolean;
  previousScore: string | null;
  newScore: string;
  error?: string;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putGradeWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  retries: number = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, { method: 'PUT', headers, body });
    if (response.status === 429 && attempt < retries - 1) {
      const retryAfter = response.headers.get('Retry-After');
      const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAY_MS * (attempt + 1);
      await sleep(delayMs);
      continue;
    }
    return response;
  }
  return fetch(url, { method: 'PUT', headers, body });
}

export async function POST(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);
    const { apiKey, canvasUrl } = await getCanvasCreds(uid);

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { courseId, assignmentId, grades } = body as {
      courseId?: string;
      assignmentId?: string;
      grades?: GradeEntry[];
    };

    if (!courseId || !assignmentId) {
      return NextResponse.json(
        { error: 'Missing required parameters: courseId, assignmentId' },
        { status: 400 }
      );
    }

    if (!grades || !Array.isArray(grades) || grades.length === 0) {
      return NextResponse.json({ error: 'Missing or empty grades array' }, { status: 400 });
    }

    if (grades.length > MAX_GRADES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many grades in one request (max ${MAX_GRADES_PER_REQUEST}). Split into multiple uploads.` },
        { status: 400 }
      );
    }

    const canvasHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const results: UploadResult[] = [];

    for (let i = 0; i < grades.length; i += BATCH_SIZE) {
      const batch = grades.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (grade): Promise<UploadResult> => {
          const url = `${canvasUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/sis_user_id:${grade.sisUserId}`;

          try {
            const response = await putGradeWithRetry(
              url,
              canvasHeaders,
              JSON.stringify({ submission: { posted_grade: grade.score } })
            );

            if (response.ok) {
              const data = await response.json();
              return {
                sisUserId: grade.sisUserId,
                success: true,
                previousScore: data.score != null ? String(data.score) : null,
                newScore: grade.score,
              };
            }

            const errorText = await response.text().catch(() => 'Unknown error');
            let errorMsg = `HTTP ${response.status}`;
            if (response.status === 401 || response.status === 403) {
              errorMsg = 'ไม่มีสิทธิ์ — ตรวจสอบ API Key และ permission';
            } else if (response.status === 404) {
              errorMsg = 'ไม่พบนักศึกษาหรือ Assignment';
            } else {
              try {
                const parsed = JSON.parse(errorText);
                errorMsg = parsed.message || parsed.errors?.[0]?.message || errorMsg;
              } catch {
                // keep default errorMsg
              }
            }

            return {
              sisUserId: grade.sisUserId,
              success: false,
              previousScore: null,
              newScore: grade.score,
              error: errorMsg,
            };
          } catch (err) {
            return {
              sisUserId: grade.sisUserId,
              success: false,
              previousScore: null,
              newScore: grade.score,
              error: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    const summary = {
      total: results.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    return NextResponse.json({ results, summary });
  } catch (err) {
    return toErrorResponse(err);
  }
}
