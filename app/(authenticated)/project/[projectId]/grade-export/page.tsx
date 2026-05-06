'use client';

import { useState, useCallback, useMemo } from 'react';
import StepWizard from '@/components/ui/StepWizard';
import FileUploadZone from '@/components/ui/FileUploadZone';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { parseXlsxBlob } from '@/lib/xlsx-utils';
import {
  parseCanvasFile,
  parseTemplate,
  mapGrades,
  generateExportXlsx,
  type CanvasStudent,
  type TemplateStudent,
  type GradeExportResult,
} from '@/lib/grade-export-utils';

const STEPS = [
  { label: '1. อัปโหลดไฟล์' },
  { label: '2. ตรวจสอบและ Map เกรด' },
  { label: '3. ดาวน์โหลด' },
];

export default function GradeExportPage() {
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // --- File state ---
  const [canvasFile, setCanvasFile] = useState<File | null>(null);
  const [canvasStudents, setCanvasStudents] = useState<CanvasStudent[]>([]);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateStudents, setTemplateStudents] = useState<TemplateStudent[]>([]);
  const [templateWorkbookData, setTemplateWorkbookData] = useState<Uint8Array | null>(null);
  const [gradeColIndex, setGradeColIndex] = useState(-1);

  // --- Mapping state ---
  const [result, setResult] = useState<GradeExportResult | null>(null);

  // --- Canvas file handler ---
  const handleCanvasFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const { headers, rows } = await parseXlsxBlob(file);
      const { students, errors } = parseCanvasFile(headers, rows);
      if (errors.length > 0) {
        showToast(errors.join('\n'), 'error');
        return;
      }
      setCanvasFile(file);
      setCanvasStudents(students);
      showToast(`โหลดไฟล์ Canvas สำเร็จ: ${students.length} คน`, 'success');
    } catch (err) {
      showToast(`อ่านไฟล์ Canvas ไม่ได้: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [showToast]);

  // --- Template file handler ---
  const handleTemplateFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const { students, errors, gradeColIndex: gci } = parseTemplate(data);
      if (errors.length > 0) {
        showToast(errors.join('\n'), 'error');
        return;
      }
      setTemplateFile(file);
      setTemplateStudents(students);
      setTemplateWorkbookData(data);
      setGradeColIndex(gci);
      showToast(`โหลดเทมเพลตสำเร็จ: ${students.length} คน`, 'success');
    } catch (err) {
      showToast(`อ่านเทมเพลตไม่ได้: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [showToast]);

  // --- Perform mapping ---
  const performMapping = useCallback(() => {
    if (canvasStudents.length === 0 || templateStudents.length === 0) {
      showToast('กรุณาอัปโหลดไฟล์ทั้ง 2 ไฟล์ก่อน', 'error');
      return;
    }
    const mappingResult = mapGrades(canvasStudents, templateStudents);
    setResult(mappingResult);
    setCurrentStep(2);
  }, [canvasStudents, templateStudents, showToast]);

  // --- Export ---
  const handleExport = useCallback(() => {
    if (!result || !templateWorkbookData || gradeColIndex < 0) return;

    try {
      // Re-parse the template workbook (fresh copy for modification)
      const { workbook } = parseTemplate(templateWorkbookData);
      const xlsxBuffer = generateExportXlsx(workbook, result, gradeColIndex);

      // Download
      const originalName = templateFile?.name || 'template.xlsx';
      const exportName = `Final_${originalName}`;
      const blob = new Blob([xlsxBuffer.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportName;
      a.click();
      URL.revokeObjectURL(url);

      showToast(`ดาวน์โหลด ${exportName} สำเร็จ`, 'success');
      setCurrentStep(3);
    } catch (err) {
      showToast(`Export ไม่สำเร็จ: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [result, templateWorkbookData, gradeColIndex, templateFile, showToast]);

  // --- Reset ---
  const handleReset = useCallback(() => {
    setCanvasFile(null);
    setCanvasStudents([]);
    setTemplateFile(null);
    setTemplateStudents([]);
    setTemplateWorkbookData(null);
    setGradeColIndex(-1);
    setResult(null);
    setCurrentStep(1);
  }, []);

  // --- Mapping table data ---
  const mappingHeaders = ['#', 'รหัสนศ.', 'ชื่อ (เทมเพลต)', 'ชื่อ (Canvas)', 'เกรด', 'สถานะ'];
  const mappingRows = useMemo(() => {
    if (!result) return [];
    return result.mappings.map((m, i) => {
      let statusBadge: React.ReactNode;
      if (m.status === 'filled') {
        statusBadge = <span className="inline-block rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">กรอกจาก Canvas</span>;
      } else if (m.status === 'skipped') {
        statusBadge = <span className="inline-block rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">มีเกรดอยู่แล้ว</span>;
      } else {
        statusBadge = <span className="inline-block rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">ไม่พบใน Canvas</span>;
      }

      return [
        String(i + 1),
        m.studentId,
        m.studentName,
        m.canvasName || '—',
        m.grade || '—',
        statusBadge,
      ];
    });
  }, [result]);

  // --- Not-in-template table ---
  const nitHeaders = ['#', 'SIS User ID', 'ชื่อ (Canvas)', 'FinalGrade'];
  const nitRows = useMemo(() => {
    if (!result) return [];
    return result.notInTemplate.map((s, i) => [
      String(i + 1),
      s.sisUserId,
      s.name,
      s.finalGrade || '—',
    ]);
  }, [result]);

  const canProceed = canvasStudents.length > 0 && templateStudents.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
        📤 ส่งออกเกรดลงเทมเพลตสำนักทะเบียน
      </h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        นำเกรดจาก Canvas มากรอกลงเทมเพลตส่งเกรดของสำนักทะเบียน โดยจับคู่ด้วย SIS User ID ↔ StudentID
      </p>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* ===== Step 1: Upload Files ===== */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Canvas file */}
            <div className="glass-card p-5 space-y-3">
              <h3 className="font-semibold text-[var(--color-text-primary)]">
                📊 ไฟล์ Canvas (CSV/XLSX)
              </h3>
              <p className="text-xs text-[var(--color-text-muted)]">
                Export จาก Canvas Gradebook — คอลัมน์สุดท้ายต้องชื่อ <code className="bg-white/10 px-1 rounded">FinalGrade</code>
              </p>
              <FileUploadZone
                accept=".csv,.xlsx,.xls"
                label="ลากไฟล์ Canvas มาวางที่นี่"
                hint="รองรับ .csv, .xlsx"
                onFiles={handleCanvasFile}
              />
              {canvasFile && (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <span>✅</span>
                  <span>{canvasFile.name} — {canvasStudents.length} คน</span>
                </div>
              )}
            </div>

            {/* Template file */}
            <div className="glass-card p-5 space-y-3">
              <h3 className="font-semibold text-[var(--color-text-primary)]">
                📋 เทมเพลตส่งเกรด (XLSX)
              </h3>
              <p className="text-xs text-[var(--color-text-muted)]">
                ไฟล์จากสำนักทะเบียน — มีหัวตาราง No., StudentID, Name, Grade, SECLEC, SECLAB, Modular
              </p>
              <FileUploadZone
                accept=".xlsx,.xls"
                label="ลากเทมเพลตมาวางที่นี่"
                hint="รองรับ .xlsx"
                onFiles={handleTemplateFile}
              />
              {templateFile && (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <span>✅</span>
                  <span>{templateFile.name} — {templateStudents.length} คน</span>
                </div>
              )}
            </div>
          </div>

          {/* Preview tables */}
          {canvasStudents.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-muted)]">
                ดูข้อมูล Canvas ({canvasStudents.length} คน)
              </summary>
              <div className="mt-3">
                <DataTable
                  headers={['#', 'SIS User ID', 'ชื่อ', 'FinalGrade']}
                  rows={canvasStudents.map((s, i) => [
                    String(i + 1),
                    s.sisUserId,
                    s.name,
                    s.finalGrade || '—',
                  ])}
                  paginate
                  defaultPageSize={25}
                  filterable
                />
              </div>
            </details>
          )}

          {templateStudents.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-muted)]">
                ดูข้อมูลเทมเพลต ({templateStudents.length} คน)
              </summary>
              <div className="mt-3">
                <DataTable
                  headers={['#', 'รหัสนศ.', 'ชื่อ', 'เกรด', 'SECLEC', 'SECLAB']}
                  rows={templateStudents.map((s, i) => [
                    String(i + 1),
                    s.studentId,
                    s.name,
                    s.grade || '—',
                    s.secLec,
                    s.secLab,
                  ])}
                  paginate
                  defaultPageSize={25}
                  filterable
                />
              </div>
            </details>
          )}

          {/* Action button */}
          <div className="flex justify-end">
            <button
              onClick={performMapping}
              disabled={!canProceed}
              className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              จับคู่และ Map เกรด →
            </button>
          </div>
        </div>

        {/* ===== Step 2: Review Mapping ===== */}
        <div className="space-y-6">
          {result && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard icon="👥" label="นศ. ในเทมเพลต" value={result.templateStudents.length} />
                <StatCard icon="✅" label="กรอกเกรดจาก Canvas" value={result.filledCount} color="text-green-400" />
                <StatCard icon="⏭️" label="มีเกรดอยู่แล้ว (ข้าม)" value={result.skippedCount} color="text-yellow-400" />
                <StatCard icon="❌" label="ไม่พบใน Canvas" value={result.notInCanvas.length} color="text-red-400" />
              </div>

              {/* Mapping results table */}
              <div className="glass-card p-4 space-y-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  ผลการจับคู่
                </h3>
                <DataTable
                  headers={mappingHeaders}
                  rows={mappingRows}
                  paginate
                  defaultPageSize={50}
                  filterable
                  rowClassName={(rIdx) => {
                    if (!result) return '';
                    // Adjust index for pagination — DataTable passes display row index
                    const m = result.mappings[rIdx];
                    if (!m) return '';
                    if (m.status === 'not_found') return 'bg-red-500/5';
                    return '';
                  }}
                />
              </div>

              {/* Not-in-template section */}
              {result.notInTemplate.length > 0 && (
                <div className="glass-card p-4 space-y-3">
                  <h3 className="font-semibold text-yellow-400">
                    ⚠️ นศ. ใน Canvas แต่ไม่มีในเทมเพลต ({result.notInTemplate.length} คน)
                  </h3>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    นักศึกษาเหล่านี้มีใน Canvas แต่ไม่พบ StudentID ในเทมเพลตส่งเกรด — จะบันทึกแยกใน sheet &quot;Not In Template&quot;
                  </p>
                  <DataTable
                    headers={nitHeaders}
                    rows={nitRows}
                    paginate
                    defaultPageSize={25}
                  />
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 justify-between">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition"
                >
                  ← กลับ
                </button>
                <button
                  onClick={handleExport}
                  className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90"
                >
                  📥 ดาวน์โหลด Excel
                </button>
              </div>
            </>
          )}
        </div>

        {/* ===== Step 3: Done ===== */}
        <div className="space-y-6">
          <div className="glass-card p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">ส่งออกสำเร็จ!</h2>
            <p className="text-[var(--color-text-muted)]">
              ไฟล์ <strong>Final_{templateFile?.name}</strong> ถูกดาวน์โหลดแล้ว
            </p>
            {result && (
              <div className="mx-auto max-w-md text-left text-sm text-[var(--color-text-muted)] space-y-1">
                <p>✅ กรอกเกรดจาก Canvas: <strong className="text-green-400">{result.filledCount}</strong> คน</p>
                <p>⏭️ ข้ามเพราะมีเกรดอยู่แล้ว: <strong className="text-yellow-400">{result.skippedCount}</strong> คน</p>
                <p>❌ ไม่พบใน Canvas: <strong className="text-red-400">{result.notInCanvas.length}</strong> คน</p>
                {result.notInTemplate.length > 0 && (
                  <p>⚠️ ใน Canvas แต่ไม่มีในเทมเพลต: <strong className="text-yellow-400">{result.notInTemplate.length}</strong> คน (ดูใน sheet &quot;Not In Template&quot;)</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 justify-center pt-4">
              <button
                onClick={handleExport}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition"
              >
                📥 ดาวน์โหลดอีกครั้ง
              </button>
              <button
                onClick={handleReset}
                className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90"
              >
                🔄 เริ่มใหม่
              </button>
            </div>
          </div>
        </div>
      </StepWizard>

      <ToastContainer />
    </div>
  );
}
