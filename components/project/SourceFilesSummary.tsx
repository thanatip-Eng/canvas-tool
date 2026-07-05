'use client';

interface SourceFile {
  label: string;
  filename?: string | null;
}

interface SourceFilesSummaryProps {
  files: SourceFile[];
  /** Optional title override — default is "ไฟล์ต้นทางที่ใช้" */
  title?: string;
}

/**
 * Compact banner showing which files a result was produced from.
 * Drop this at the top of a results step so the user can verify their picks.
 */
export default function SourceFilesSummary({ files, title }: SourceFilesSummaryProps) {
  const shown = files.filter(f => f.filename);
  if (shown.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title ?? 'ไฟล์ต้นทางที่ใช้'}
      </p>
      <ul className="space-y-1 text-sm">
        {shown.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">📄</span>
            <span className="min-w-0">
              <span className="text-[var(--color-text-muted)]">{f.label}:</span>{' '}
              <span className="break-all font-medium text-[var(--color-text-primary)]">{f.filename}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
