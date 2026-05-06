'use client';

import { useState, useCallback, useMemo } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsx, downloadXlsx } from '@/lib/xlsx-utils';
import { apiGet } from '@/lib/api-client';
import {
  buildAutoGradeResult,
  generateCanvasImportCSV,
  generateFullXlsx,
  categorizeAssignment,
  type AutoGradeResult,
  type CanvasAssignmentRaw,
  type CanvasSubmission,
  type GradingType,
  type QuizInfo,
} from '@/lib/auto-grade-utils';
import type { CanvasLatePolicy } from '@/lib/late-deduction-utils';

const STEPS = [
  { label: '1. ดึงข้อมูล' },
  { label: '2. ตรวจสอบคะแนน' },
  { label: '3. ดาวน์โหลด' },
];

type ScoringMode = 'score' | 'submission_only';

const TYPE_CYCLE: GradingType[] = ['auto', 'quiz_mixed', 'submission'];

export default function AutoGradePage() {
  const { project } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // Fetch state
  const [loading, setLoading] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');

  // Scoring mode: 'score' = use Canvas scores + late penalty, 'submission_only' = full marks if submitted
  const [scoringMode, setScoringMode] = useState<ScoringMode>('submission_only');

  // Raw data from API
  const [rawAssignments, setRawAssignments] = useState<CanvasAssignmentRaw[]>([]);
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<
    Map<number, CanvasSubmission[]>
  >(new Map());
  const [latePolicy, setLatePolicy] = useState<CanvasLatePolicy | null>(null);
  const [quizInfoMap, setQuizInfoMap] = useState<Map<number, QuizInfo>>(new Map());

  // Assignment selection and type overrides
  const [selectedAssignments, setSelectedAssignments] = useState<Set<number>>(new Set());
  const [typeOverrides, setTypeOverrides] = useState<Map<number, GradingType>>(new Map());

  // Result
  const [result, setResult] = useState<AutoGradeResult | null>(null);

  const courseId = project?.canvasCourseId;

  const handleFetch = useCallback(async () => {
    if (!courseId) {
      showToast('ไม่พบ Course ID', 'error');
      return;
    }

    setLoading(true);
    setFetchProgress('กำลังดึงข้อมูล Assignments, Submissions, Quiz Questions และ Late Policy...');

    try {
      const data = await apiGet<{
        assignments?: CanvasAssignmentRaw[];
        submissionsByAssignment?: Record<string, CanvasSubmission[]>;
        latePolicy?: CanvasLatePolicy | null;
        quizInfo?: Record<string, { questions: any[]; quizSubmissions: any[] }>;
        error?: string;
      }>('/api/canvas/auto-grade', { courseId: String(courseId) });

      if (data.error) {
        showToast(`Error: ${data.error}`, 'error');
        setLoading(false);
        setFetchProgress('');
        return;
      }

      const assignments: CanvasAssignmentRaw[] = data.assignments || [];
      const subsMap = new Map<number, CanvasSubmission[]>();
      if (data.submissionsByAssignment) {
        for (const [aid, subs] of Object.entries(data.submissionsByAssignment)) {
          subsMap.set(Number(aid), subs as CanvasSubmission[]);
        }
      }

      // Parse quiz info
      const qiMap = new Map<number, QuizInfo>();
      if (data.quizInfo) {
        for (const [aid, qi] of Object.entries(data.quizInfo)) {
          const info = qi as { questions: any[]; quizSubmissions: any[] };
          qiMap.set(Number(aid), {
            questions: info.questions || [],
            quizSubmissions: info.quizSubmissions || [],
          });
        }
      }

      setRawAssignments(assignments);
      setSubmissionsByAssignment(subsMap);
      setLatePolicy(data.latePolicy || null);
      setQuizInfoMap(qiMap);

      // Auto-select all published assignments
      const published = assignments.filter((a) => a.published);
      setSelectedAssignments(new Set(published.map((a) => a.id)));
      setTypeOverrides(new Map());

      // Count quiz_mixed
      let mixedCount = 0;
      for (const a of published) {
        const qi = qiMap.get(a.id);
        if (categorizeAssignment(a, qi) === 'quiz_mixed') mixedCount++;
      }

      showToast(
        `ดึงข้อมูลสำเร็จ: ${published.length} assignments` +
          (mixedCount > 0 ? `, ${mixedCount} quiz มีข้อ file upload` : ''),
        'success'
      );
    } catch (err) {
      showToast(
        `ดึงข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
      setFetchProgress('');
    }
  }, [courseId, showToast]);

  // --- Published assignments list ---
  const publishedAssignments = useMemo(
    () => rawAssignments.filter((a) => a.published),
    [rawAssignments]
  );

  // --- Get effective type for an assignment ---
  const getEffectiveType = useCallback(
    (a: CanvasAssignmentRaw): GradingType => {
      const qi = quizInfoMap.get(a.id);
      return typeOverrides.get(a.id) ?? categorizeAssignment(a, qi);
    },
    [typeOverrides, quizInfoMap]
  );

  // --- Toggle assignment selection ---
  const toggleAssignment = useCallback((id: number) => {
    setSelectedAssignments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Toggle all assignments ---
  const toggleAll = useCallback(() => {
    if (selectedAssignments.size === publishedAssignments.length) {
      setSelectedAssignments(new Set());
    } else {
      setSelectedAssignments(new Set(publishedAssignments.map((a) => a.id)));
    }
  }, [selectedAssignments.size, publishedAssignments]);

  // --- Cycle assignment type: auto → quiz_mixed → submission → auto ---
  const cycleType = useCallback(
    (id: number, currentType: GradingType) => {
      const idx = TYPE_CYCLE.indexOf(currentType);
      const nextType = TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
      setTypeOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, nextType);
        return next;
      });
    },
    []
  );

  // --- Perform grading ---
  const performGrading = useCallback(() => {
    const filtered = rawAssignments.filter((a) => selectedAssignments.has(a.id));
    if (filtered.length === 0) {
      showToast('กรุณาเลือกอย่างน้อย 1 assignment', 'error');
      return;
    }

    // In submission_only mode, force ALL assignments to 'submission' type
    let effectiveOverrides = typeOverrides;
    if (scoringMode === 'submission_only') {
      effectiveOverrides = new Map<number, GradingType>();
      for (const a of filtered) {
        effectiveOverrides.set(a.id, 'submission');
      }
    }

    const gradeResult = buildAutoGradeResult(
      filtered,
      submissionsByAssignment,
      latePolicy,
      quizInfoMap,
      effectiveOverrides
    );
    setResult(gradeResult);
    setCurrentStep(2);
  }, [
    rawAssignments,
    selectedAssignments,
    submissionsByAssignment,
    latePolicy,
    quizInfoMap,
    typeOverrides,
    scoringMode,
    showToast,
  ]);

  // --- Export Canvas CSV ---
  const handleExportCSV = useCallback(() => {
    if (!result) return;
    // In submission_only mode, all assignments are 'submission' so include all
    const csv = generateCanvasImportCSV(result, scoringMode === 'submission_only');
    if (!csv) {
      showToast('ไม่มี assignment สำหรับ export', 'error');
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto_grade_canvas_import_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ดาวน์โหลด CSV สำเร็จ', 'success');
    setCurrentStep(3);
  }, [result, showToast]);

  // --- Export full XLSX ---
  const handleExportXlsx = useCallback(() => {
    if (!result) return;
    const { headers, rows } = generateFullXlsx(result);
    const xlsxBuf = buildXlsx(headers, rows);
    downloadXlsx(xlsxBuf, `auto_grade_full_${new Date().toISOString().slice(0, 10)}`);
    showToast('ดาวน์โหลด XLSX สำเร็จ', 'success');
    setCurrentStep(3);
  }, [result, showToast]);

  // --- Reset ---
  const handleReset = useCallback(() => {
    setRawAssignments([]);
    setSubmissionsByAssignment(new Map());
    setLatePolicy(null);
    setQuizInfoMap(new Map());
    setSelectedAssignments(new Set());
    setTypeOverrides(new Map());
    setScoringMode('submission_only');
    setResult(null);
    setCurrentStep(1);
  }, []);

  // --- Table data for Step 2 ---
  const scoreHeaders = useMemo(() => {
    if (!result) return [];
    return [
      '#',
      'SIS User ID',
      'ชื่อ',
      ...result.assignments.map((a) => a.name),
      'รวม',
    ];
  }, [result]);

  const scoreRows = useMemo(() => {
    if (!result) return [];
    return result.students.map((student, i) => {
      let total = 0;
      const scores = result.assignments.map((a) => {
        const score = student.scores.get(a.id);
        if (!score) return <span className="text-gray-500">—</span>;

        total += score.adjustedScore;
        const val = Math.round(score.adjustedScore * 100) / 100;
        const max = a.pointsPossible;

        if (score.status === 'missing') {
          return <span className="text-red-400 font-medium">0</span>;
        }
        if (score.status === 'late') {
          return (
            <span
              className="text-yellow-400"
              title={`Late: -${score.deductionInfo?.deductionPercent ?? 0}%`}
            >
              {val}/{max}
            </span>
          );
        }
        if (score.status === 'graded') {
          const breakdown = score.quizBreakdown;
          const title = breakdown
            ? `Auto: ${breakdown.autoScore}, File Upload: +${breakdown.fileUploadScore}`
            : '';
          return (
            <span className="text-blue-400" title={title}>
              {val}/{max}
            </span>
          );
        }
        // on_time
        return (
          <span className="text-green-400">
            {val}/{max}
          </span>
        );
      });

      return [
        String(i + 1),
        student.sisUserId,
        student.name,
        ...scores,
        String(Math.round(total * 100) / 100),
      ];
    });
  }, [result]);

  // --- Type badge styling ---
  const getTypeBadge = (type: GradingType) => {
    switch (type) {
      case 'auto':
        return { label: 'Auto-graded', className: 'bg-blue-500/20 text-blue-400' };
      case 'quiz_mixed':
        return { label: 'Quiz+Upload', className: 'bg-purple-500/20 text-purple-400' };
      case 'submission':
        return { label: 'Submission', className: 'bg-green-500/20 text-green-400' };
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
        ⚡ ให้คะแนนอัตโนมัติ
      </h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        ดึงข้อมูลการส่งงานจาก Canvas แล้วให้คะแนนอัตโนมัติ — เลือกโหมด &quot;ตามการส่งงาน&quot;
        (ส่ง = เต็ม) หรือ &quot;ตามคะแนน Canvas&quot; (ใช้คะแนนจาก Canvas สำหรับ quiz)
      </p>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* ===== Step 1: Fetch & Configure ===== */}
        <div className="space-y-6">
          {/* Fetch button */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  ดึงข้อมูลจาก Canvas
                </h3>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Course ID: {courseId || '—'}
                </p>
              </div>
              <button
                onClick={handleFetch}
                disabled={loading || !courseId}
                className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'กำลังดึง...' : 'ดึงข้อมูล'}
              </button>
            </div>
            {fetchProgress && (
              <p className="text-sm text-[var(--color-accent)]">{fetchProgress}</p>
            )}
          </div>

          {/* Scoring mode + Assignment list */}
          {publishedAssignments.length > 0 && (
            <div className="glass-card p-5 space-y-4">
              {/* Scoring mode toggle */}
              <div className="space-y-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  โหมดให้คะแนน
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setScoringMode('submission_only')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      scoringMode === 'submission_only'
                        ? 'bg-[var(--color-accent)] text-[var(--color-bg-primary)]'
                        : 'border border-white/10 text-[var(--color-text-muted)] hover:bg-white/5'
                    }`}
                  >
                    ตามการส่งงาน
                  </button>
                  <button
                    onClick={() => setScoringMode('score')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      scoringMode === 'score'
                        ? 'bg-[var(--color-accent)] text-[var(--color-bg-primary)]'
                        : 'border border-white/10 text-[var(--color-text-muted)] hover:bg-white/5'
                    }`}
                  >
                    ตามคะแนน Canvas
                  </button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {scoringMode === 'submission_only'
                    ? 'ส่งงาน = คะแนนเต็ม · ส่งช้า = หัก late penalty · ไม่ส่ง = 0'
                    : 'Quiz/Auto = ใช้คะแนน Canvas · งานส่ง = เต็มถ้าส่ง · คลิกปุ่มประเภทเพื่อเปลี่ยน'}
                </p>
              </div>

              <div className="h-px bg-white/10" />

              {/* Assignment header */}
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  Assignments ({publishedAssignments.length})
                </h3>
                <button
                  onClick={toggleAll}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  {selectedAssignments.size === publishedAssignments.length
                    ? 'ยกเลิกทั้งหมด'
                    : 'เลือกทั้งหมด'}
                </button>
              </div>

              {/* Late policy info */}
              {latePolicy ? (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-sm text-blue-300">
                  Late Policy: หัก {latePolicy.late_submission_deduction}% ต่อ{' '}
                  {latePolicy.late_submission_interval === 'hour' ? 'ชั่วโมง' : 'วัน'}
                  {latePolicy.late_submission_minimum_percent_enabled &&
                    ` (ขั้นต่ำ ${latePolicy.late_submission_minimum_percent}%)`}
                </div>
              ) : (
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 text-sm text-yellow-300">
                  ⚠️ ไม่พบ Late Policy — งานที่ส่งช้าจะได้คะแนนเต็ม (ไม่มีการหักคะแนน)
                </div>
              )}

              {/* Type legend — only show in 'score' mode */}
              {scoringMode === 'score' && (
                <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>
                    <span className="inline-block rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-400 mr-1">
                      Auto-graded
                    </span>
                    ใช้คะแนน Canvas
                  </span>
                  <span>
                    <span className="inline-block rounded-full bg-purple-500/20 px-2 py-0.5 text-purple-400 mr-1">
                      Quiz+Upload
                    </span>
                    Canvas + เต็มสำหรับข้อ upload
                  </span>
                  <span>
                    <span className="inline-block rounded-full bg-green-500/20 px-2 py-0.5 text-green-400 mr-1">
                      Submission
                    </span>
                    เต็มถ้าส่ง / late penalty
                  </span>
                </div>
              )}

              <div className="max-h-96 overflow-y-auto space-y-1">
                {publishedAssignments.map((a) => {
                  const selected = selectedAssignments.has(a.id);
                  const effectiveType =
                    scoringMode === 'submission_only' ? 'submission' as GradingType : getEffectiveType(a);
                  const badge = getTypeBadge(effectiveType);

                  return (
                    <div
                      key={a.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                        selected ? 'bg-white/5' : 'opacity-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAssignment(a.id)}
                        className="accent-[var(--color-accent)]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-text-primary)] truncate">
                          {a.name}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {a.points_possible ?? 0} pts
                          {a.due_at &&
                            ` · กำหนดส่ง: ${new Date(a.due_at).toLocaleDateString('th-TH', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`}
                        </p>
                      </div>
                      {scoringMode === 'score' ? (
                        <button
                          onClick={() => cycleType(a.id, effectiveType)}
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${badge.className}`}
                          title="คลิกเพื่อเปลี่ยนประเภท"
                        >
                          {badge.label}
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
                          ส่ง = เต็ม
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={performGrading}
                  disabled={selectedAssignments.size === 0}
                  className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  คำนวณคะแนน →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ===== Step 2: Review Scores ===== */}
        <div className="space-y-6">
          {result && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <StatCard icon="👥" label="นักศึกษา" value={result.stats.totalStudents} />
                <StatCard icon="📋" label="Assignments" value={result.stats.totalAssignments} />
                <StatCard
                  icon="🤖"
                  label="Auto-graded"
                  value={result.stats.autoGradedCount}
                  color="text-blue-400"
                />
                <StatCard
                  icon="📎"
                  label="Quiz+Upload"
                  value={result.stats.quizMixedCount}
                  color="text-purple-400"
                />
                <StatCard
                  icon="📝"
                  label="Submission"
                  value={result.stats.submissionCount}
                  color="text-green-400"
                />
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
                <span>
                  <span className="inline-block w-3 h-3 rounded-full bg-green-400 mr-1" />
                  ส่งทัน (เต็ม)
                </span>
                <span>
                  <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 mr-1" />
                  ส่งช้า (หักคะแนน)
                </span>
                <span>
                  <span className="inline-block w-3 h-3 rounded-full bg-red-400 mr-1" />
                  ไม่ส่ง
                </span>
                <span>
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-400 mr-1" />
                  Auto/Quiz (Canvas + file upload)
                </span>
              </div>

              {/* Score table */}
              <div className="glass-card p-4 space-y-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  ตารางคะแนน
                </h3>
                <div className="overflow-x-auto">
                  <DataTable
                    headers={scoreHeaders}
                    rows={scoreRows}
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
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExportXlsx}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition"
                  >
                    📊 ดาวน์โหลด XLSX (ทั้งหมด)
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="rounded-lg bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90"
                  >
                    📥 ดาวน์โหลด CSV (Canvas Import)
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ===== Step 3: Done ===== */}
        <div className="space-y-6">
          <div className="glass-card p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
              ส่งออกสำเร็จ!
            </h2>
            <p className="text-[var(--color-text-muted)]">
              ไฟล์คะแนนถูกดาวน์โหลดแล้ว — นำไฟล์ CSV ไป import ใน Canvas Grades ได้เลย
            </p>
            {result && (
              <div className="mx-auto max-w-md text-left text-sm text-[var(--color-text-muted)] space-y-1">
                <p>
                  👥 นักศึกษา: <strong>{result.stats.totalStudents}</strong> คน
                </p>
                <p>
                  📋 Assignments: <strong>{result.stats.totalAssignments}</strong> รายการ
                </p>
                <p>
                  🤖 Auto-graded:{' '}
                  <strong className="text-blue-400">{result.stats.autoGradedCount}</strong>
                </p>
                {result.stats.quizMixedCount > 0 && (
                  <p>
                    📎 Quiz+Upload:{' '}
                    <strong className="text-purple-400">
                      {result.stats.quizMixedCount}
                    </strong>
                  </p>
                )}
                <p>
                  📝 Submission:{' '}
                  <strong className="text-green-400">{result.stats.submissionCount}</strong>
                </p>
              </div>
            )}
            <div className="flex items-center gap-3 justify-center pt-4">
              <button
                onClick={handleExportCSV}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition"
              >
                📥 ดาวน์โหลด CSV อีกครั้ง
              </button>
              <button
                onClick={handleExportXlsx}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 transition"
              >
                📊 ดาวน์โหลด XLSX อีกครั้ง
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
