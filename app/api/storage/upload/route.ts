import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, assertOwnsStoragePath, toErrorResponse, ApiError } from '@/lib/api-auth';

/**
 * Server-side proxy for uploading files to Firebase Storage.
 * Originally added to bypass localhost CORS; once cors.json includes the prod
 * origin, the client can hit Firebase Storage directly with the same ID token.
 */
export async function POST(request: NextRequest) {
  try {
    const { uid } = await requireAuth(request);

    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const storagePath = formData.get('storagePath') as string | null;

    if (!file || !storagePath) {
      throw new ApiError('file and storagePath are required', 400);
    }

    assertOwnsStoragePath(uid, storagePath);

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new ApiError('Storage bucket not configured', 500);
    }

    // Forward the original ID token to Firebase Storage so its security rules
    // run as a second layer of defense.
    const token = request.headers.get('Authorization')!.slice(7).trim();

    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
    const buffer = await file.arrayBuffer();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Firebase ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: buffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Storage upload failed: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const metadata = await response.json();

    return NextResponse.json({
      storagePath,
      fileSize: metadata.size ? Number(metadata.size) : buffer.byteLength,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
