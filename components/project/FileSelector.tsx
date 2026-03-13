'use client';

import { useState, useEffect, useRef } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import type { ProjectFile, FileGroup } from '@/types';

interface FileSelectorProps {
  group: FileGroup;
  label: string;
  selectedFileId?: string;
  onSelect: (file: ProjectFile) => void;
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

export default function FileSelector({ group, label, selectedFileId, onSelect }: FileSelectorProps) {
  const { files } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const hasAutoSelected = useRef(false);

  const groupFiles = files[group];

  // Auto-select the default (most recent) file on first render
  useEffect(() => {
    if (!hasAutoSelected.current && groupFiles.length > 0 && !selectedFileId) {
      hasAutoSelected.current = true;
      onSelect(groupFiles[0]);
    }
  }, [groupFiles, selectedFileId, onSelect]);

  if (groupFiles.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4 text-center">
        <p className="text-sm text-[var(--color-warning)]">
          ยังไม่มีไฟล์ {label} — กรุณาอัพโหลดในหน้าโปรเจค
        </p>
      </div>
    );
  }

  const selectedFile = selectedFileId
    ? groupFiles.find((f) => f.id === selectedFileId)
    : groupFiles[0]; // Default to most recent

  return (
    <div className="relative">
      {/* Selected file display */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/[0.08]"
      >
        <span className="text-lg">📄</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
              {selectedFile?.originalFilename}
            </span>
            {selectedFile?.id === groupFiles[0]?.id && (
              <span className="shrink-0 rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[9px] font-bold text-[var(--color-accent)]">
                LATEST
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            {selectedFile && formatDate(selectedFile.uploadedAt as unknown as { seconds: number })}
            {selectedFile && ` · ${selectedFile.rowCount} rows`}
          </p>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && groupFiles.length > 1 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[var(--color-bg-secondary)] shadow-xl">
          {groupFiles.map((file, idx) => (
            <button
              key={file.id}
              onClick={() => { onSelect(file); setIsOpen(false); }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/5 ${
                file.id === selectedFile?.id ? 'bg-[var(--color-accent)]/10' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[var(--color-text-primary)]">
                    {file.originalFilename}
                  </span>
                  {idx === 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[9px] font-bold text-[var(--color-accent)]">
                      LATEST
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {formatDate(file.uploadedAt as unknown as { seconds: number })} · {file.rowCount} rows
                </p>
              </div>
              {file.id === selectedFile?.id && (
                <span className="text-[var(--color-accent)]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
