'use client';

import { useState } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/components/ui/Toast';
import DataTable from '@/components/ui/DataTable';
import type { OutputFile } from '@/types';

const FEATURE_LABELS: Record<string, { label: string; icon: string }> = {
  'score-mapping': { label: 'Map คะแนน', icon: '📊' },
  'status-check': { label: 'ตรวจสอบสถานะ', icon: '🔍' },
  'grade-compare': { label: 'เปรียบเทียบคะแนน', icon: '📈' },
  'group-export': { label: 'ส่งออกกลุ่ม', icon: '👥' },
  'response-export': { label: 'ส่งออกคำตอบ', icon: '📝' },
  'edpuzzle-analysis': { label: 'Edpuzzle', icon: '🎬' },
};

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

interface ViewerData {
  output: OutputFile;
  headers: string[];
  rows: string[][];
}

export default function OutputHistory() {
  const { outputs, deleteOutput, downloadOutput, loadOutputContent } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loadingViewId, setLoadingViewId] = useState<string | null>(null);
  const [viewerData, setViewerData] = useState<ViewerData | null>(null);

  const handleDownload = async (output: OutputFile) => {
    setDownloadingId(output.id);
    try {
      await downloadOutput(output);
    } catch {
      showToast('ดาวน์โหลดไม่สำเร็จ', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (outputId: string) => {
    setDeletingId(outputId);
    try {
      await deleteOutput(outputId);
      showToast('ลบผลลัพธ์สำเร็จ', 'success');
    } catch {
      showToast('ลบไม่สำเร็จ', 'error');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleView = async (output: OutputFile) => {
    setLoadingViewId(output.id);
    try {
      const { headers, rows } = await loadOutputContent(output);
      setViewerData({ output, headers, rows });
    } catch {
      showToast('ไม่สามารถเปิดไฟล์ได้', 'error');
    } finally {
      setLoadingViewId(null);
    }
  };

  if (outputs.length === 0) {
    return null; // Don't render empty section
  }

  return (
    <div className="space-y-3">
      <ToastContainer />
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        ผลลัพธ์ที่บันทึก
      </h2>

      <div className="glass-card overflow-hidden">
        <div className="divide-y divide-white/5">
          {outputs.map((output) => {
            const featureInfo = FEATURE_LABELS[output.featureType] || { label: output.featureType, icon: '📄' };
            const isDeleting = deletingId === output.id;
            const isConfirming = confirmDeleteId === output.id;
            const isDownloading = downloadingId === output.id;
            const isLoadingView = loadingViewId === output.id;

            return (
              <div key={output.id} className="flex items-center gap-3 px-5 py-3">
                {/* Feature icon */}
                <span className="text-lg">{featureInfo.icon}</span>

                {/* Info — clickable to view */}
                <button
                  onClick={() => handleView(output)}
                  disabled={isLoadingView}
                  className="min-w-0 flex-1 text-left transition hover:opacity-80"
                  title="คลิกเพื่อดูข้อมูล"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-text-primary)] text-sm hover:underline">
                      {output.label}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {featureInfo.label}
                    </span>
                    {isLoadingView && (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                    <span>{formatDate(output.createdAt as unknown as { seconds: number })}</span>
                    <span>{formatFileSize(output.fileSize)}</span>
                    {Object.entries(output.stats || {}).map(([key, val]) => (
                      <span key={key}>{key}: {val}</span>
                    ))}
                  </div>
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* View */}
                  <button
                    onClick={() => handleView(output)}
                    disabled={isLoadingView}
                    className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-info)] transition disabled:opacity-50"
                    title="ดูข้อมูล"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>

                  {/* Download */}
                  <button
                    onClick={() => handleDownload(output)}
                    disabled={isDownloading}
                    className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-accent)] transition disabled:opacity-50"
                    title="ดาวน์โหลด"
                  >
                    {isDownloading ? (
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                  </button>

                  {/* Delete */}
                  {isConfirming ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(output.id)}
                        disabled={isDeleting}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--color-danger)] bg-[var(--color-danger)]/10 hover:bg-[var(--color-danger)]/20 transition disabled:opacity-50"
                      >
                        {isDeleting ? '...' : 'ลบ'}
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
                      onClick={() => setConfirmDeleteId(output.id)}
                      className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-danger)] transition"
                      title="ลบ"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Viewer Modal */}
      {viewerData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setViewerData(null)}>
          <div
            className="relative mx-4 flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-white/10 bg-[var(--color-bg-primary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {viewerData.output.label}
                </h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {formatDate(viewerData.output.createdAt as unknown as { seconds: number })} · {viewerData.rows.length} แถว · {viewerData.headers.length} คอลัมน์
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(viewerData.output)}
                  className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20"
                >
                  📥 ดาวน์โหลด
                </button>
                <button
                  onClick={() => setViewerData(null)}
                  className="rounded-lg p-2 text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text-primary)]"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body — scrollable DataTable */}
            <div className="flex-1 overflow-auto p-6">
              <DataTable
                headers={viewerData.headers}
                rows={viewerData.rows}
                paginate
                filterable
                stickyHeader
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
