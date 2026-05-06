'use client';

import { useState, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { useToast } from '@/components/ui/Toast';
import { buildMasterData } from '@/lib/master-data-utils';
import { buildXlsxMultiSheet, downloadXlsx } from '@/lib/xlsx-utils';
import { parseRegFilename } from '@/lib/registrar-utils';
import type { ProjectFile, RegistrarFile, MasterDataStats } from '@/types';

export default function MasterDataBuilder() {
  const { files, loadFileContent, uploadFile } = useProject();
  const { showToast } = useToast();

  // Selection state
  const [selectedCanvasFile, setSelectedCanvasFile] = useState<ProjectFile | null>(null);
  const [selectedRegIds, setSelectedRegIds] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [lastStats, setLastStats] = useState<MasterDataStats | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canvasFiles = files.canvas;
  const registrarFiles = files.registrar;
  const masterFiles = files.master;
  const latestMaster = masterFiles.length > 0 ? masterFiles[0] : null;

  // Toggle registrar file selection
  const toggleRegFile = useCallback((fileId: string) => {
    setSelectedRegIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const selectAllReg = useCallback(() => {
    setSelectedRegIds(new Set(registrarFiles.map(f => f.id)));
  }, [registrarFiles]);

  const deselectAllReg = useCallback(() => {
    setSelectedRegIds(new Set());
  }, []);

  // Build master data
  const handleBuild = useCallback(async () => {
    if (!selectedCanvasFile) {
      showToast('กรุณาเลือกไฟล์ Canvas Export', 'error');
      return;
    }
    if (selectedRegIds.size === 0) {
      showToast('กรุณาเลือกไฟล์สำนักทะเบียนอย่างน้อย 1 ไฟล์', 'error');
      return;
    }

    setBuilding(true);
    try {
      // Load Canvas file
      const canvasData = await loadFileContent(selectedCanvasFile);

      // Load registrar files
      const regFiles: RegistrarFile[] = [];
      for (const pf of registrarFiles) {
        if (!selectedRegIds.has(pf.id)) continue;
        const data = await loadFileContent(pf);
        const parsed = parseRegFilename(pf.originalFilename);
        regFiles.push({
          filename: pf.originalFilename,
          courseCode: parsed?.courseCode || '',
          lecSection: parsed?.lecSection || '',
          labSection: parsed?.labSection || '',
          data,
        });
      }

      // Build master data
      const result = buildMasterData(canvasData, regFiles);

      // Build XLSX with 2 sheets
      const xlsxBuffer = buildXlsxMultiSheet([
        {
          name: 'ข้อมูลหลัก',
          headers: result.mainHeaders,
          rows: [result.pointsPossibleRow, ...result.mainRows],
        },
        {
          name: 'เฉพาะทะเบียน',
          headers: result.regOnlyHeaders,
          rows: result.regOnlyRows,
        },
      ]);

      // Upload as master file
      const blob = new Blob([xlsxBuffer.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const masterFile = new File([blob], `master_data_${new Date().toISOString().slice(0, 10)}.xlsx`, {
        type: blob.type,
      });
      await uploadFile('master', masterFile);

      setLastStats(result.stats);
      setShowForm(false);
      showToast(
        `สร้างข้อมูลหลักสำเร็จ: ${result.stats.matchedCount} ตรงกัน, ${result.stats.canvasOnlyCount} เฉพาะ Canvas, ${result.stats.regOnlyCount} เฉพาะทะเบียน`,
        'success'
      );
    } catch (err) {
      console.error('Error building master data:', err);
      showToast(`เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setBuilding(false);
    }
  }, [selectedCanvasFile, selectedRegIds, registrarFiles, loadFileContent, uploadFile, showToast]);

  // Download existing master data
  const handleDownload = useCallback(async () => {
    if (!latestMaster) return;
    try {
      const { downloadOutputFile } = await import('@/lib/project-service');
      const blob = await downloadOutputFile(latestMaster.storagePath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = latestMaster.originalFilename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('ไม่สามารถดาวน์โหลดไฟล์ได้', 'error');
    }
  }, [latestMaster, showToast]);

  // Format date
  const formatDate = (ts: { seconds: number }) =>
    new Date(ts.seconds * 1000).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        ข้อมูลหลักของวิชา
      </h2>

      {/* Show existing master data info */}
      {latestMaster && !showForm && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">
                  {latestMaster.originalFilename}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  สร้างเมื่อ {formatDate(latestMaster.uploadedAt)} &middot;{' '}
                  {latestMaster.metadata.studentCount || '?'} นักศึกษา &middot;{' '}
                  {latestMaster.metadata.assignmentCount || '?'} assignments
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDownload}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-white/5"
              >
                ดาวน์โหลด
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-bg-primary)] hover:bg-[var(--color-accent-dark)]"
              >
                สร้างใหม่
              </button>
            </div>
          </div>

          {/* Show last build stats if available */}
          {lastStats && (
            <div className="flex gap-4 text-xs text-[var(--color-text-muted)]">
              <span className="text-[var(--color-success)]">✅ ตรงกัน {lastStats.matchedCount}</span>
              <span className="text-[var(--color-warning)]">⚠️ เฉพาะ Canvas {lastStats.canvasOnlyCount}</span>
              <span className="text-[var(--color-danger)]">❌ เฉพาะทะเบียน {lastStats.regOnlyCount}</span>
            </div>
          )}
        </div>
      )}

      {/* Build form */}
      {(!latestMaster || showForm) && (
        <div className="glass-card p-5 space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            เลือกไฟล์ Canvas Export และไฟล์สำนักทะเบียน เพื่อสร้างข้อมูลหลักของวิชา
          </p>

          {/* Canvas file selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              ไฟล์ Canvas Export
            </label>
            {canvasFiles.length === 0 ? (
              <p className="text-xs text-[var(--color-warning)]">ยังไม่มีไฟล์ Canvas — กรุณาอัพโหลดก่อน</p>
            ) : (
              <div className="space-y-1">
                {canvasFiles.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedCanvasFile(f)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selectedCanvasFile?.id === f.id
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]'
                        : 'border-white/10 text-[var(--color-text-muted)] hover:bg-white/5'
                    }`}
                  >
                    <span className="font-medium">{f.originalFilename}</span>
                    <span className="ml-2 text-xs opacity-60">
                      {f.metadata.assignmentCount || '?'} assignments &middot; {f.rowCount} rows
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Registrar file selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                ไฟล์สำนักทะเบียน
              </label>
              {registrarFiles.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={selectAllReg} className="text-xs text-[var(--color-accent)] hover:underline">
                    เลือกทั้งหมด
                  </button>
                  <button onClick={deselectAllReg} className="text-xs text-[var(--color-text-muted)] hover:underline">
                    ยกเลิกทั้งหมด
                  </button>
                </div>
              )}
            </div>
            {registrarFiles.length === 0 ? (
              <p className="text-xs text-[var(--color-warning)]">ยังไม่มีไฟล์สำนักทะเบียน — กรุณาอัพโหลดก่อน</p>
            ) : (
              <div className="space-y-1">
                {registrarFiles.map(f => {
                  const isSelected = selectedRegIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleRegFile(f.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                        isSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]'
                          : 'border-white/10 text-[var(--color-text-muted)] hover:bg-white/5'
                      }`}
                    >
                      <span className="mr-2">{isSelected ? '☑' : '☐'}</span>
                      <span className="font-medium">{f.originalFilename}</span>
                      {f.metadata.lecSection && (
                        <span className="ml-2 text-xs opacity-60">
                          Lec {f.metadata.lecSection} / Lab {f.metadata.labSection || '000'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Build button */}
          <div className="flex gap-2">
            <button
              onClick={handleBuild}
              disabled={building || !selectedCanvasFile || selectedRegIds.size === 0}
              className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
            >
              {building ? 'กำลังสร้าง...' : 'สร้างข้อมูลหลัก'}
            </button>
            {showForm && latestMaster && (
              <button
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:bg-white/5"
              >
                ยกเลิก
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
