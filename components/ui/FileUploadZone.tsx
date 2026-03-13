'use client';

import { useCallback, useRef, useState } from 'react';

interface FileUploadZoneProps {
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export default function FileUploadZone({
  accept = '.csv,.xlsx,.xls',
  multiple = false,
  label = 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก',
  hint,
  onFiles,
  disabled = false,
}: FileUploadZoneProps) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  }, [disabled, multiple, onFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    if (inputRef.current) inputRef.current.value = '';
  }, [multiple, onFiles]);

  return (
    <div
      className={`upload-zone ${dragover ? 'dragover' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragover(true); }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
        aria-label={label}
      />
      <div className="text-3xl mb-2">📁</div>
      <p className="text-[var(--color-text-primary)]">{label}</p>
      {hint && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
