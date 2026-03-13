import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for uploading files to Firebase Storage.
 * Bypasses CORS restrictions that block client-side requests from localhost.
 *
 * POST body: FormData with fields:
 *   - file: File/Blob to upload
 *   - storagePath: string
 *   - token: string (Firebase Auth ID token)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const storagePath = formData.get('storagePath') as string | null;
    const token = formData.get('token') as string | null;

    if (!file || !storagePath || !token) {
      return NextResponse.json(
        { error: 'file, storagePath, and token are required' },
        { status: 400 }
      );
    }

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) {
      return NextResponse.json(
        { error: 'Storage bucket not configured' },
        { status: 500 }
      );
    }

    // Upload via Firebase Storage REST API
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
  } catch (error) {
    console.error('Storage upload proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
