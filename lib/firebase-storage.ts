import { ref, deleteObject } from 'firebase/storage';
import { getFirebaseStorage, getFirebaseAuth } from './firebase';
import type { FileGroup } from '@/types';

/**
 * Get the current user's Firebase Auth ID token.
 */
async function getAuthToken(): Promise<string> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

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
 * Upload a file to Firebase Storage via server-side proxy.
 * Routes through Next.js API to avoid CORS issues on localhost.
 */
export async function uploadFileToStorage(
  storagePath: string,
  file: File | Blob
): Promise<{ storagePath: string; fileSize: number }> {
  const token = await getAuthToken();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('storagePath', storagePath);
  formData.append('token', token);

  const response = await fetch('/api/storage/upload', {
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
  const token = await getAuthToken();

  const response = await fetch('/api/storage/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storagePath, token }),
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
