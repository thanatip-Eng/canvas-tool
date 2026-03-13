'use client';

import { useState } from 'react';
import type { ProjectFile } from '@/types';

interface FileVersionListProps {
  files: ProjectFile[];
  onDelete: (fileId: string) => Promise<void>;
  emptyMessage?: string;
}

function formatDate(timestamp: { seconds: number } | Date): string {
  const date = timestamp instanceof Date
    ? timestamp
    : new Date((timestamp as { seconds: number }).seconds * 1000);
  return date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileVersionList({ files, onDelete, emptyMessage = 'ยังไม่มีไฟล์' }: FileVersionListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    try {
      await onDelete(fileId);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  if (files.length === 0) {
    return (
      <p className="py-3 text-center text-sm text-[var(--color-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {files.map((file, idx) => {
        const isDefault = idx === 0;
        const isDeleting = deletingId === file.id;
        const isConfirming = confirmDeleteId === file.id;

        return (
          <div
            key={file.id}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              isDefault
                ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20'
                : 'bg-white/5 border border-transparent'
            }`}
          >
            {/* File info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-[var(--color-text-primary)]">
                  {file.originalFilename}
                </span>
                {isDefault && (
                  <span className="shrink-0 rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent)]">
                    DEFAULT
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <span>{formatDate(file.uploadedAt as unknown as { seconds: number })}</span>
                <span>{file.rowCount} rows</span>
                <span>{formatFileSize(file.fileSize)}</span>
                {file.metadata?.lecSection && (
                  <span>Lec {file.metadata.lecSection} / Lab {file.metadata.labSection}</span>
                )}
                {file.metadata?.assignmentCount && (
                  <span>{file.metadata.assignmentCount} assignments</span>
                )}
              </div>
            </div>

            {/* Delete button */}
            {isConfirming ? (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleDelete(file.id)}
                  disabled={isDeleting}
                  className="rounded px-2 py-1 text-xs font-medium text-[var(--color-danger)] bg-[var(--color-danger)]/10 hover:bg-[var(--color-danger)]/20 transition disabled:opacity-50"
                >
                  {isDeleting ? '...' : 'ยืนยัน'}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-white/5 transition"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(file.id)}
                className="shrink-0 rounded p-1 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-danger)] transition"
                title="ลบไฟล์"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
