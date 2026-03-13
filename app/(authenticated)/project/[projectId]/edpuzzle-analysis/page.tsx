'use client';

import { useState, useCallback, useMemo } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsxMultiSheet, downloadXlsx } from '@/lib/xlsx-utils';
import type { SheetData } from '@/lib/xlsx-utils';
import { validateCanvasFile, extractAssignments, getPointsRowStart } from '@/lib/canvas-utils';
import {
  parseEdpuzzleFile,
  parseEdpuzzleData,
  validateEdpuzzleFile,
  calculateWeightedScore,
  countCompletedClips,
} from '@/lib/edpuzzle-utils';
import type { EdpuzzleParsed, EdpuzzleClip } from '@/lib/edpuzzle-utils';
import type { ParsedFile, AssignmentInfo, ProjectFile, RegistrarFile, EdpuzzleConfig } from '@/types';
import { parseRegFilename } from '@/lib/registrar-utils';

const STEPS = [
  { label: 'เลือกไฟล์ Canvas' },
  { label: 'อัพโหลดไฟล์ Edpuzzle' },
  { label: 'ตั้งค่าจำนวนคำถาม' },
  { label: 'ผลลัพธ์' },
];

interface MatchedStudent {
  canvasRow: string[];         // Full Canvas row data (A-F)
  studentId: string;           // SIS User ID
  studentName: string;         // From Canvas
  section: string;
  wStatus: string;             // W status from registrar
  canvasScore: string;         // Score from selected Canvas assignment
  edpuzzleScore: number | null; // Calculated weighted score (0-100)
  edpuzzleScaledScore: number | null; // Weighted score scaled to Canvas points possible
  edpuzzleTotalGrade: string;  // Edpuzzle's own total grade
  progress: number;            // Progress percentage
  totalClips: number;
  completedClips: number;
  clipGrades: (number | null)[];
  onTime: string;
  matchStatus: 'matched' | 'canvas-only' | 'edpuzzle-only';
}

export default function EdpuzzleAnalysisPage() {
  const { files, loadFileContent, saveOutput, saveEdpuzzleConfig, loadEdpuzzleConfig } = useProject();
  const { showToast, ToastContainer } = useToast();

  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Canvas file
  const [selectedCanvasFile, setSelectedCanvasFile] = useState<ProjectFile | null>(null);
  const [canvasData, setCanvasData] = useState<ParsedFile | null>(null);
  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);
  const [loadingCanvas, setLoadingCanvas] = useState(false);

  // Step 2: Edpuzzle file
  const [edpuzzleData, setEdpuzzleData] = useState<EdpuzzleParsed | null>(null);
  const [loadingEdpuzzle, setLoadingEdpuzzle] = useState(false);
  const [edpuzzleFilename, setEdpuzzleFilename] = useState('');

  // Step 3: Configuration
  const [clipQuestions, setClipQuestions] = useState<number[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<number>(-1);

  // Step 4: Results
  const [results, setResults] = useState<MatchedStudent[]>([]);
  const [saving, setSaving] = useState(false);

  // Step 3: Saved config
  const [savedConfig, setSavedConfig] = useState<EdpuzzleConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Points possible for selected assignment
  const [pointsPossible, setPointsPossible] = useState<number | null>(null);

  // Registrar W status lookup
  const [registrarFiles, setRegistrarFiles] = useState<RegistrarFile[]>([]);
  const [regLoaded, setRegLoaded] = useState(false);

  // ==================== Step 1: Load Canvas ====================

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

      // Auto-load registrar files for W status
      if (!regLoaded && files.registrar.length > 0) {
        const regFiles: RegistrarFile[] = [];
        for (const pf of files.registrar) {
          try {
            const rfData = await loadFileContent(pf);
            const parsed = parseRegFilename(pf.originalFilename);
            regFiles.push({
              filename: pf.originalFilename,
              courseCode: parsed?.courseCode || '',
              lecSection: parsed?.lecSection || '',
              labSection: parsed?.labSection || '',
              data: rfData,
            });
          } catch { /* skip failed files */ }
        }
        setRegistrarFiles(regFiles);
        setRegLoaded(true);
      }

      setCurrentStep(2);
    } catch {
      showToast('เกิดข้อผิดพลาดในการอ่านไฟล์', 'error');
    } finally {
      setLoadingCanvas(false);
    }
  }, [loadFileContent, showToast, files.registrar, regLoaded]);

  // ==================== Step 2: Upload & Parse Edpuzzle ====================

  const handleEdpuzzleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingEdpuzzle(true);
    setEdpuzzleFilename(file.name);
    try {
      const parsed = await parseEdpuzzleFile(file);
      if (!validateEdpuzzleFile(parsed)) {
        showToast('ไฟล์ไม่ใช่ Edpuzzle export ที่ถูกต้อง', 'error');
        return;
      }
      const epData = parseEdpuzzleData(parsed);
      setEdpuzzleData(epData);

      // Try to auto-load saved config for this clip count
      let loaded = false;
      try {
        const config = await loadEdpuzzleConfig(epData.totalClips);
        if (config && config.clipQuestions.length === epData.totalClips) {
          setClipQuestions(config.clipQuestions);
          setSavedConfig(config);
          setConfigLoaded(true);
          loaded = true;
          showToast(`โหลดไฟล์ Edpuzzle สำเร็จ: ${epData.students.length} นศ., ${epData.totalClips} คลิป — โหลดจำนวนคำถามที่บันทึกไว้แล้ว`, 'success');
        }
      } catch { /* ignore config load error */ }

      if (!loaded) {
        setClipQuestions(epData.clips.map(() => 0));
        setConfigLoaded(false);
        setSavedConfig(null);
        showToast(`โหลดไฟล์ Edpuzzle สำเร็จ: ${epData.students.length} นศ., ${epData.totalClips} คลิป`, 'success');
      }

      setCurrentStep(3);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์ Edpuzzle', 'error');
    } finally {
      setLoadingEdpuzzle(false);
    }
  }, [showToast, loadEdpuzzleConfig]);

  // ==================== Step 3: Configure & Calculate ====================

  const handleCalculate = useCallback(() => {
    if (!canvasData || !edpuzzleData) return;

    // Build W status lookup from registrar files
    const wStatusLookup = new Map<string, string>();
    for (const rf of registrarFiles) {
      const regHeaders = rf.data.headers.map(h => (h || '').toLowerCase().trim());
      const regIdIdx = regHeaders.findIndex(h => h === 'id');
      const wStatusIdx = 3;
      rf.data.rows.forEach(row => {
        const id = (row[regIdIdx] || '').trim();
        if (id && wStatusIdx < row.length) {
          const wVal = (row[wStatusIdx] || '').trim();
          if (wVal) wStatusLookup.set(id, wVal);
        }
      });
    }

    // Build clips with user-provided question counts
    const clipsWithQuestions: EdpuzzleClip[] = edpuzzleData.clips.map((c, i) => ({
      ...c,
      questionCount: clipQuestions[i] || 0,
    }));

    // Build Edpuzzle lookup by student ID
    const epBySisId = new Map<string, typeof edpuzzleData.students[number]>();
    edpuzzleData.students.forEach(s => {
      if (s.studentId) epBySisId.set(s.studentId, s);
    });

    // Parse canvas students
    const cHeaders = canvasData.headers.map(h => (h || '').toLowerCase());
    const cSisIdx = cHeaders.findIndex(h => h === 'sis user id');
    const cSectionIdx = cHeaders.findIndex(h => h === 'section');
    const startRow = getPointsRowStart(canvasData.rows);

    const assignmentIdx = selectedAssignment >= 0 ? assignments[selectedAssignment].index : -1;

    // Extract points possible from the Canvas points row (row before student data)
    let ptsPossible: number | null = null;
    if (assignmentIdx >= 0 && startRow > 0) {
      const ptsStr = (canvasData.rows[0]?.[assignmentIdx] || '').trim();
      const ptsVal = parseFloat(ptsStr);
      if (!isNaN(ptsVal) && ptsVal > 0) {
        ptsPossible = ptsVal;
      }
    }
    setPointsPossible(ptsPossible);

    const matchedStudents: MatchedStudent[] = [];
    const matchedEpIds = new Set<string>();

    // Process Canvas students
    canvasData.rows.slice(startRow).forEach(row => {
      const name = row[0] || '';
      if (!name || name.toLowerCase() === 'test student') return;

      const sisId = (row[cSisIdx] || '').trim();
      const section = row[cSectionIdx] || '';
      const canvasScore = assignmentIdx >= 0 ? (row[assignmentIdx] || '') : '';
      const wStatus = wStatusLookup.get(sisId) || '';

      const epStudent = sisId ? epBySisId.get(sisId) : undefined;
      if (epStudent) matchedEpIds.add(sisId);

      const weightedScore = epStudent
        ? calculateWeightedScore(epStudent.clipGrades, clipsWithQuestions)
        : null;

      matchedStudents.push({
        canvasRow: row.slice(0, 6),
        studentId: sisId,
        studentName: name,
        section,
        wStatus,
        canvasScore,
        edpuzzleScore: weightedScore,
        edpuzzleScaledScore: weightedScore !== null && ptsPossible !== null
          ? Math.round((weightedScore * ptsPossible / 100) * 100) / 100
          : null,
        edpuzzleTotalGrade: epStudent?.totalGrade || '',
        progress: epStudent?.progress || 0,
        totalClips: edpuzzleData.totalClips,
        completedClips: epStudent ? countCompletedClips(epStudent.clipGrades) : 0,
        clipGrades: epStudent?.clipGrades || [],
        onTime: epStudent?.onTime || '',
        matchStatus: epStudent ? 'matched' : 'canvas-only',
      });
    });

    // Edpuzzle-only students (not in Canvas)
    edpuzzleData.students.forEach(epStudent => {
      if (!matchedEpIds.has(epStudent.studentId)) {
        const weightedScore = calculateWeightedScore(epStudent.clipGrades, clipsWithQuestions);
        matchedStudents.push({
          canvasRow: [epStudent.firstName, '', epStudent.studentId, '', '', ''],
          studentId: epStudent.studentId,
          studentName: `${epStudent.firstName} ${epStudent.lastName}`,
          section: '',
          wStatus: '',
          canvasScore: '',
          edpuzzleScore: weightedScore,
          edpuzzleScaledScore: weightedScore !== null && ptsPossible !== null
            ? Math.round((weightedScore * ptsPossible / 100) * 100) / 100
            : null,
          edpuzzleTotalGrade: epStudent.totalGrade,
          progress: epStudent.progress,
          totalClips: edpuzzleData.totalClips,
          completedClips: countCompletedClips(epStudent.clipGrades),
          clipGrades: epStudent.clipGrades,
          onTime: epStudent.onTime,
          matchStatus: 'edpuzzle-only',
        });
      }
    });

    setResults(matchedStudents);
    setCurrentStep(4);

    const matched = matchedStudents.filter(s => s.matchStatus === 'matched').length;
    const canvasOnly = matchedStudents.filter(s => s.matchStatus === 'canvas-only').length;
    const epOnly = matchedStudents.filter(s => s.matchStatus === 'edpuzzle-only').length;
    showToast(`คำนวณเสร็จสิ้น: จับคู่ ${matched} คน, เฉพาะ Canvas ${canvasOnly}, เฉพาะ Edpuzzle ${epOnly}`, 'success');
  }, [canvasData, edpuzzleData, clipQuestions, selectedAssignment, assignments, registrarFiles, showToast]);

  // ==================== Step 4: Export ====================

  const totalQuestions = useMemo(() =>
    clipQuestions.reduce((sum, q) => sum + q, 0),
    [clipQuestions]
  );

  const assignmentName = useMemo(() => {
    if (selectedAssignment >= 0 && assignments[selectedAssignment]) {
      return assignments[selectedAssignment].name;
    }
    return '';
  }, [selectedAssignment, assignments]);

  const buildXlsxBuffer = useCallback((): Uint8Array | null => {
    if (results.length === 0 || !canvasData) return null;

    const canvasHeaders = canvasData.headers.slice(0, 6);
    const hasWStatus = registrarFiles.length > 0;
    const hasScaled = pointsPossible !== null && assignmentName;

    // Main sheet: Canvas A-F + W Status + Canvas Score + Edpuzzle Scores + Progress
    const mainHeaders = [
      ...canvasHeaders,
      ...(hasWStatus ? ['W Status'] : []),
      ...(assignmentName ? [`Canvas: ${assignmentName}`] : []),
      'Edpuzzle Score (weighted %)',
      ...(hasScaled ? [`Edpuzzle Score (เต็ม ${pointsPossible})`] : []),
      'Edpuzzle Total Grade',
      `Progress (out of ${edpuzzleData?.totalClips || 0})(%)`,
      'Completed Clips',
      'สถานะ',
    ];

    const mainRows = results.map(s => [
      ...s.canvasRow,
      ...(hasWStatus ? [s.wStatus] : []),
      ...(assignmentName ? [s.canvasScore] : []),
      s.edpuzzleScore !== null ? Math.round(s.edpuzzleScore * 100) / 100 : '',
      ...(hasScaled ? [s.edpuzzleScaledScore !== null ? s.edpuzzleScaledScore : ''] : []),
      s.edpuzzleTotalGrade,
      s.progress,
      `${s.completedClips}/${s.totalClips}`,
      s.matchStatus === 'matched' ? 'ตรงกัน'
        : s.matchStatus === 'canvas-only' ? 'เฉพาะ Canvas'
        : 'เฉพาะ Edpuzzle',
    ]);

    // Detail sheet: per-clip grades
    const clipHeaders = [
      'Student', 'SIS User ID',
      ...(edpuzzleData?.clips.map((c, i) =>
        `(${c.index}/${c.totalClips}) Grade [${clipQuestions[i] || 0}Q]`
      ) || []),
    ];

    const clipRows = results
      .filter(s => s.matchStatus !== 'canvas-only')
      .map(s => [
        s.studentName,
        s.studentId,
        ...s.clipGrades.map(g => g !== null ? g : ''),
      ]);

    const sheets: SheetData[] = [
      { name: 'สรุปคะแนน', headers: mainHeaders, rows: mainRows },
      { name: 'คะแนนรายคลิป', headers: clipHeaders, rows: clipRows },
    ];

    return buildXlsxMultiSheet(sheets);
  }, [results, canvasData, registrarFiles, assignmentName, edpuzzleData, clipQuestions, pointsPossible]);

  const handleExport = useCallback(() => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    downloadXlsx(buf, 'edpuzzle_analysis');
    showToast('ดาวน์โหลดไฟล์ XLSX สำเร็จ', 'success');
  }, [buildXlsxBuffer, showToast]);

  const handleSaveToProject = useCallback(async () => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    setSaving(true);
    try {
      const matched = results.filter(s => s.matchStatus === 'matched').length;
      const label = `Edpuzzle: ${edpuzzleFilename || 'analysis'}${assignmentName ? ` vs ${assignmentName}` : ''}`;
      await saveOutput('edpuzzle-analysis', label, buf, {
        matched,
        totalStudents: results.length,
        totalClips: edpuzzleData?.totalClips || 0,
        totalQuestions,
      });
      showToast('บันทึกผลลัพธ์ไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildXlsxBuffer, results, edpuzzleFilename, assignmentName, edpuzzleData, totalQuestions, saveOutput, showToast]);

  const handleReset = useCallback(() => {
    setCurrentStep(1);
    setCanvasData(null);
    setSelectedCanvasFile(null);
    setEdpuzzleData(null);
    setEdpuzzleFilename('');
    setClipQuestions([]);
    setSelectedAssignment(-1);
    setResults([]);
    setAssignments([]);
    setPointsPossible(null);
    setSavedConfig(null);
    setConfigLoaded(false);
  }, []);

  // ==================== Stats for Step 4 ====================

  const stats = useMemo(() => {
    if (results.length === 0) return null;
    const matched = results.filter(s => s.matchStatus === 'matched');
    const scores = matched.map(s => s.edpuzzleScore).filter((s): s is number => s !== null);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const scaledScores = matched.map(s => s.edpuzzleScaledScore).filter((s): s is number => s !== null);
    const avgScaled = scaledScores.length > 0 ? scaledScores.reduce((a, b) => a + b, 0) / scaledScores.length : null;
    const fullProgress = matched.filter(s => s.progress === 100).length;
    return {
      total: results.length,
      matched: matched.length,
      canvasOnly: results.filter(s => s.matchStatus === 'canvas-only').length,
      epOnly: results.filter(s => s.matchStatus === 'edpuzzle-only').length,
      avgScore: Math.round(avgScore * 100) / 100,
      avgScaled: avgScaled !== null ? Math.round(avgScaled * 100) / 100 : null,
      fullProgress,
    };
  }, [results]);

  // ==================== Render ====================

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">วิเคราะห์คะแนน Edpuzzle</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          วิเคราะห์คะแนน Edpuzzle playlist โดย weight ตามจำนวนคำถามแต่ละคลิป
        </p>
      </div>

      <div className="glass-card p-6">
        <StepWizard steps={STEPS} currentStep={currentStep}>
          {/* Step 1: Select Canvas file */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Canvas Gradebook</h3>
            <FileSelector group="canvas" label="Canvas Export" selectedFileId={selectedCanvasFile?.id} onSelect={handleLoadCanvas} />
            {loadingCanvas && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังโหลดไฟล์...
              </div>
            )}
            {canvasData && (
              <div className="rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-4 py-3 text-sm">
                <p className="font-medium text-[var(--color-success)]">โหลดไฟล์สำเร็จ</p>
                <p className="mt-1 text-[var(--color-text-muted)]">{canvasData.rows.length} แถว, {assignments.length} assignments</p>
              </div>
            )}
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={!canvasData} onClick={() => setCurrentStep(2)}>ถัดไป</button>
            </div>
          </div>

          {/* Step 2: Upload Edpuzzle file */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">อัพโหลดไฟล์ Edpuzzle Export</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              ไฟล์ที่ export จาก Edpuzzle (อาจเป็น CSV, XLSX หรือไม่มี extension)
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-white/20 p-8 transition hover:border-[var(--color-accent)]/50 hover:bg-white/5">
              <span className="text-4xl">📄</span>
              <span className="text-sm text-[var(--color-text-muted)]">
                {edpuzzleFilename ? edpuzzleFilename : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง'}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,*"
                onChange={handleEdpuzzleUpload}
                className="hidden"
              />
            </label>
            {loadingEdpuzzle && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังอ่านไฟล์...
              </div>
            )}
            {edpuzzleData && (
              <div className="rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-4 py-3 text-sm">
                <p className="font-medium text-[var(--color-success)]">อ่านไฟล์ Edpuzzle สำเร็จ</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  {edpuzzleData.students.length} นักศึกษา, {edpuzzleData.totalClips} คลิป
                </p>
              </div>
            )}
            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>ย้อนกลับ</button>
              <button className="btn btn-primary" disabled={!edpuzzleData} onClick={() => setCurrentStep(3)}>ถัดไป</button>
            </div>
          </div>

          {/* Step 3: Configuration */}
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 font-semibold text-[var(--color-text-primary)]">จำนวนคำถามในแต่ละคลิป</h3>
              <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                ระบุจำนวนคำถามที่ฝังในแต่ละคลิป เพื่อใช้คำนวณ weighted score
                (คลิปที่ไม่มีคำถามให้ใส่ 0)
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {edpuzzleData?.clips.map((clip, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    clip.hasGrades ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/[0.02] opacity-60'
                  }`}>
                    <span className="text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">
                      คลิป {clip.index}/{clip.totalClips}
                    </span>
                    {!clip.hasGrades && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                        ไม่มี Grade
                      </span>
                    )}
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={clipQuestions[i] || 0}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value) || 0);
                        setClipQuestions(prev => {
                          const next = [...prev];
                          next[i] = val;
                          return next;
                        });
                      }}
                      className="ml-auto w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />
                    <span className="text-xs text-[var(--color-text-muted)]">ข้อ</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm text-[var(--color-text-muted)]">
                  รวมทั้งหมด: <span className="font-semibold text-[var(--color-accent)]">{totalQuestions}</span> คำถาม
                </div>
                <div className="flex items-center gap-2">
                  {configLoaded && savedConfig && (
                    <span className="text-xs text-[var(--color-success)]">
                      ✅ โหลดจากที่บันทึกไว้
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={savingConfig || totalQuestions === 0}
                    onClick={async () => {
                      if (!edpuzzleData) return;
                      setSavingConfig(true);
                      try {
                        const config = await saveEdpuzzleConfig({
                          totalClips: edpuzzleData.totalClips,
                          clipQuestions,
                          label: edpuzzleFilename || `${edpuzzleData.totalClips} คลิป`,
                        });
                        setSavedConfig(config);
                        setConfigLoaded(true);
                        showToast('บันทึกจำนวนคำถามสำเร็จ', 'success');
                      } catch {
                        showToast('บันทึกไม่สำเร็จ', 'error');
                      } finally {
                        setSavingConfig(false);
                      }
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {savingConfig ? '💾 กำลังบันทึก...' : '💾 บันทึกจำนวนคำถาม'}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 font-semibold text-[var(--color-text-primary)]">เลือก Assignment ใน Canvas (ถ้ามี)</h3>
              <p className="mb-2 text-sm text-[var(--color-text-muted)]">
                เลือก assignment ที่จะนำคะแนนมาแสดงเทียบกับ Edpuzzle — ระบบจะดึงคะแนนเต็มจาก Canvas เพื่อคำนวณคะแนน Edpuzzle ตามสัดส่วน
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-white/10 p-3">
                <label className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${selectedAssignment === -1 ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                  <input type="radio" name="assignment" checked={selectedAssignment === -1} onChange={() => setSelectedAssignment(-1)} className="accent-[var(--color-accent)]" />
                  <span className="text-sm text-[var(--color-text-muted)]">ไม่เลือก</span>
                </label>
                {assignments.map((a, i) => {
                  // Get points possible from row 0 (points row) if it exists
                  const startRow = canvasData ? getPointsRowStart(canvasData.rows) : 0;
                  const pts = startRow > 0 && canvasData ? (canvasData.rows[0]?.[a.index] || '') : '';
                  return (
                    <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${selectedAssignment === i ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                      <input type="radio" name="assignment" checked={selectedAssignment === i} onChange={() => setSelectedAssignment(i)} className="accent-[var(--color-accent)]" />
                      <span className="flex-1 text-sm text-[var(--color-text-primary)]">{a.name}</span>
                      {pts && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                          เต็ม {pts}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>ย้อนกลับ</button>
              <button
                className="btn btn-primary"
                disabled={totalQuestions === 0}
                onClick={handleCalculate}
              >
                คำนวณคะแนน
              </button>
            </div>
          </div>

          {/* Step 4: Results */}
          <div className="space-y-6">
            {results.length > 0 && (
              <>
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleExport} className="btn btn-primary">📥 ดาวน์โหลด XLSX</button>
                  <button onClick={handleSaveToProject} disabled={saving} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">
                    {saving ? '💾 กำลังบันทึก...' : '💾 บันทึกไปโปรเจค'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleReset}>เริ่มใหม่</button>
                </div>

                {stats && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <StatCard icon="👥" label="ทั้งหมด" value={stats.total} />
                    <StatCard icon="✅" label="จับคู่สำเร็จ" value={stats.matched} color="text-[var(--color-success)]" />
                    <StatCard icon="⚠️" label="เฉพาะ Canvas" value={stats.canvasOnly} color="text-[var(--color-warning)]" />
                    <StatCard icon="❌" label="เฉพาะ Edpuzzle" value={stats.epOnly} color="text-[var(--color-danger)]" />
                    <StatCard icon="📊" label={stats.avgScaled !== null ? `คะแนนเฉลี่ย (เต็ม ${pointsPossible})` : 'คะแนนเฉลี่ย (%)'} value={stats.avgScaled !== null ? stats.avgScaled : stats.avgScore} color="text-[var(--color-accent)]" />
                    <StatCard icon="🎯" label="ครบ 100%" value={stats.fullProgress} color="text-[var(--color-info)]" />
                  </div>
                )}

                <DataTable
                  headers={[
                    'ชื่อ', 'SIS ID', 'Section',
                    ...(registrarFiles.length > 0 ? ['W Status'] : []),
                    ...(assignmentName ? [`Canvas: ${assignmentName.substring(0, 20)}`] : []),
                    'EP Score (%)',
                    ...(pointsPossible !== null && assignmentName ? [`EP (เต็ม ${pointsPossible})`] : []),
                    'EP Total Grade',
                    `Progress (${edpuzzleData?.totalClips || 0})`, 'สถานะ',
                  ]}
                  rows={results.map(s => [
                    s.studentName,
                    s.studentId,
                    s.section,
                    ...(registrarFiles.length > 0 ? [
                      s.wStatus ? <span key="w" className="text-[var(--color-danger)] font-medium">{s.wStatus}</span> : '-',
                    ] : []),
                    ...(assignmentName ? [s.canvasScore || '-'] : []),
                    s.edpuzzleScore !== null ? (
                      <span key="ep" className={s.edpuzzleScore >= 80 ? 'text-[var(--color-success)]' : s.edpuzzleScore >= 50 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}>
                        {Math.round(s.edpuzzleScore * 100) / 100}
                      </span>
                    ) : '-',
                    ...(pointsPossible !== null && assignmentName ? [
                      s.edpuzzleScaledScore !== null ? (
                        <span key="scaled" className="font-semibold text-[var(--color-accent)]">
                          {s.edpuzzleScaledScore}
                        </span>
                      ) : '-',
                    ] : []),
                    s.edpuzzleTotalGrade || '-',
                    <span key="prog" className={s.progress === 100 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}>
                      {s.completedClips}/{s.totalClips} ({s.progress}%)
                    </span>,
                    <span key="status" className={
                      s.matchStatus === 'matched' ? 'text-[var(--color-success)]'
                        : s.matchStatus === 'canvas-only' ? 'text-[var(--color-warning)]'
                        : 'text-[var(--color-danger)]'
                    }>
                      {s.matchStatus === 'matched' ? '✅' : s.matchStatus === 'canvas-only' ? '⚠️ Canvas' : '❌ EP'}
                    </span>,
                  ])}
                  paginate
                  filterable
                />
              </>
            )}
          </div>
        </StepWizard>
      </div>
      <ToastContainer />
    </div>
  );
}
