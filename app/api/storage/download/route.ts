import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, assertOwnsStoragePath, toErrorResponse, ApiError } from '@/lib/api-auth';

/**
 * Server-side proxy for downloading files from Firebase Storage.
 * See note on upload route re: CORS workaround.
 */
export async function POST(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);

    const { storagePath } = (await request.json()) as { storagePath?: string };
    if (!storagePath) {
      throw new ApiError('storagePath is required', 400);
    }

    assertOwnsStoragePath(uid, storagePath);

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new ApiError('Storage bucket not configured', 500);
    }

    const token = request.headers.get('Authorization')!.slice(7).trim();

    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Firebase ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Storage download failed: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: { 'Content-Type': contentType },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
