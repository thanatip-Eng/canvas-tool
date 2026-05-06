'use client';

import { useState, useCallback, useMemo } from 'react';
import StepWizard from '@/components/ui/StepWizard';
import FileUploadZone from '@/components/ui/FileUploadZone';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { parseXlsxBlob } from '@/lib/xlsx-utils';
import {
  parseObeFile,
  parseCanvasForObe,
  mapObeScores,
  generateObeXlsx,
  type ObeStudent,
  type CanvasAssignment,
  type CanvasStudentScore,
  type ObeMappingResult,
} from '@/lib/obe-utils';

const STEPS = [
  { label: '1. อัปโหลดไฟล์' },
  { label: '2. ตรวจสอบและ Map คะแนน' },
  { label: '3. ดาวน์โหลด' },
];

export default function ObeMappingPage() {
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // --- File state ---
  const [canvasFile, setCanvasFile] = useState<File | null>(null);
  const [canvasAssignments, setCanvasAssignments] = useState<CanvasAssignment[]>([]);
  const [canvasStudents, setCanvasStudents] = useState<CanvasStudentScore[]>([]);

  const [obeFile, setObeFile] = useState<File | null>(null);
  const [obeStudents, setObeStudents] = useState<ObeStudent[]>([]);
  const [courseNo, setCourseNo] = useState('');
  const [courseName, setCourseName] = useState('');

  // --- Mapping state ---
  const [result, setResult] = useState<ObeMappingResult | null>(null);

  // --- Canvas file handler ---
  const handleCanvasFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const { headers, rows } = await parseXlsxBlob(file);
      const { assignments, students, errors } = parseCanvasForObe(headers, rows);
      if (errors.length > 0) {
        showToast(errors.join('\n'), 'error');
        return;
      }
      setCanvasFile(file);
      setCanvasAssignments(assignments);
      setCanvasStudents(students);
      showToast(`โหลดไฟล์ Canvas สำเร็จ: ${students.length} คน, ${assignments.length} assignments`, 'success');
    } catch (err) {
      showToast(`อ่านไฟล์ Canvas ไม่ได้: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [showToast]);

  // --- OBE file handler ---
  const handleObeFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { students, courseNo: cn, courseName: cname, errors } = parseObeFile(text);
      if (errors.length > 0) {
        showToast(errors.join('\n'), 'error');
        return;
      }
      setObeFile(file);
      setObeStudents(students);
      setCourseNo(cn);
      setCourseName(cname);
      showToast(`โหลดไฟล์ OBE สำเร็จ: ${students.length} คน (${cn} ${cname})`, 'success');
    } catch (err) {
      showToast(`อ่านไฟล์ OBE ไม่ได้: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [showToast]);

  // --- Perform mapping ---
  const performMapping = useCallback(() => {
    if (canvasStudents.length === 0 || obeStudents.length === 0) {
      showToast('กรุณาอัปโหลดไฟล์ทั้ง 2 ไฟล์ก่อน', 'error');
      return;
    }
    const mappingResult = mapObeScores(obeStudents, canvasStudents, canvasAssignments);
    setResult(mappingResult);
    setCurrentStep(2);
  }, [canvasStudents, canvasAssignments, obeStudents, showToast]);

  // --- Export ---
  const handleExport = useCallback(() => {
    if (!result) return;
    try {
      const xlsxBuffer = generateObeXlsx(result, courseNo, courseName);
      const exportName = `OBE_${courseNo || 'export'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
  }, [result, courseNo, courseName, showToast]);

  // --- Reset ---
  const handleReset = useCallback(() => {
    setCanvasFile(null);
    setCanvasAssignments([]);
    setCanvasStudents([]);
    setObeFile(null);
    setObeStudents([]);
    setCourseNo('');
    setCourseName('');
    setResult(null);
    setCurrentStep(1);
  }, []);

  // --- Table data ---
  const mappingHeaders = useMemo(() => {
    if (!result) return [];
    const assignmentNames = result.assignments.map(a => a.name.replace(/\s*\(\d+\)$/, ''));
    return ['#', 'รหัสนศ.', 'ชื่อ', 'Section', 'รวม', ...assignmentNames, 'สถานะ'];
  }, [result]);

  const mappingRows = useMemo(() => {
    if (!result) return [];
    return result.mappedStudents.map((s, i) => {
      const statusBadge = s.matched
        ? <span className="inline-block rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">จับคู่สำเร็จ</span>
        : <span className="inline-block rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">ไม่พบใน Canvas</span>;

      return [
        String(i + 1),
        s.studentId,
        s.name,
        `${s.sec}/${s.lab}`,
        s.matched ? String(s.totalScore) : '—',
        ...s.assignmentScores.map(v => v === '' ? '—' : String(v)),
        statusBadge,
      ];
    });
  }, [result]);

  const canProceed = canvasStudents.length > 0 && obeStudents.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
        🎓 Map คะแนนเข้า CMU OBE
      </h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        นำคะแนนจาก Canvas มา map เข้ารูปแบบ CMU OBE โดยจับคู่ด้วย SIS User ID ↔ รหัสนักศึกษา
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
                Export จาก Canvas Gradebook — จะดึง assignment ทั้งหมดพร้อมคะแนน
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
                  <span>{canvasFile.name} — {canvasStudents.length} คน, {canvasAssignments.length} assignments</span>
                </div>
              )}
            </div>

            {/* OBE file */}
            <div className="glass-card p-5 space-y-3">
              <h3 className="font-semibold text-[var(--color-text-primary)]">
                🎓 ไฟล์ CMU OBE
              </h3>
              <p className="text-xs text-[var(--color-text-muted)]">
                Save หน้า Gradebook จาก CMU OBE เป็นไฟล์ (.html / .xlsx)
              </p>
              <FileUploadZone
                accept=".html,.htm,.xlsx,.xls"
                label="ลากไฟล์ CMU OBE มาวางที่นี่"
                hint="รองรับ .html, .xlsx (HTML format)"
                onFiles={handleObeFile}
              />
              {obeFile && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <span>✅</span>
                    <span>{obeFile.name} — {obeStudents.length} คน</span>
                  </div>
                  {courseNo && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {courseNo} {courseName}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Preview tables */}
          {canvasStudents.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-muted)]">
                ดูข้อมูล Canvas ({canvasStudents.length} คน, {canvasAssignments.length} assignments)
              </summary>
              <div className="mt-3">
                <DataTable
                  headers={['#', 'SIS User ID', 'ชื่อ', 'คะแนนรวม']}
                  rows={canvasStudents.map((s, i) => [
                    String(i + 1),
                    s.sisUserId,
                    s.name,
                    String(s.totalScore),
                  ])}
                  paginate
                  defaultPageSize={25}
                  filterable
                />
              </div>
            </details>
          )}

          {obeStudents.length > 0 && (
            <details className="glass-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-muted)]">
                ดูข้อมูล OBE ({obeStudents.length} คน)
              </summary>
              <div className="mt-3">
                <DataTable
                  headers={['#', 'รหัสนศ.', 'ชื่อ', 'Section']}
                  rows={obeStudents.map((s, i) => [
                    String(i + 1),
                    s.studentId,
                    s.name,
                    `${s.sec}/${s.lab}`,
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
              จับคู่และ Map คะแนน →
            </button>
          </div>
        </div>

        {/* ===== Step 2: Review Mapping ===== */}
        <div className="space-y-6">
          {result && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard icon="👥" label="นศ. ใน OBE" value={result.mappedStudents.length} />
                <StatCard icon="✅" label="จับคู่สำเร็จ" value={result.matchedCount} color="text-green-400" />
                <StatCard icon="❌" label="ไม่พบใน Canvas" value={result.unmatchedObe.length} color="text-red-400" />
                <StatCard icon="📊" label="Assignments" value={result.assignments.length} />
              </div>

              {result.unmatchedCanvas.length > 0 && (
                <div className="glass-card p-3 border border-yellow-500/30">
                  <p className="text-sm text-yellow-400">
                    ⚠️ นศ. ใน Canvas แต่ไม่มีใน OBE: <strong>{result.unmatchedCanvas.length}</strong> คน (จะบันทึกแยกใน sheet &quot;Not In OBE&quot;)
                  </p>
                </div>
              )}

              {/* Mapping table */}
              <div className="glass-card p-4 space-y-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  ผลการจับคู่
                </h3>
                <div className="overflow-x-auto">
                  <DataTable
                    headers={mappingHeaders}
                    rows={mappingRows}
                    paginate
                    defaultPageSize={50}
                    filterable
                  />
                </div>
              </div>

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
              ไฟล์ <strong>OBE_{courseNo}_*.xlsx</strong> ถูกดาวน์โหลดแล้ว
            </p>
            {result && (
              <div className="mx-auto max-w-md text-left text-sm text-[var(--color-text-muted)] space-y-1">
                <p>✅ จับคู่สำเร็จ: <strong className="text-green-400">{result.matchedCount}</strong> คน</p>
                <p>❌ ไม่พบใน Canvas: <strong className="text-red-400">{result.unmatchedObe.length}</strong> คน</p>
                <p>📊 Assignments: <strong>{result.assignments.length}</strong> รายการ</p>
                {result.unmatchedCanvas.length > 0 && (
                  <p>⚠️ ใน Canvas แต่ไม่มีใน OBE: <strong className="text-yellow-400">{result.unmatchedCanvas.length}</strong> คน</p>
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
