import { NextResponse, type NextRequest } from 'next/server';
import { getAdminAuth, getAdminDb } from './firebase-admin';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
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

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    throw new ApiError('Invalid or expired ID token', 401);
  }
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
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('Unhandled API error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
