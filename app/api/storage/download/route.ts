import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for downloading files from Firebase Storage.
 * Bypasses CORS restrictions that block client-side requests from localhost.
 *
 * POST body: { storagePath: string, token: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { storagePath, token } = await request.json();

    if (!storagePath || !token) {
      return NextResponse.json(
        { error: 'storagePath and token are required' },
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

    // Construct Firebase Storage REST API URL
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
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('Storage download proxy error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
