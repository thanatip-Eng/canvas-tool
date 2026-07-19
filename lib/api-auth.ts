import { NextResponse, type NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from './firebase-admin';
import { checkRateLimit } from './rate-limit';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/**
 * Error code returned when Canvas rejects our stored access token.
 * The client keys off this to prompt for a new token instead of showing a raw error.
 */
export const CANVAS_TOKEN_INVALID = 'CANVAS_TOKEN_INVALID';

/**
 * Call this on every Canvas `Response` before the route's own !ok handling.
 * Canvas answers 401 when the access token is expired or revoked; without this
 * each route degrades differently (empty list / 200 with an error field / 500),
 * so an expired token looks like "no data" instead of "log in again".
 */
export function assertCanvasTokenValid(response: Response): void {
  if (response.status === 401) {
    throw new ApiError(
      'Canvas Access Token หมดอายุหรือถูกเพิกถอน กรุณาใส่ Token ใหม่',
      401,
      CANVAS_TOKEN_INVALID
    );
  }
}

export interface AuthedUser {
  uid: string;
  email?: string;
}

export interface CanvasCreds {
  apiKey: string;
  canvasUrl: string;
}

/**
 * Verify the Firebase ID token from the Authorization header.
 * Throws ApiError on missing/invalid token.
 */
export async function requireAuth(req: NextRequest): Promise<AuthedUser> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw new ApiError('Missing Authorization header', 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(token);
  } catch {
    throw new ApiError('Invalid or expired ID token', 401);
  }

  if (!isEmailAllowed(decoded.email)) {
    throw new ApiError('Account not authorized for this app', 403);
  }

  const rl = await checkRateLimit(decoded.uid);
  if (!rl.ok) {
    throw new ApiError(
      `Rate limit exceeded. Retry in ${rl.retryAfterSeconds}s.`,
      429
    );
  }

  return { uid: decoded.uid, email: decoded.email };
}

/**
 * Check the user's email against the ALLOWED_EMAILS env var (comma-separated).
 * Entries starting with `@` are treated as domain matches (e.g. `@cmu.ac.th`).
 * If ALLOWED_EMAILS is unset, all authenticated users are allowed.
 */
function isEmailAllowed(email: string | undefined): boolean {
  const allowlist = process.env.ALLOWED_EMAILS;
  if (!allowlist) return true;
  if (!email) return false;

  const e = email.toLowerCase();
  return allowlist
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? e.endsWith(entry) : e === entry));
}

/**
 * Look up the authenticated user's Canvas credentials from Firestore.
 * Use this server-side instead of accepting apiKey/canvasUrl from the client.
 */
export async function getCanvasCreds(uid: string): Promise<CanvasCreds> {
  const snap = await getAdminDb().collection('users').doc(uid).get();
  if (!snap.exists) throw new ApiError('User profile not found', 404);
  const data = snap.data() as { apiKey?: string; canvasUrl?: string } | undefined;
  if (!data?.apiKey || !data?.canvasUrl) {
    throw new ApiError('Canvas credentials not configured', 400);
  }
  return { apiKey: data.apiKey, canvasUrl: data.canvasUrl.replace(/\/+$/, '') };
}

/**
 * Assert that a Firebase Storage path belongs to the authenticated user.
 * Prevents path-traversal attacks on the storage proxy.
 */
export function assertOwnsStoragePath(uid: string, storagePath: string): void {
  if (!storagePath.startsWith(`users/${uid}/`)) {
    throw new ApiError('Forbidden: path does not belong to caller', 403);
  }
}

/**
 * Convert any thrown error into a JSON NextResponse. Wrap your route body in try/catch
 * and call this from the catch.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, ...(err.code ? { code: err.code } : {}) },
      { status: err.status }
    );
  }
  console.error('Unhandled API error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
