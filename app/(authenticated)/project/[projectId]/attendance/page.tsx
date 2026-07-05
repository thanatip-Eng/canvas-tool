'use client';

import { useState, useCallback, useMemo } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsx, downloadXlsx } from '@/lib/xlsx-utils';
import { buildCsv, downloadCSV } from '@/lib/csv-utils';
import { validateCanvasFile, extractAssignments, getPointsRowStart } from '@/lib/canvas-utils';
import {
  parseAttendanceForm,
  evaluateAttendance,
  matchAttendanceToCanvas,
  DEFAULT_ATTENDANCE_RULE,
  type AttendanceForm,
  type AttendanceScoreRule,
  type AttendanceMatchRow,
  type FormOnlyEmail,
} from '@/lib/attendance-utils';
import { CANVAS_FIXED_COLS } from '@/lib/constants';
import type { ParsedFile, AssignmentInfo, ProjectFile } from '@/types';

const STEPS = [
  { label: 'ไฟล์ Canvas' },
  { label: 'ไฟล์ MS Form' },
  { label: 'Assignment + กติกา' },
  { label: 'ผลลัพธ์' },
];

const REASON_LABEL: Record<string, string> = {
  both: 'มาครบ',
  checkInOnly: 'เข้าเท่านั้น',
  checkOutOnly: 'ออกเท่านั้น',
  absent: 'ไม่ได้ส่งเลย',
  bothInvalid: 'ส่งแต่ผิดช่วงเวลา',
  unmatched: 'ไม่พบใน MS Form',
};

const REASON_COLOR: Record<string, string> = {
  both: 'text-[var(--color-success)]',
  checkInOnly: 'text-[var(--color-warning)]',
  checkOutOnly: 'text-[var(--color-warning)]',
  absent: 'text-[var(--color-danger)]',
  bothInvalid: 'text-[var(--color-danger)]',
  unmatched: 'text-[var(--color-text-muted)]',
};

export default function AttendancePage() {
  const { loadFileContent, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Canvas
  const [canvasFile, setCanvasFile] = useState<ProjectFile | null>(null);
  const [canvasData, setCanvasData] = useState<ParsedFile | null>(null);
  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);
  const [loadingCanvas, setLoadingCanvas] = useState(false);

  // Step 2: Attendance forms
  const [checkInFile, setCheckInFile] = useState<ProjectFile | null>(null);
  const [checkOutFile, setCheckOutFile] = useState<ProjectFile | null>(null);
  const [checkInForm, setCheckInForm] = useState<AttendanceForm | null>(null);
  const [checkOutForm, setCheckOutForm] = useState<AttendanceForm | null>(null);
  const [loadingIn, setLoadingIn] = useState(false);
  const [loadingOut, setLoadingOut] = useState(false);

  // Step 3: Assignment + rule
  const [selectedAssignmentIdx, setSelectedAssignmentIdx] = useState<number>(-1);
  const [rule, setRule] = useState<AttendanceScoreRule>(DEFAULT_ATTENDANCE_RULE);
  const [checkInCutoff, setCheckInCutoff] = useState('');
  const [checkOutEarliest, setCheckOutEarliest] = useState('');

  // Step 4: Results
  const [results, setResults] = useState<AttendanceMatchRow[] | null>(null);
  const [formOnlyEmails, setFormOnlyEmails] = useState<FormOnlyEmail[]>([]);
  const [saving, setSaving] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  const handleLoadCanvas = useCallback(async (file: ProjectFile) => {
    setCanvasFile(file);
    setLoadingCanvas(true);
    try {
      const data = await loadFileContent(file);
      if (!validateCanvasFile(data)) {
        showToast('ไฟล์ไม่ใช่ Canvas gradebook export', 'error');
        return;
      }
      setCanvasData(data);
      setAssignments(extractAssignments(data.headers));
      showToast(`โหลด Canvas สำเร็จ: ${data.rows.length} แถว`, 'success');
      setCurrentStep(2);
    } catch {
      showToast('อ่านไฟล์ Canvas ไม่สำเร็จ', 'error');
    } finally {
      setLoadingCanvas(false);
    }
  }, [loadFileContent, showToast]);

  const loadForm = useCallback(async (
    file: ProjectFile,
    setForm: (f: AttendanceForm) => void,
    setLoading: (b: boolean) => void,
    label: string,
  ) => {
    setLoading(true);
    try {
      const data = await loadFileContent(file);
      const form = parseAttendanceForm(data);
      if (form.emailCol < 0) {
        showToast(`ไม่พบคอลัมน์ Email ในไฟล์ ${label}`, 'error');
        return;
      }
      setForm(form);
      showToast(`โหลด ${label} สำเร็จ: ${form.entries.size} คน`, 'success');
    } catch {
      showToast(`อ่านไฟล์ ${label} ไม่สำเร็จ`, 'error');
    } finally {
      setLoading(false);
    }
  }, [loadFileContent, showToast]);

  const handleLoadCheckIn = useCallback((file: ProjectFile) => {
    setCheckInFile(file);
    loadForm(file, setCheckInForm, setLoadingIn, 'check-in');
  }, [loadForm]);

  const handleLoadCheckOut = useCallback((file: ProjectFile) => {
    setCheckOutFile(file);
    loadForm(file, setCheckOutForm, setLoadingOut, 'check-out');
  }, [loadForm]);

  const canProceedFromStep2 = checkInForm !== null && checkOutForm !== null;

  const handleCompute = useCallback(() => {
    if (!canvasData || !checkInForm || !checkOutForm) return;
    if (selectedAssignmentIdx < 0) {
      showToast('กรุณาเลือก Assignment', 'error');
      return;
    }
    const finalRule: AttendanceScoreRule = {
      ...rule,
      checkInCutoff: checkInCutoff || undefined,
      checkOutEarliest: checkOutEarliest || undefined,
    };
    const evals = evaluateAttendance(checkInForm, checkOutForm, finalRule);
    const startRow = getPointsRowStart(canvasData.rows);
    const dataForMatch: ParsedFile = {
      headers: canvasData.headers,
      rows: canvasData.rows.slice(startRow),
    };
    const checkInEmails = new Set(checkInForm.entries.keys());
    const checkOutEmails = new Set(checkOutForm.entries.keys());
    const { rows: matched, formOnlyEmails: orphans } = matchAttendanceToCanvas(dataForMatch, evals, checkInEmails, checkOutEmails);
    setResults(matched);
    setFormOnlyEmails(orphans);
    setCurrentStep(4);
    const matchedCount = matched.filter(r => r.matched).length;
    showToast(`คำนวณเสร็จ: จับคู่ได้ ${matchedCount}/${matched.length} คน, ในไฟล์ Form ไม่พบใน Canvas: ${orphans.length}`, 'success');
  }, [canvasData, checkInForm, checkOutForm, selectedAssignmentIdx, rule, checkInCutoff, checkOutEarliest, showToast]);

  const stats = useMemo(() => {
    if (!results) return null;
    const both = results.filter(r => r.reason === 'both').length;
    const inOnly = results.filter(r => r.reason === 'checkInOnly').length;
    const outOnly = results.filter(r => r.reason === 'checkOutOnly').length;
    const absent = results.filter(r => r.reason === 'absent').length;
    const bothInvalid = results.filter(r => r.reason === 'bothInvalid').length;
    const unmatched = results.filter(r => r.reason === 'unmatched').length;
    return { total: results.length, both, inOnly, outOnly, absent, bothInvalid, unmatched };
  }, [results]);

  const buildOutputData = useCallback((): { headers: string[]; rows: string[][] } | null => {
    if (!results || !canvasData || selectedAssignmentIdx < 0) return null;
    const assignment = assignments[selectedAssignmentIdx];
    const startRow = getPointsRowStart(canvasData.rows);
    // Canvas import shape: fixed cols + assignment column
    const headers = [...canvasData.headers.slice(0, CANVAS_FIXED_COLS), assignment.name];
    // Preserve the Points Possible sentinel row if present so Canvas import accepts it
    const rows: string[][] = [];
    if (startRow === 1) {
      const pointsRow = canvasData.rows[0];
      rows.push([...pointsRow.slice(0, CANVAS_FIXED_COLS), pointsRow[assignment.index] || '']);
    }
    for (const r of results) {
      const originalRow = canvasData.rows[startRow + r.rowIndex] || [];
      const scoreStr = r.score !== null ? String(r.score) : (originalRow[assignment.index] || '');
      rows.push([...originalRow.slice(0, CANVAS_FIXED_COLS), scoreStr]);
    }
    return { headers, rows };
  }, [results, canvasData, selectedAssignmentIdx, assignments]);

  // Canvas-import output still saved as XLSX to the project since grade-upload flow
  // parses XLSX; local export honors the selected format.
  const buildOutputXlsx = useCallback((): Uint8Array | null => {
    const data = buildOutputData();
    if (!data) return null;
    return buildXlsx(data.headers, data.rows, 'Attendance');
  }, [buildOutputData]);

  const buildDetailedData = useCallback((): { headers: string[]; rows: string[][] } | null => {
    if (!results) return null;
    const headers = ['ชื่อ', 'ID', 'Email', 'สถานะ', 'เวลา check-in', 'เวลา check-out', 'คะแนน', 'หมายเหตุ'];
    const rows = results.map(r => [
      r.canvasName,
      r.canvasId,
      r.canvasEmail,
      REASON_LABEL[r.reason] || r.reason,
      r.checkInTime || '',
      r.checkOutTime || '',
      r.score !== null ? String(r.score) : '',
      r.notes.join(' · '),
    ]);
    return { headers, rows };
  }, [results]);

  const handleDownload = useCallback(() => {
    const data = buildOutputData();
    if (!data) return;
    if (exportFormat === 'csv') {
      downloadCSV(buildCsv(data.headers, data.rows), 'attendance_canvas_import');
    } else {
      downloadXlsx(buildXlsx(data.headers, data.rows, 'Attendance'), 'attendance_canvas_import');
    }
    showToast(`ดาวน์โหลดไฟล์สำหรับ Canvas สำเร็จ (${exportFormat.toUpperCase()})`, 'success');
  }, [buildOutputData, exportFormat, showToast]);

  const handleDownloadDetail = useCallback(() => {
    const data = buildDetailedData();
    if (!data) return;
    if (exportFormat === 'csv') {
      downloadCSV(buildCsv(data.headers, data.rows), 'attendance_detail');
    } else {
      downloadXlsx(buildXlsx(data.headers, data.rows, 'รายละเอียด'), 'attendance_detail');
    }
    showToast(`ดาวน์โหลดรายละเอียดสำเร็จ (${exportFormat.toUpperCase()})`, 'success');
  }, [buildDetailedData, exportFormat, showToast]);

  const handleSaveToProject = useCallback(async () => {
    const buf = buildOutputXlsx();
    if (!buf || !results || selectedAssignmentIdx < 0) return;
    const assignment = assignments[selectedAssignmentIdx];
    setSaving(true);
    try {
      await saveOutput('attendance', `เช็คชื่อ - ${assignment.name}`, buf, {
        total: results.length,
        matched: results.filter(r => r.matched).length,
        both: results.filter(r => r.reason === 'both').length,
        absent: results.filter(r => r.reason === 'absent').length,
        bothInvalid: results.filter(r => r.reason === 'bothInvalid').length,
        unmatched: results.filter(r => r.reason === 'unmatched').length,
        formOnlyEmails: formOnlyEmails.length,
      });
      showToast('บันทึกไปโปรเจคสำเร็จ — เปิดหน้า "อัปโหลดคะแนน" เพื่อดันขึ้น Canvas', 'success');
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildOutputXlsx, results, selectedAssignmentIdx, assignments, saveOutput, showToast, formOnlyEmails.length]);

  const handleReset = useCallback(() => {
    setCanvasFile(null); setCanvasData(null); setAssignments([]);
    setCheckInFile(null); setCheckOutFile(null);
    setCheckInForm(null); setCheckOutForm(null);
    setSelectedAssignmentIdx(-1);
    setRule(DEFAULT_ATTENDANCE_RULE);
    setCheckInCutoff(''); setCheckOutEarliest('');
    setResults(null); setFormOnlyEmails([]);
    setCurrentStep(1);
  }, []);

  return (
    <div>
      <ToastContainer />
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text-primary)]">เช็คชื่อจาก MS Form</h1>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* Step 1: Canvas file */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Canvas Gradebook</h3>
          <p className="text-sm text-[var(--color-text-muted)]">ใช้จับคู่นักศึกษาด้วย SIS Login ID / email</p>
          <FileSelector
            group="canvas"
            label="Canvas Export"
            selectedFileId={canvasFile?.id}
            onSelect={handleLoadCanvas}
          />
          {loadingCanvas && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              กำลังโหลด...
            </div>
          )}
          {canvasData && (
            <div className="flex items-center gap-3 rounded-lg bg-[var(--color-success)]/10 p-3">
              <span className="text-lg">✅</span>
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">{canvasFile?.originalFilename}</p>
                <p className="text-sm text-[var(--color-text-muted)]">{canvasData.rows.length} แถว, {assignments.length} assignments</p>
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Attendance forms */}
        <div className="space-y-4">
          <div className="glass-card p-6 space-y-3">
            <h3 className="font-semibold text-[var(--color-text-primary)]">ไฟล์ Check-in</h3>
            <p className="text-sm text-[var(--color-text-muted)]">MS Form ที่ให้นักศึกษากรอกตอนเข้าเรียน</p>
            <FileSelector
              group="attendance"
              label="Check-in"
              selectedFileId={checkInFile?.id}
              onSelect={handleLoadCheckIn}
            />
            {loadingIn && (
              <div className="text-sm text-[var(--color-accent)]">กำลังโหลด...</div>
            )}
            {checkInForm && (
              <div className="rounded-lg bg-[var(--color-success)]/10 p-3 text-sm space-y-1">
                <div>✅ พบ {checkInForm.entries.size} รายการ · Email col: {checkInForm.emailCol + 1}
                  {checkInForm.timeCol < 0 && <span className="ml-2 text-[var(--color-warning)]">(ไม่พบคอลัมน์เวลา — จะไม่ใช้ cutoff)</span>}
                </div>
                {checkInForm.droppedRowIndices.length > 0 && (
                  <div className="text-[var(--color-warning)]">
                    ⚠️ ข้าม {checkInForm.droppedRowIndices.length} แถวเพราะไม่มี email — แถวที่ {checkInForm.droppedRowIndices.slice(0, 10).map(i => i + 2).join(', ')}{checkInForm.droppedRowIndices.length > 10 ? '...' : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="glass-card p-6 space-y-3">
            <h3 className="font-semibold text-[var(--color-text-primary)]">ไฟล์ Check-out</h3>
            <p className="text-sm text-[var(--color-text-muted)]">MS Form ที่ให้นักศึกษากรอกตอนออก</p>
            <FileSelector
              group="attendance"
              label="Check-out"
              selectedFileId={checkOutFile?.id}
              onSelect={handleLoadCheckOut}
            />
            {loadingOut && (
              <div className="text-sm text-[var(--color-accent)]">กำลังโหลด...</div>
            )}
            {checkOutForm && (
              <div className="rounded-lg bg-[var(--color-success)]/10 p-3 text-sm space-y-1">
                <div>✅ พบ {checkOutForm.entries.size} รายการ · Email col: {checkOutForm.emailCol + 1}
                  {checkOutForm.timeCol < 0 && <span className="ml-2 text-[var(--color-warning)]">(ไม่พบคอลัมน์เวลา — จะไม่ใช้ cutoff)</span>}
                </div>
                {checkOutForm.droppedRowIndices.length > 0 && (
                  <div className="text-[var(--color-warning)]">
                    ⚠️ ข้าม {checkOutForm.droppedRowIndices.length} แถวเพราะไม่มี email — แถวที่ {checkOutForm.droppedRowIndices.slice(0, 10).map(i => i + 2).join(', ')}{checkOutForm.droppedRowIndices.length > 10 ? '...' : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setCurrentStep(1)} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">← ย้อนกลับ</button>
            <button
              onClick={() => setCurrentStep(3)}
              disabled={!canProceedFromStep2}
              className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
            >
              ถัดไป →
            </button>
          </div>
        </div>

        {/* Step 3: Assignment + rule */}
        <div className="space-y-4">
          <div className="glass-card p-6 space-y-3">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือก Assignment ปลายทาง</h3>
            <p className="text-sm text-[var(--color-text-muted)]">เลือกคอลัมน์ที่จะใส่คะแนนเช็คชื่อ (จาก Canvas gradebook)</p>
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-lg border border-white/10 p-3">
              {assignments.map((a, i) => (
                <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${selectedAssignmentIdx === i ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                  <input
                    type="radio"
                    name="assignment"
                    checked={selectedAssignmentIdx === i}
                    onChange={() => setSelectedAssignmentIdx(i)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-sm text-[var(--color-text-primary)]">{a.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="glass-card p-6 space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">กติกาการให้คะแนน</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-text-muted)]">มาครบ (ทั้ง check-in + check-out)</span>
                <input
                  type="number"
                  step="0.1"
                  value={rule.bothScore}
                  onChange={(e) => setRule(r => ({ ...r, bothScore: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-text-muted)]">มา check-in อย่างเดียว</span>
                <input
                  type="number"
                  step="0.1"
                  value={rule.checkInOnlyScore}
                  onChange={(e) => setRule(r => ({ ...r, checkInOnlyScore: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-text-muted)]">มา check-out อย่างเดียว</span>
                <input
                  type="number"
                  step="0.1"
                  value={rule.checkOutOnlyScore}
                  onChange={(e) => setRule(r => ({ ...r, checkOutOnlyScore: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-[var(--color-text-muted)]">ไม่มา (ทั้งสอง)</span>
                <input
                  type="number"
                  step="0.1"
                  value={rule.neitherScore}
                  onChange={(e) => setRule(r => ({ ...r, neitherScore: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="border-t border-white/10 pt-4 space-y-3">
              <p className="text-sm text-[var(--color-text-muted)]">
                (ไม่บังคับ) เงื่อนไขเวลา — ถ้ากรอก จะตัดคนที่ส่งเลยเวลาออก
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm text-[var(--color-text-muted)]">เวลาปิดรับ check-in</span>
                  <input
                    type="datetime-local"
                    value={checkInCutoff}
                    onChange={(e) => setCheckInCutoff(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm text-[var(--color-text-muted)]">เวลาเปิดรับ check-out</span>
                  <input
                    type="datetime-local"
                    value={checkOutEarliest}
                    onChange={(e) => setCheckOutEarliest(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setCurrentStep(2)} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">← ย้อนกลับ</button>
            <button
              onClick={handleCompute}
              disabled={selectedAssignmentIdx < 0}
              className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
            >
              คำนวณคะแนน
            </button>
          </div>
        </div>

        {/* Step 4: Results */}
        <div className="space-y-6">
          {results && stats && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
                  {(['xlsx', 'csv'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => setExportFormat(fmt)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        exportFormat === fmt
                          ? 'bg-[var(--color-accent)] text-[var(--color-bg-primary)]'
                          : 'text-[var(--color-text-muted)] hover:bg-white/5'
                      }`}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button onClick={handleDownload} className="rounded-xl bg-[var(--color-success)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90">
                  📥 ไฟล์สำหรับ Canvas Import
                </button>
                <button onClick={handleDownloadDetail} className="rounded-xl bg-white/10 px-6 py-2.5 font-semibold text-[var(--color-text-primary)] transition hover:bg-white/15">
                  📋 รายละเอียด
                </button>
                <button onClick={handleSaveToProject} disabled={saving} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">
                  {saving ? '💾 กำลังบันทึก...' : '💾 บันทึก + ไปหน้าอัปโหลด'}
                </button>
                <button onClick={handleReset} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">🔄 เริ่มใหม่</button>
              </div>

              <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-7">
                <StatCard icon="👥" label="ทั้งหมด" value={stats.total} />
                <StatCard icon="✅" label="มาครบ" value={stats.both} color="text-[var(--color-success)]" />
                <StatCard icon="⚠️" label="เข้าเท่านั้น" value={stats.inOnly} color="text-[var(--color-warning)]" />
                <StatCard icon="⚠️" label="ออกเท่านั้น" value={stats.outOnly} color="text-[var(--color-warning)]" />
                <StatCard icon="❌" label="ไม่ได้ส่งเลย" value={stats.absent} color="text-[var(--color-danger)]" />
                <StatCard icon="⏰" label="ส่งผิดช่วงเวลา" value={stats.bothInvalid} color="text-[var(--color-danger)]" />
                <StatCard icon="❓" label="ไม่พบใน Form" value={stats.unmatched} color="text-[var(--color-text-muted)]" />
              </div>

              <DataTable
                headers={['ชื่อ', 'ID', 'Email', 'สถานะ', 'Check-in', 'Check-out', 'คะแนน', 'หมายเหตุ']}
                rows={results.map(r => [
                  r.canvasName,
                  r.canvasId,
                  r.canvasEmail,
                  <span key="s" className={REASON_COLOR[r.reason]}>{REASON_LABEL[r.reason] || r.reason}</span>,
                  r.checkInTime || '—',
                  r.checkOutTime || '—',
                  r.score !== null ? String(r.score) : '—',
                  r.notes.length > 0
                    ? <span key="n" className="text-[var(--color-warning)]">{r.notes.join(' · ')}</span>
                    : <span key="ne" className="text-[var(--color-text-muted)]">—</span>,
                ])}
                paginate
                filterable
              />

              {/* Form-only orphans: emails in MS Form without a Canvas match */}
              {formOnlyEmails.length > 0 && (
                <div className="glass-card p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)]">
                      Email ใน MS Form ที่ไม่พบใน Canvas ({formOnlyEmails.length})
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      นักศึกษาอาจกรอก email ผิด หรือใช้บัญชีไม่ตรง — ตรวจสอบก่อนถือว่า &quot;ไม่มา&quot;
                    </p>
                  </div>
                  <DataTable
                    headers={['Email', 'อยู่ใน Check-in', 'อยู่ใน Check-out']}
                    rows={formOnlyEmails.map(o => [
                      o.email,
                      o.inCheckIn ? '✅' : '—',
                      o.inCheckOut ? '✅' : '—',
                    ])}
                    paginate
                    filterable
                  />
                </div>
              )}
            </>
          )}
        </div>
      </StepWizard>
    </div>
  );
}
