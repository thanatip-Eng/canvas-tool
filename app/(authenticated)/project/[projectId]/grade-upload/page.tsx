'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { downloadXlsx } from '@/lib/xlsx-utils';
import { apiGet, apiPostJson } from '@/lib/api-client';
import {
  detectUploadableColumns,
  detectStudentIdColumn,
  detectStudentNameColumn,
  extractGradeData,
  buildComparisonRows,
  filterGrades,
  buildBackupXlsx,
  buildUploadLogXlsx,
  type CurrentCanvasScore,
  type ExtractedGrade,
} from '@/lib/grade-upload-utils';
import type { OutputFile, GradeUploadEntry, UploadMode, ChangeFilter, GradeUploadResult } from '@/types';

const STEPS = [
  { label: '1. เลือกผลลัพธ์' },
  { label: '2. เลือกคอลัมน์ + Assignment' },
  { label: '3. โหมดอัปโหลด' },
  { label: '4. ตรวจสอบคะแนน' },
  { label: '5. ยืนยัน + อัปโหลด' },
  { label: '6. ผลลัพธ์' },
];

const UPLOADABLE_TYPES = new Set([
  'score-mapping', 'edpuzzle-analysis', 'auto-grade', 'grade-compare', 'grade-backup',
]);

interface CanvasAssignment {
  id: number;
  name: string;
  points_possible: number | null;
}

export default function GradeUploadPage() {
  const { project, outputs, loadOutputContent, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Select output
  const [selectedOutput, setSelectedOutput] = useState<OutputFile | null>(null);
  const [outputContent, setOutputContent] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Step 2: Select column + assignment
  const [scoreColIdx, setScoreColIdx] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<CanvasAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<CanvasAssignment | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignmentSearch, setAssignmentSearch] = useState('');

  // Step 3: Upload mode
  const [uploadMode, setUploadMode] = useState<UploadMode>('missing-only');
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all-changed');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [studentSearch, setStudentSearch] = useState('');

  // Step 4: Preview
  const [comparisonRows, setComparisonRows] = useState<GradeUploadEntry[]>([]);
  const [filteredRows, setFilteredRows] = useState<GradeUploadEntry[]>([]);
  const [currentCanvasScores, setCurrentCanvasScores] = useState<Map<string, CurrentCanvasScore>>(new Map());
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Step 5: Confirm + Upload
  const [confirmText, setConfirmText] = useState('');
  const [backupSaved, setBackupSaved] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Step 6: Results
  const [uploadResults, setUploadResults] = useState<GradeUploadResult[]>([]);
  const [uploadSummary, setUploadSummary] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const courseId = project?.canvasCourseId;

  // Auto-select output from query param
  useEffect(() => {
    const outputId = searchParams.get('outputId');
    if (outputId && outputs.length > 0 && !selectedOutput) {
      const found = outputs.find(o => o.id === outputId);
      if (found && UPLOADABLE_TYPES.has(found.featureType)) {
        handleSelectOutput(found);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, outputs]);

  // Detected columns
  const uploadableColumns = useMemo(() => {
    if (!outputContent || !selectedOutput) return [];
    return detectUploadableColumns(outputContent.headers, outputContent.rows, selectedOutput.featureType);
  }, [outputContent, selectedOutput]);

  // Student ID / name column indices
  const studentIdColIdx = useMemo(() => {
    if (!outputContent) return -1;
    return detectStudentIdColumn(outputContent.headers);
  }, [outputContent]);

  const nameColIdx = useMemo(() => {
    if (!outputContent) return 0;
    return detectStudentNameColumn(outputContent.headers);
  }, [outputContent]);

  // Extracted grades from selected column
  const extractedGrades = useMemo((): ExtractedGrade[] => {
    if (!outputContent || scoreColIdx === null || studentIdColIdx < 0) return [];
    return extractGradeData(outputContent.headers, outputContent.rows, scoreColIdx, studentIdColIdx, nameColIdx);
  }, [outputContent, scoreColIdx, studentIdColIdx, nameColIdx]);

  // Filter uploadable outputs
  const uploadableOutputs = useMemo(
    () => outputs.filter(o => UPLOADABLE_TYPES.has(o.featureType)),
    [outputs]
  );

  // ==================== Step 1: Select Output ====================

  const handleSelectOutput = useCallback(async (output: OutputFile) => {
    setSelectedOutput(output);
    setLoadingContent(true);
    try {
      const content = await loadOutputContent(output);
      setOutputContent(content);
      setCurrentStep(2);
      if (courseId) {
        setLoadingAssignments(true);
        try {
          const data = await apiGet<{ assignments: CanvasAssignment[] }>('/api/canvas/assignments', {
            courseId: String(courseId),
          });
          setAssignments(data.assignments || []);
        } catch {
          showToast('ไม่สามารถดึงรายการ Assignment ได้', 'error');
        } finally {
          setLoadingAssignments(false);
        }
      }
    } catch {
      showToast('ไม่สามารถโหลดเนื้อหาผลลัพธ์ได้', 'error');
    } finally {
      setLoadingContent(false);
    }
  }, [loadOutputContent, courseId, showToast]);

  // Auto-suggest assignment when score column is selected
  const suggestedAssignment = useMemo(() => {
    if (scoreColIdx === null || !outputContent) return null;
    const header = outputContent.headers[scoreColIdx] || '';
    const match = header.match(/\((\d+)\)/);
    if (match) {
      return assignments.find(a => String(a.id) === match[1]) || null;
    }
    return null;
  }, [scoreColIdx, outputContent, assignments]);

  // ==================== Step 2 → 3 ====================

  const handleConfirmColumn = useCallback(() => {
    if (scoreColIdx === null || !selectedAssignment) {
      showToast('กรุณาเลือกคอลัมน์คะแนนและ Assignment', 'error');
      return;
    }
    setCurrentStep(3);
  }, [scoreColIdx, selectedAssignment, showToast]);

  // ==================== Step 3 → 4: Load Preview ====================

  const handleLoadPreview = useCallback(async () => {
    if (!courseId || !selectedAssignment) return;

    setLoadingPreview(true);
    try {
      const data = await apiGet<{ submissions?: any[] }>('/api/canvas/assignment-submissions', {
        courseId: String(courseId),
        assignmentId: String(selectedAssignment.id),
      });

      const scoresMap = new Map<string, CurrentCanvasScore>();
      for (const sub of (data.submissions || [])) {
        const sisId = sub.user?.sis_user_id;
        if (!sisId) continue;
        scoresMap.set(sisId, {
          sisUserId: sisId,
          studentName: sub.user?.name || sisId,
          score: sub.score != null ? String(sub.score) : null,
          canvasUserId: sub.user_id,
        });
      }
      setCurrentCanvasScores(scoresMap);

      // Build comparison
      const comparison = buildComparisonRows(extractedGrades, scoresMap);
      setComparisonRows(comparison);

      // Apply filter
      const filtered = filterGrades(comparison, uploadMode, changeFilter, selectedStudentIds);
      setFilteredRows(filtered);

      setCurrentStep(4);
    } catch {
      showToast('ไม่สามารถดึงคะแนนปัจจุบันจาก Canvas ได้', 'error');
    } finally {
      setLoadingPreview(false);
    }
  }, [courseId, selectedAssignment, extractedGrades, uploadMode, changeFilter, selectedStudentIds, showToast]);

  // Re-filter when mode changes in step 4
  const handleRefilter = useCallback(() => {
    const filtered = filterGrades(comparisonRows, uploadMode, changeFilter, selectedStudentIds);
    setFilteredRows(filtered);
  }, [comparisonRows, uploadMode, changeFilter, selectedStudentIds]);

  // ==================== Step 4 → 5 ====================

  const handleProceedToConfirm = useCallback(() => {
    if (filteredRows.length === 0) {
      showToast('ไม่มีคะแนนที่จะอัปโหลด', 'error');
      return;
    }
    setCurrentStep(5);
  }, [filteredRows, showToast]);

  // ==================== Step 5: Backup + Upload ====================

  const handleSaveBackup = useCallback(async () => {
    if (!selectedAssignment) return;
    setSavingBackup(true);
    try {
      const buf = buildBackupXlsx(selectedAssignment.name, currentCanvasScores);
      await saveOutput('grade-backup', `Backup: ${selectedAssignment.name}`, buf, {
        assignmentId: selectedAssignment.id,
        studentCount: currentCanvasScores.size,
      });
      setBackupSaved(true);
      showToast('สำรองคะแนนเดิมสำเร็จ', 'success');
    } catch {
      showToast('สำรองคะแนนไม่สำเร็จ', 'error');
    } finally {
      setSavingBackup(false);
    }
  }, [selectedAssignment, currentCanvasScores, saveOutput, showToast]);

  const CONFIRM_WORD = 'ยืนยัน';
  const assignmentNameMatches = useMemo(() => {
    return confirmText.trim() === CONFIRM_WORD;
  }, [confirmText]);

  const handleUpload = useCallback(async () => {
    if (!courseId || !selectedAssignment) return;
    if (!assignmentNameMatches) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      const grades = filteredRows.map(r => ({
        sisUserId: r.sisUserId,
        score: r.newScore,
      }));

      const data = await apiPostJson<{
        results?: GradeUploadResult[];
        summary?: { total: number; success: number; failed: number };
        error?: string;
      }>('/api/canvas/grade-upload', {
        courseId: String(courseId),
        assignmentId: String(selectedAssignment.id),
        grades,
      });

      if (data.error && !data.results) {
        showToast(`อัปโหลดล้มเหลว: ${data.error}`, 'error');
        return;
      }

      setUploadResults(data.results || []);
      setUploadSummary(data.summary || { total: 0, success: 0, failed: 0 });
      setUploadProgress(100);

      // Auto-save upload log
      try {
        const logBuf = buildUploadLogXlsx(
          selectedAssignment.name,
          filteredRows,
          data.results || []
        );
        await saveOutput('grade-upload-log', `Upload: ${selectedAssignment.name}`, logBuf, {
          assignmentId: selectedAssignment.id,
          total: data.summary?.total || 0,
          success: data.summary?.success || 0,
          failed: data.summary?.failed || 0,
        });
      } catch {
        // Non-critical — log save failure
        console.error('Failed to save upload log');
      }

      setCurrentStep(6);
      showToast(`อัปโหลดเสร็จสิ้น: สำเร็จ ${data.summary?.success || 0}, ล้มเหลว ${data.summary?.failed || 0}`, 'success');
    } catch (err) {
      showToast(`เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
    } finally {
      setUploading(false);
    }
  }, [courseId, selectedAssignment, assignmentNameMatches, filteredRows, saveOutput, showToast]);

  // ==================== Step 6: Export ====================

  const handleDownloadLog = useCallback(() => {
    if (!selectedAssignment || filteredRows.length === 0) return;
    const buf = buildUploadLogXlsx(selectedAssignment.name, filteredRows, uploadResults);
    downloadXlsx(buf, `upload_log_${selectedAssignment.name}`);
    showToast('ดาวน์โหลดบันทึกการอัปโหลดสำเร็จ', 'success');
  }, [selectedAssignment, filteredRows, uploadResults, showToast]);

  // ==================== Stats ====================

  const previewStats = useMemo(() => {
    if (comparisonRows.length === 0) return null;
    const increased = comparisonRows.filter(r => r.changeType === 'increased').length;
    const decreased = comparisonRows.filter(r => r.changeType === 'decreased').length;
    const unchanged = comparisonRows.filter(r => r.changeType === 'unchanged').length;
    const newScore = comparisonRows.filter(r => r.changeType === 'blank_to_score').length;
    return { total: comparisonRows.length, increased, decreased, unchanged, newScore, filtered: filteredRows.length };
  }, [comparisonRows, filteredRows]);

  // ==================== Reset ====================

  const handleReset = useCallback(() => {
    setCurrentStep(1);
    setSelectedOutput(null);
    setOutputContent(null);
    setScoreColIdx(null);
    setAssignments([]);
    setSelectedAssignment(null);
    setUploadMode('missing-only');
    setChangeFilter('all-changed');
    setSelectedStudentIds(new Set());
    setComparisonRows([]);
    setFilteredRows([]);
    setCurrentCanvasScores(new Map());
    setConfirmText('');
    setBackupSaved(false);
    setUploadResults([]);
    setUploadSummary(null);
    setUploadProgress(0);
  }, []);

  // Filtered assignments for search
  const filteredAssignments = useMemo(() => {
    if (!assignmentSearch) return assignments;
    const q = assignmentSearch.toLowerCase();
    return assignments.filter(a => a.name.toLowerCase().includes(q) || String(a.id).includes(q));
  }, [assignments, assignmentSearch]);

  // ==================== RENDER ====================

  const featureLabel = (ft: string) => {
    const map: Record<string, string> = {
      'score-mapping': 'Map คะแนน',
      'edpuzzle-analysis': 'Edpuzzle',
      'auto-grade': 'ให้คะแนนอัตโนมัติ',
      'grade-compare': 'เปรียบเทียบคะแนน',
      'grade-backup': 'สำรองคะแนน',
    };
    return map[ft] || ft;
  };

  const featureIcon = (ft: string) => {
    const map: Record<string, string> = {
      'score-mapping': '📊',
      'edpuzzle-analysis': '🎬',
      'auto-grade': '⚡',
      'grade-compare': '📈',
      'grade-backup': '💾',
    };
    return map[ft] || '📄';
  };

  const changeLabel = (ct: GradeUploadEntry['changeType']) => {
    switch (ct) {
      case 'increased': return <span className="text-[var(--color-success)]">เพิ่มขึ้น</span>;
      case 'decreased': return <span className="text-[var(--color-danger)]">ลดลง</span>;
      case 'blank_to_score': return <span className="text-[var(--color-accent)]">ใหม่</span>;
      case 'unchanged': return <span className="text-[var(--color-text-muted)]">ไม่เปลี่ยน</span>;
      default: return <span>{ct}</span>;
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">อัปโหลดคะแนนเข้า Canvas</h1>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* ==================== Step 1: Select Output ==================== */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold mb-4">เลือกผลลัพธ์ที่ต้องการอัปโหลด</h2>

          {uploadableOutputs.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">ไม่พบผลลัพธ์ที่สามารถอัปโหลดได้ กรุณาสร้างผลลัพธ์จากฟีเจอร์อื่นก่อน</p>
          ) : (
            <div className="space-y-2">
              {uploadableOutputs.map(output => (
                <button
                  key={output.id}
                  onClick={() => handleSelectOutput(output)}
                  disabled={loadingContent}
                  className="w-full text-left glass-card p-4 hover:bg-white/10 transition flex items-center gap-3"
                >
                  <span className="text-xl">{featureIcon(output.featureType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{output.label}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {featureLabel(output.featureType)} &middot; {
                        output.createdAt && 'seconds' in output.createdAt
                          ? new Date(output.createdAt.seconds * 1000).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : ''
                      }
                    </p>
                  </div>
                  {loadingContent && selectedOutput?.id === output.id && (
                    <span className="text-sm text-[var(--color-text-muted)]">กำลังโหลด...</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ==================== Step 2: Select Column + Assignment ==================== */}
        <div className="space-y-6">
          {/* Score column selection */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold mb-4">เลือกคอลัมน์คะแนน</h2>
            {uploadableColumns.length === 0 ? (
              <p className="text-[var(--color-text-muted)]">ไม่พบคอลัมน์ที่มีคะแนนตัวเลข</p>
            ) : (
              <div className="space-y-2">
                {uploadableColumns.map(col => (
                  <button
                    key={col.index}
                    onClick={() => {
                      setScoreColIdx(col.index);
                      // Auto-suggest assignment
                      if (col.assignmentId) {
                        const found = assignments.find(a => String(a.id) === col.assignmentId);
                        if (found) setSelectedAssignment(found);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      scoreColIdx === col.index
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <p className="font-medium">{col.header}</p>
                    {col.assignmentId && (
                      <p className="text-xs text-[var(--color-accent)]">Assignment ID: {col.assignmentId}</p>
                    )}
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      ตัวอย่าง: {col.sampleValues.join(', ')}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {scoreColIdx !== null && studentIdColIdx < 0 && (
              <p className="mt-3 text-sm text-[var(--color-danger)]">
                ไม่พบคอลัมน์ SIS User ID — ไม่สามารถจับคู่กับ Canvas ได้
              </p>
            )}
          </div>

          {/* Assignment selection */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold mb-4">เลือก Assignment ปลายทาง</h2>
            {loadingAssignments ? (
              <p className="text-[var(--color-text-muted)]">กำลังดึงรายการ Assignment...</p>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="ค้นหา Assignment..."
                  value={assignmentSearch}
                  onChange={e => setAssignmentSearch(e.target.value)}
                  className="input-field mb-3 w-full"
                />
                {suggestedAssignment && selectedAssignment?.id !== suggestedAssignment.id && (
                  <div className="mb-3 p-3 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5">
                    <p className="text-sm text-[var(--color-accent)] mb-1">แนะนำจาก Assignment ID ในคอลัมน์:</p>
                    <button
                      onClick={() => setSelectedAssignment(suggestedAssignment)}
                      className="font-medium hover:underline"
                    >
                      {suggestedAssignment.name} (ID: {suggestedAssignment.id})
                    </button>
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {filteredAssignments.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedAssignment(a)}
                      className={`w-full text-left p-3 rounded-lg border transition text-sm ${
                        selectedAssignment?.id === a.id
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      {a.name}
                      {a.points_possible != null && (
                        <span className="text-[var(--color-text-muted)] ml-2">(เต็ม {a.points_possible})</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {selectedAssignment && (
              <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm font-medium">Assignment ที่เลือก:</p>
                <p className="text-[var(--color-accent)]">{selectedAssignment.name}</p>
                {selectedAssignment.points_possible != null && (
                  <p className="text-sm text-[var(--color-text-muted)]">คะแนนเต็ม: {selectedAssignment.points_possible}</p>
                )}
              </div>
            )}
          </div>

          {/* Summary + Next */}
          {scoreColIdx !== null && selectedAssignment && studentIdColIdx >= 0 && (
            <div className="glass-card p-4 flex items-center justify-between">
              <p className="text-sm">
                พบ <span className="font-bold text-[var(--color-accent)]">{extractedGrades.length}</span> คะแนน
                จากคอลัมน์ &quot;{outputContent?.headers[scoreColIdx]}&quot;
              </p>
              <button onClick={handleConfirmColumn} className="btn-primary px-6 py-2">
                ถัดไป
              </button>
            </div>
          )}
        </div>

        {/* ==================== Step 3: Upload Mode ==================== */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold mb-4">เลือกโหมดอัปโหลด</h2>

          <div className="space-y-3">
            {([
              { mode: 'all' as UploadMode, label: 'อัปโหลดทั้งหมด', desc: 'อัปโหลดคะแนนทุกคน ไม่ว่าจะเปลี่ยนแปลงหรือไม่' },
              { mode: 'missing-only' as UploadMode, label: 'เฉพาะคะแนนว่าง/ศูนย์ใน Canvas', desc: 'อัปโหลดเฉพาะคนที่ Canvas ยังไม่มีคะแนน' },
              { mode: 'changed' as UploadMode, label: 'เฉพาะที่เปลี่ยนแปลง', desc: 'เลือกเฉพาะคะแนนที่ต่างจาก Canvas' },
              { mode: 'selected' as UploadMode, label: 'เลือกเอง', desc: 'เลือกนักศึกษาที่ต้องการอัปโหลดเป็นรายบุคคล' },
            ]).map(opt => (
              <label key={opt.mode} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                uploadMode === opt.mode ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 hover:border-white/20'
              }`}>
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === opt.mode}
                  onChange={() => setUploadMode(opt.mode)}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">{opt.label}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Changed sub-options */}
          {uploadMode === 'changed' && (
            <div className="mt-4 ml-8 space-y-2">
              {([
                { filter: 'all-changed' as ChangeFilter, label: 'ทั้งหมดที่เปลี่ยน' },
                { filter: 'increased-only' as ChangeFilter, label: 'เฉพาะที่เพิ่มขึ้น' },
                { filter: 'decreased-only' as ChangeFilter, label: 'เฉพาะที่ลดลง' },
              ]).map(opt => (
                <label key={opt.filter} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="changeFilter"
                    checked={changeFilter === opt.filter}
                    onChange={() => setChangeFilter(opt.filter)}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Selected students */}
          {uploadMode === 'selected' && (
            <div className="mt-4">
              <input
                type="text"
                placeholder="ค้นหานักศึกษา..."
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                className="input-field mb-2 w-full"
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {extractedGrades
                  .filter(g => !studentSearch || g.studentName.includes(studentSearch) || g.sisUserId.includes(studentSearch))
                  .map(g => (
                  <label key={g.sisUserId} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.has(g.sisUserId)}
                      onChange={e => {
                        const next = new Set(selectedStudentIds);
                        if (e.target.checked) next.add(g.sisUserId);
                        else next.delete(g.sisUserId);
                        setSelectedStudentIds(next);
                      }}
                    />
                    <span>{g.studentName}</span>
                    <span className="text-[var(--color-text-muted)]">({g.sisUserId})</span>
                    <span className="ml-auto">{g.score}</span>
                  </label>
                ))}
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-2">
                เลือกแล้ว {selectedStudentIds.size} คน
              </p>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleLoadPreview}
              disabled={loadingPreview || (uploadMode === 'selected' && selectedStudentIds.size === 0)}
              className="btn-primary px-6 py-2"
            >
              {loadingPreview ? 'กำลังดึงคะแนน...' : 'ดึงคะแนนปัจจุบัน + Preview'}
            </button>
          </div>
        </div>

        {/* ==================== Step 4: Preview ==================== */}
        <div className="space-y-4">
          {/* Stats */}
          {previewStats && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard icon="📋" label="ทั้งหมด" value={previewStats.total} />
              <StatCard icon="📤" label="จะอัปโหลด" value={previewStats.filtered} color="text-[var(--color-accent)]" />
              <StatCard icon="📈" label="เพิ่มขึ้น" value={previewStats.increased} color="text-[var(--color-success)]" />
              <StatCard icon="📉" label="ลดลง" value={previewStats.decreased} color="text-[var(--color-danger)]" />
              <StatCard icon="🆕" label="ใหม่" value={previewStats.newScore} color="text-[var(--color-accent)]" />
              <StatCard icon="➖" label="ไม่เปลี่ยน" value={previewStats.unchanged} />
            </div>
          )}

          {/* Mode change */}
          <div className="glass-card p-4 flex items-center gap-4 flex-wrap">
            <span className="text-sm text-[var(--color-text-muted)]">โหมด:</span>
            <select
              value={uploadMode}
              onChange={e => { setUploadMode(e.target.value as UploadMode); }}
              className="input-field text-sm py-1"
            >
              <option value="all">ทั้งหมด</option>
              <option value="missing-only">เฉพาะคะแนนว่าง</option>
              <option value="changed">เฉพาะที่เปลี่ยน</option>
              <option value="selected">เลือกเอง</option>
            </select>
            {uploadMode === 'changed' && (
              <select
                value={changeFilter}
                onChange={e => setChangeFilter(e.target.value as ChangeFilter)}
                className="input-field text-sm py-1"
              >
                <option value="all-changed">ทั้งหมดที่เปลี่ยน</option>
                <option value="increased-only">เฉพาะเพิ่มขึ้น</option>
                <option value="decreased-only">เฉพาะลดลง</option>
              </select>
            )}
            <button onClick={handleRefilter} className="btn-secondary text-sm px-3 py-1">
              อัปเดตตัวกรอง
            </button>
          </div>

          {/* Comparison table */}
          <div className="glass-card p-4">
            <h3 className="font-semibold mb-3">
              คะแนนที่จะอัปโหลด ({filteredRows.length} คน)
              {selectedAssignment && (
                <span className="text-sm font-normal text-[var(--color-text-muted)] ml-2">
                  → {selectedAssignment.name}
                </span>
              )}
            </h3>
            <DataTable
              headers={['ชื่อ', 'SIS User ID', 'คะแนนเดิม (Canvas)', 'คะแนนใหม่', 'สถานะ']}
              rows={filteredRows.map(r => [
                r.studentName,
                r.sisUserId,
                r.currentScore ?? '—',
                r.newScore,
                changeLabel(r.changeType),
              ])}
              paginate
              defaultPageSize={25}
              filterable
              stickyHeader
            />
          </div>

          <div className="flex justify-between">
            <button onClick={() => setCurrentStep(3)} className="btn-secondary px-4 py-2">
              ← กลับ
            </button>
            <button
              onClick={handleProceedToConfirm}
              disabled={filteredRows.length === 0}
              className="btn-primary px-6 py-2"
            >
              ยืนยันและดำเนินการ ({filteredRows.length} คน)
            </button>
          </div>
        </div>

        {/* ==================== Step 5: Confirm + Upload ==================== */}
        <div className="space-y-4">
          {/* Warning box */}
          <div className="border-2 border-[var(--color-danger)] rounded-xl p-6 bg-[var(--color-danger)]/5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">⚠️</span>
              <h2 className="text-lg font-bold text-[var(--color-danger)]">ยืนยันการอัปโหลดคะแนน</h2>
            </div>
            <p className="mb-2">
              กำลังจะเปลี่ยนคะแนน <span className="font-bold text-[var(--color-danger)]">{filteredRows.length} คน</span>
            </p>
            <p className="mb-1">
              Assignment: <span className="font-bold text-[var(--color-accent)]">{selectedAssignment?.name}</span>
            </p>
            <p className="mb-1">
              คอร์ส: <span className="font-bold">{project?.courseName}</span>
            </p>
            {selectedAssignment?.points_possible != null && (
              <p className="text-sm text-[var(--color-text-muted)]">
                คะแนนเต็ม: {selectedAssignment.points_possible}
              </p>
            )}
          </div>

          {/* Backup */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">สำรองคะแนนเดิม</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {backupSaved
                    ? '✅ สำรองเรียบร้อยแล้ว'
                    : 'แนะนำให้สำรองคะแนนเดิมก่อนอัปโหลด'}
                </p>
              </div>
              <button
                onClick={handleSaveBackup}
                disabled={savingBackup || backupSaved}
                className="btn-secondary px-4 py-2"
              >
                {savingBackup ? 'กำลังสำรอง...' : backupSaved ? 'สำรองแล้ว' : 'สำรองคะแนน'}
              </button>
            </div>
          </div>

          {/* Type confirm word */}
          <div className="glass-card p-4">
            <p className="text-sm mb-2">
              พิมพ์คำว่า <span className="font-bold text-[var(--color-danger)]">&quot;{CONFIRM_WORD}&quot;</span> เพื่อเปิดปุ่มอัปโหลด
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={`พิมพ์ "${CONFIRM_WORD}" ที่นี่...`}
              className="input-field w-full"
            />
          </div>

          {/* Upload button */}
          <div className="flex justify-between items-center">
            <button onClick={() => setCurrentStep(4)} className="btn-secondary px-4 py-2">
              ← กลับ
            </button>
            <button
              onClick={handleUpload}
              disabled={!assignmentNameMatches || uploading}
              className={`px-8 py-3 rounded-xl font-bold text-lg transition ${
                assignmentNameMatches && !uploading
                  ? 'bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]/80'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              {uploading ? `กำลังอัปโหลด...` : `อัปโหลดคะแนน (${filteredRows.length} คน)`}
            </button>
          </div>

          {uploading && (
            <div className="glass-card p-4">
              <div className="w-full bg-white/10 rounded-full h-3">
                <div
                  className="bg-[var(--color-accent)] h-3 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-sm text-center mt-2 text-[var(--color-text-muted)]">กำลังอัปโหลด...</p>
            </div>
          )}
        </div>

        {/* ==================== Step 6: Results ==================== */}
        <div className="space-y-4">
          {uploadSummary && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard icon="📤" label="ทั้งหมด" value={uploadSummary.total} />
              <StatCard icon="✅" label="สำเร็จ" value={uploadSummary.success} color="text-[var(--color-success)]" />
              <StatCard icon="❌" label="ล้มเหลว" value={uploadSummary.failed} color="text-[var(--color-danger)]" />
            </div>
          )}

          {/* Failed details */}
          {uploadResults.filter(r => !r.success).length > 0 && (
            <div className="glass-card p-4">
              <h3 className="font-semibold text-[var(--color-danger)] mb-3">รายการที่ล้มเหลว</h3>
              <DataTable
                headers={['SIS User ID', 'คะแนน', 'Error']}
                rows={uploadResults.filter(r => !r.success).map(r => [
                  r.sisUserId,
                  r.newScore,
                  r.error || 'Unknown error',
                ])}
                paginate
              />
            </div>
          )}

          {/* Success details */}
          <div className="glass-card p-4">
            <h3 className="font-semibold mb-3">รายการทั้งหมด</h3>
            <DataTable
              headers={['SIS User ID', 'คะแนนเดิม', 'คะแนนใหม่', 'สถานะ']}
              rows={uploadResults.map(r => [
                r.sisUserId,
                r.previousScore ?? '—',
                r.newScore,
                r.success
                  ? <span className="text-[var(--color-success)]">สำเร็จ</span>
                  : <span className="text-[var(--color-danger)]">{r.error}</span>,
              ])}
              paginate
              defaultPageSize={25}
              filterable
            />
          </div>

          <div className="flex justify-between">
            <button onClick={handleReset} className="btn-secondary px-4 py-2">
              เริ่มใหม่
            </button>
            <button onClick={handleDownloadLog} className="btn-primary px-6 py-2">
              ดาวน์โหลดบันทึก
            </button>
          </div>
        </div>
      </StepWizard>

      <ToastContainer />
    </div>
  );
}
