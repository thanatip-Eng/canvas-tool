import { ref, deleteObject, uploadBytes } from 'firebase/storage';
import { getFirebaseStorage } from './firebase';
import { apiFetch } from './api-client';
import type { FileGroup } from '@/types';

// Vercel serverless functions reject request bodies larger than ~4.5 MB, so the
// storage proxy 413s on big exports. Files above this go direct-to-Storage only.
const PROXY_BODY_LIMIT = 4 * 1024 * 1024;

/**
 * Build the Firebase Storage path for a project file.
 */
export function buildFilePath(
  userId: string,
  projectId: string,
  group: FileGroup,
  fileId: string,
  filename: string
): string {
  return `users/${userId}/projects/${projectId}/files/${group}/${fileId}_${filename}`;
}

/**
 * Build the Firebase Storage path for an output file.
 */
export function buildOutputPath(
  userId: string,
  projectId: string,
  outputId: string,
  filename: string
): string {
  return `users/${userId}/projects/${projectId}/outputs/${outputId}_${filename}`;
}

/**
 * Upload a file to Firebase Storage.
 *
 * Prefers a direct client-SDK upload (no size ceiling beyond the 50 MB storage
 * rule). Falls back to the Next.js proxy only for small files — e.g. when the
 * bucket has no CORS rule for this origin yet. The proxy cannot carry large
 * files because Vercel caps function request bodies at ~4.5 MB (HTTP 413).
 */
export async function uploadFileToStorage(
  storagePath: string,
  file: File | Blob
): Promise<{ storagePath: string; fileSize: number }> {
  try {
    return await uploadDirectToStorage(storagePath, file);
  } catch (err) {
    // Direct upload usually fails only when the bucket lacks a CORS entry for
    // this origin. For big files the proxy would 413 anyway, so surface the real
    // CORS error instead of a misleading one.
    if (file.size > PROXY_BODY_LIMIT) throw err;
    return await uploadViaProxy(storagePath, file);
  }
}

/** Direct upload straight to the Storage bucket with the Firebase client SDK. */
async function uploadDirectToStorage(
  storagePath: string,
  file: File | Blob
): Promise<{ storagePath: string; fileSize: number }> {
  const fileRef = ref(getFirebaseStorage(), storagePath);
  const result = await uploadBytes(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
  });
  return {
    storagePath,
    fileSize: result.metadata.size ? Number(result.metadata.size) : file.size,
  };
}

/** Legacy server-proxied upload. Bounded by Vercel's ~4.5 MB request body cap. */
async function uploadViaProxy(
  storagePath: string,
  file: File | Blob
): Promise<{ storagePath: string; fileSize: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('storagePath', storagePath);

  const response = await apiFetch('/api/storage/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Download a file from Firebase Storage via server-side proxy.
 * Routes through Next.js API to avoid CORS issues on localhost.
 */
export async function downloadFileFromStorage(storagePath: string): Promise<Blob> {
  const response = await apiFetch('/api/storage/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Download failed: ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Delete a file from Firebase Storage.
 * Uses client SDK — falls back gracefully if CORS blocks it.
 */
export async function deleteFileFromStorage(storagePath: string): Promise<void> {
  try {
    const storage = getFirebaseStorage();
    const fileRef = ref(storage, storagePath);
    await deleteObject(fileRef);
  } catch (error: unknown) {
    // Ignore if file doesn't exist (already deleted)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'storage/object-not-found'
    ) {
      return;
    }
    // Log but don't throw on CORS errors — Firestore metadata cleanup still happens
    console.warn('Storage delete may have failed (CORS?):', error);
  }
}

/**
 * Upload a CSV string as a file to Firebase Storage.
 * Adds UTF-8 BOM for proper Thai character display.
 */
export async function uploadCsvToStorage(
  storagePath: string,
  csvContent: string
): Promise<{ storagePath: string; fileSize: number }> {
  const blob = new Blob(['\uFEFF' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });
  return uploadFileToStorage(storagePath, blob);
}

/**
 * Upload an XLSX buffer to Firebase Storage.
 */
export async function uploadXlsxToStorage(
  storagePath: string,
  xlsxBuffer: Uint8Array
): Promise<{ storagePath: string; fileSize: number }> {
  const blob = new Blob([xlsxBuffer.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return uploadFileToStorage(storagePath, blob);
}
