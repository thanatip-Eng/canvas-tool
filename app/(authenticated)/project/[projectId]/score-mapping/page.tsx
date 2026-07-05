'use client';

import { useState, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import SourceFilesSummary from '@/components/project/SourceFilesSummary';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsx, downloadXlsx } from '@/lib/xlsx-utils';
import { buildCsv, downloadCSV } from '@/lib/csv-utils';
import { validateCanvasFile, extractAssignments } from '@/lib/canvas-utils';
import { performStudentMatching } from '@/lib/student-matching';
import { CANVAS_FIXED_COLS, STATUS } from '@/lib/constants';
import type { ParsedFile, AssignmentInfo, MappingResultEntry, ExternalOrphan, ProjectFile } from '@/types';

const UNMATCH_REASON_LABEL: Record<string, string> = {
  'external-missing': 'ไม่พบในไฟล์ภายนอก',
  'external-blank': 'คอลัมน์คะแนนว่าง',
  'external-nonnumeric': 'คะแนนไม่ใช่ตัวเลข',
};

const STEPS = [
  { label: 'เลือกไฟล์ Canvas' },
  { label: 'เลือกไฟล์คะแนน' },
  { label: 'เลือก Assignment' },
  { label: 'ผลลัพธ์การจับคู่' },
];

interface MappingResult {
  results: MappingResultEntry[];
  orphans: ExternalOrphan[];
  assignmentIdx: number;
  totalMatched: number;
  totalNotFound: number;
  totalHadScore: number;
  totalOverwritten: number;
  totalBlankScore: number;
  totalNonNumeric: number;
}

export default function ScoreMappingPage() {
  const { loadFileContent, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // File selection
  const [selectedCanvasFile, setSelectedCanvasFile] = useState<ProjectFile | null>(null);
  const [selectedScoreFile, setSelectedScoreFile] = useState<ProjectFile | null>(null);

  // Loaded data
  const [canvasData, setCanvasData] = useState<ParsedFile | null>(null);
  const [scoreData, setScoreData] = useState<ParsedFile | null>(null);
  const [loadingCanvas, setLoadingCanvas] = useState(false);
  const [loadingScore, setLoadingScore] = useState(false);

  // Step 3: Assignment selection
  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<number>(-1);
  const [mappingMode, setMappingMode] = useState<'score' | 'attend'>('score');
  const [scoreColIdx, setScoreColIdx] = useState<number>(-1);
  const [attendScore, setAttendScore] = useState('1');

  // Step 4: Results
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  // Load Canvas file
  const handleLoadCanvas = useCallback(async (file: ProjectFile) => {
    setSelectedCanvasFile(file);
    setLoadingCanvas(true);
    try {
      const data = await loadFileContent(file);
      if (!validateCanvasFile(data)) {
        showToast('ไฟล์ไม่ใช่ Canvas gradebook export ที่ถูกต้อง', 'error');
        return;
      }
      const assigns = extractAssignments(data.headers);
      setCanvasData(data);
      setAssignments(assigns);
      showToast(`โหลดไฟล์สำเร็จ: ${data.rows.length} แถว, ${assigns.length} assignments`, 'success');
      setCurrentStep(2);
    } catch {
      showToast('เกิดข้อผิดพลาดในการอ่านไฟล์', 'error');
    } finally {
      setLoadingCanvas(false);
    }
  }, [loadFileContent, showToast]);

  // Load Score file
  const handleLoadScore = useCallback(async (file: ProjectFile) => {
    setSelectedScoreFile(file);
    setLoadingScore(true);
    try {
      const data = await loadFileContent(file);
      if (data.rows.length === 0) {
        showToast('ไฟล์คะแนนไม่มีข้อมูล', 'error');
        return;
      }
      setScoreData(data);
      const firstNumIdx = data.headers.findIndex((h, i) => i > 0 && !h.toLowerCase().includes('id') && !h.toLowerCase().includes('email') && !h.toLowerCase().includes('name'));
      setScoreColIdx(firstNumIdx >= 0 ? firstNumIdx : 0);
      showToast(`โหลดไฟล์คะแนนสำเร็จ: ${data.rows.length} แถว`, 'success');
      setCurrentStep(3);
    } catch {
      showToast('เกิดข้อผิดพลาดในการอ่านไฟล์คะแนน', 'error');
    } finally {
      setLoadingScore(false);
    }
  }, [loadFileContent, showToast]);

  // Perform matching
  const handleMatch = useCallback(() => {
    if (!canvasData || !scoreData || selectedAssignment < 0) {
      showToast('กรุณาเลือก Assignment', 'error');
      return;
    }
    const assignment = assignments[selectedAssignment];
    const { entries: results, orphans } = performStudentMatching(canvasData, scoreData, assignment.index, mappingMode, scoreColIdx, attendScore);
    const totalMatched = results.filter(r => r.status === STATUS.MATCHED).length;
    const totalNotFound = results.filter(r => r.status === STATUS.NOT_FOUND).length;
    const totalHadScore = results.filter(r => r.canvasScore).length;
    const totalOverwritten = results.filter(r => r.status === STATUS.MATCHED && r.canvasScore && r.matchedScore !== r.canvasScore).length;
    const totalBlankScore = results.filter(r => r.unmatchReason === 'external-blank').length;
    const totalNonNumeric = results.filter(r => r.unmatchReason === 'external-nonnumeric').length;
    setMappingResult({ results, orphans, assignmentIdx: assignment.index, totalMatched, totalNotFound, totalHadScore, totalOverwritten, totalBlankScore, totalNonNumeric });
    showToast(`จับคู่สำเร็จ: ${totalMatched} คน, ไม่พบ: ${totalNotFound} คน, ในไฟล์ภายนอกไม่พบใน Canvas: ${orphans.length} แถว`, 'success');
    setCurrentStep(4);
  }, [canvasData, scoreData, selectedAssignment, assignments, mappingMode, scoreColIdx, attendScore, showToast]);

  // Build Canvas-import output as {headers, rows}
  const buildExportData = useCallback((): { headers: string[]; rows: string[][] } | null => {
    if (!mappingResult || !canvasData) return null;
    const assignmentIdx = mappingResult.assignmentIdx;
    const assignmentName = canvasData.headers[assignmentIdx];
    // Canvas import format: only fixed cols + assignment column (no extra columns)
    const exportHeaders = [...canvasData.headers.slice(0, CANVAS_FIXED_COLS), assignmentName];
    const resultByRow = new Map(mappingResult.results.map(r => [r.rowIndex, r]));
    const exportRows = canvasData.rows.map((row, ri) => {
      const newRow = [...row.slice(0, CANVAS_FIXED_COLS), ''];
      const result = resultByRow.get(ri);
      newRow[CANVAS_FIXED_COLS] = (result && result.matchedScore !== undefined) ? result.matchedScore : (row[assignmentIdx] || '');
      return newRow;
    });
    return { headers: exportHeaders, rows: exportRows };
  }, [mappingResult, canvasData]);

  // Build XLSX buffer with comparison details (for project save)
  const buildDetailedXlsxBuffer = useCallback((): Uint8Array | null => {
    if (!mappingResult || !canvasData) return null;
    const assignmentName = canvasData.headers[mappingResult.assignmentIdx];
    const headers = ['ชื่อ', 'ID', 'สถานะ', `คะแนนเดิม (Canvas)`, `คะแนนใหม่ - ${assignmentName}`, 'เปลี่ยนแปลง', 'จับคู่โดย', 'เหตุผลที่ไม่ผ่าน'];
    const rows = mappingResult.results.map(r => {
      const oldScore = r.canvasScore || '';
      const newScore = r.matchedScore ?? '';
      const hasChange = r.status === STATUS.MATCHED && oldScore !== newScore;
      const changeLabel = r.status !== STATUS.MATCHED ? '-' : !oldScore && newScore ? 'ใหม่' : hasChange ? 'เปลี่ยน' : 'เท่าเดิม';
      const reason = r.unmatchReason ? (UNMATCH_REASON_LABEL[r.unmatchReason] || r.unmatchReason) : '-';
      return [r.canvasName, r.canvasId, r.status === STATUS.MATCHED ? 'สำเร็จ' : 'ไม่พบ', oldScore || '-', r.status === STATUS.MATCHED ? newScore : '-', changeLabel, r.matchedBy || '-', reason];
    });
    return buildXlsx(headers, rows, 'Map คะแนน');
  }, [mappingResult, canvasData]);

  // Export honoring selected format
  const handleExport = useCallback(() => {
    const data = buildExportData();
    if (!data) return;
    if (exportFormat === 'csv') {
      downloadCSV(buildCsv(data.headers, data.rows), 'canvas_grades');
    } else {
      downloadXlsx(buildXlsx(data.headers, data.rows, 'Map คะแนน'), 'canvas_grades');
    }
    showToast(`ดาวน์โหลด ${exportFormat.toUpperCase()} สำเร็จ`, 'success');
  }, [buildExportData, exportFormat, showToast]);

  // Save to project (use detailed version with comparison)
  const handleSaveToProject = useCallback(async () => {
    const buf = buildDetailedXlsxBuffer();
    if (!buf || !mappingResult) return;
    setSaving(true);
    try {
      const assignmentName = canvasData?.headers[mappingResult.assignmentIdx] || 'assignment';
      await saveOutput('score-mapping', `Map คะแนน - ${assignmentName}`, buf, {
        matched: mappingResult.totalMatched,
        notFound: mappingResult.totalNotFound,
        hadScore: mappingResult.totalHadScore,
        overwritten: mappingResult.totalOverwritten,
        blankScore: mappingResult.totalBlankScore,
        nonNumeric: mappingResult.totalNonNumeric,
        externalOrphans: mappingResult.orphans.length,
      });
      showToast('บันทึกผลลัพธ์ไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildDetailedXlsxBuffer, mappingResult, canvasData, saveOutput, showToast]);

  // Reset
  const handleReset = useCallback(() => {
    setCanvasData(null);
    setScoreData(null);
    setSelectedCanvasFile(null);
    setSelectedScoreFile(null);
    setAssignments([]);
    setSelectedAssignment(-1);
    setMappingMode('score');
    setScoreColIdx(-1);
    setAttendScore('1');
    setMappingResult(null);
    setCurrentStep(1);
  }, []);

  return (
    <div>
      <ToastContainer />
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text-primary)]">Map คะแนน</h1>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* Step 1: Select Canvas file */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Canvas Gradebook</h3>
          <FileSelector
            group="canvas"
            label="Canvas Export"
            selectedFileId={selectedCanvasFile?.id}
            onSelect={handleLoadCanvas}
          />
          {loadingCanvas && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              กำลังโหลดไฟล์...
            </div>
          )}
          {canvasData && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-[var(--color-success)]/10 p-3">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-semibold text-[var(--color-text-primary)]">{selectedCanvasFile?.originalFilename}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{canvasData.rows.length} นักศึกษา, {assignments.length} assignments</p>
                </div>
              </div>
              <button onClick={() => setCurrentStep(2)} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)]">
                ถัดไป →
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Select Score file */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์คะแนน</h3>
          <FileSelector
            group="score"
            label="ไฟล์คะแนน"
            selectedFileId={selectedScoreFile?.id}
            onSelect={handleLoadScore}
          />
          {loadingScore && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              กำลังโหลดไฟล์...
            </div>
          )}
          {scoreData && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-[var(--color-success)]/10 p-3">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-semibold text-[var(--color-text-primary)]">{selectedScoreFile?.originalFilename}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{scoreData.rows.length} แถว, {scoreData.headers.length} คอลัมน์</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setCurrentStep(1)} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">← ย้อนกลับ</button>
                <button onClick={() => setCurrentStep(3)} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)]">ถัดไป →</button>
              </div>
            </div>
          )}
        </div>

        {/* Step 3: Assignment selection (unchanged logic) */}
        <div className="glass-card p-6 space-y-6">
          <div>
            <h3 className="mb-3 font-semibold text-[var(--color-text-primary)]">เลือก Assignment</h3>
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-lg border border-white/10 p-3">
              {assignments.map((a, i) => (
                <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${selectedAssignment === i ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                  <input type="radio" name="assignment" checked={selectedAssignment === i} onChange={() => setSelectedAssignment(i)} className="accent-[var(--color-accent)]" />
                  <span className="text-sm text-[var(--color-text-primary)]">{a.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-semibold text-[var(--color-text-primary)]">โหมดการจับคู่</h3>
            <div className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="mode" checked={mappingMode === 'score'} onChange={() => setMappingMode('score')} className="accent-[var(--color-accent)]" />
                <span className="text-sm text-[var(--color-text-primary)]">ใช้คะแนนจากไฟล์</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="mode" checked={mappingMode === 'attend'} onChange={() => setMappingMode('attend')} className="accent-[var(--color-accent)]" />
                <span className="text-sm text-[var(--color-text-primary)]">เช็คชื่อ (ให้คะแนนเท่ากัน)</span>
              </label>
            </div>
          </div>
          {mappingMode === 'score' && scoreData && (
            <div>
              <h3 className="mb-2 font-semibold text-[var(--color-text-primary)]">เลือกคอลัมน์คะแนน</h3>
              <select value={scoreColIdx} onChange={(e) => setScoreColIdx(Number(e.target.value))} className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]">
                {scoreData.headers.map((h, i) => (<option key={i} value={i} className="bg-[var(--color-bg-primary)]">{h || `คอลัมน์ ${i + 1}`}</option>))}
              </select>
            </div>
          )}
          {mappingMode === 'attend' && (
            <div>
              <h3 className="mb-2 font-semibold text-[var(--color-text-primary)]">คะแนนที่ให้เมื่อมาเรียน</h3>
              <input type="number" value={attendScore} onChange={(e) => setAttendScore(e.target.value)} className="w-32 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]" />
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setCurrentStep(2)} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">← ย้อนกลับ</button>
            <button onClick={handleMatch} disabled={selectedAssignment < 0} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">จับคู่คะแนน</button>
          </div>
        </div>

        {/* Step 4: Results + save to project */}
        <div className="space-y-6">
          {mappingResult && (
            <>
              <SourceFilesSummary
                files={[
                  { label: 'Canvas', filename: selectedCanvasFile?.originalFilename },
                  { label: 'ไฟล์คะแนน', filename: selectedScoreFile?.originalFilename },
                  { label: 'คอลัมน์คะแนน', filename: mappingMode === 'score' && scoreData ? scoreData.headers[scoreColIdx] : (mappingMode === 'attend' ? `เช็คชื่อ (ให้ ${attendScore} คะแนน)` : undefined) },
                  { label: 'Assignment ปลายทาง', filename: canvasData && mappingResult ? canvasData.headers[mappingResult.assignmentIdx] : undefined },
                ]}
              />
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
                <button onClick={handleExport} className="rounded-xl bg-[var(--color-success)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90">📥 ดาวน์โหลด</button>
                <button onClick={handleSaveToProject} disabled={saving} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">
                  {saving ? '💾 กำลังบันทึก...' : '💾 บันทึกไปโปรเจค'}
                </button>
                <button onClick={handleReset} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">🔄 เริ่มใหม่</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-8">
                <StatCard icon="👥" label="นักศึกษาทั้งหมด" value={mappingResult.results.length} />
                <StatCard icon="✅" label="จับคู่สำเร็จ" value={mappingResult.totalMatched} color="text-[var(--color-success)]" />
                <StatCard icon="❌" label="ไม่พบในไฟล์ภายนอก" value={mappingResult.totalNotFound - mappingResult.totalBlankScore - mappingResult.totalNonNumeric} color="text-[var(--color-danger)]" />
                <StatCard icon="⬜" label="คะแนนว่าง" value={mappingResult.totalBlankScore} color="text-[var(--color-warning)]" />
                <StatCard icon="🔤" label="คะแนนไม่ใช่ตัวเลข" value={mappingResult.totalNonNumeric} color="text-[var(--color-warning)]" />
                <StatCard icon="👤" label="ในไฟล์ภายนอก ไม่มีใน Canvas" value={mappingResult.orphans.length} color="text-[var(--color-info)]" />
                <StatCard icon="📋" label="มีคะแนนเดิม" value={mappingResult.totalHadScore} color="text-[var(--color-info)]" />
                <StatCard icon="🔄" label="เปลี่ยนแปลง" value={mappingResult.totalOverwritten} color="text-[var(--color-warning)]" />
              </div>
              <DataTable
                headers={['ชื่อ', 'ID', 'สถานะ', 'คะแนนเดิม (Canvas)', 'คะแนนใหม่', 'เปลี่ยนแปลง', 'จับคู่โดย', 'เหตุผลที่ไม่ผ่าน']}
                rows={mappingResult.results.map(r => {
                  const oldScore = r.canvasScore || '';
                  const newScore = r.matchedScore ?? '';
                  const hasChange = r.status === STATUS.MATCHED && oldScore !== newScore;
                  const changeLabel = r.status !== STATUS.MATCHED
                    ? '-'
                    : !oldScore && newScore
                      ? '🆕 ใหม่'
                      : hasChange
                        ? '🔄 เปลี่ยน'
                        : '= เท่าเดิม';
                  const changeColor = r.status !== STATUS.MATCHED
                    ? ''
                    : !oldScore && newScore
                      ? 'text-[var(--color-info)]'
                      : hasChange
                        ? 'text-[var(--color-warning)]'
                        : 'text-[var(--color-text-muted)]';
                  const reasonLabel = r.unmatchReason
                    ? UNMATCH_REASON_LABEL[r.unmatchReason] || r.unmatchReason
                    : '';
                  return [
                    r.canvasName,
                    r.canvasId,
                    <span key="status" className={r.status === STATUS.MATCHED ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>{r.status === STATUS.MATCHED ? '✅ สำเร็จ' : '❌ ไม่พบ'}</span>,
                    oldScore || <span key="empty" className="text-[var(--color-text-muted)]">-</span>,
                    r.status === STATUS.MATCHED ? newScore : <span key="no-match" className="text-[var(--color-text-muted)]">-</span>,
                    <span key="change" className={changeColor}>{changeLabel}</span>,
                    r.matchedBy || '-',
                    reasonLabel
                      ? <span key="reason" className="text-[var(--color-warning)]">{reasonLabel}</span>
                      : <span key="reason-empty" className="text-[var(--color-text-muted)]">-</span>,
                  ];
                })}
                paginate
                filterable
              />

              {/* Orphan external rows (not found in Canvas) */}
              {mappingResult.orphans.length > 0 && (
                <div className="glass-card p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold text-[var(--color-text-primary)]">
                      แถวในไฟล์ภายนอกที่ไม่พบใน Canvas ({mappingResult.orphans.length})
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      แถวเหล่านี้มี email/ID แต่ไม่มีนักศึกษาที่ตรงกันในไฟล์ Canvas — ตรวจสอบว่าใช้ email ที่ถูก หรือ นักศึกษาเพิ่งถอน
                    </p>
                  </div>
                  <DataTable
                    headers={['#', 'Email', 'ID', 'คะแนน']}
                    rows={mappingResult.orphans.map(o => [
                      String(o.externalRowIndex + 1),
                      o.email || <span key="e" className="text-[var(--color-text-muted)]">-</span>,
                      o.id || <span key="i" className="text-[var(--color-text-muted)]">-</span>,
                      o.score || <span key="s" className="text-[var(--color-text-muted)]">-</span>,
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
