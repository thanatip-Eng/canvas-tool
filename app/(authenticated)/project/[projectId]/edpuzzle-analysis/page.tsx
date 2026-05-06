'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { apiGet } from '@/lib/api-client';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsxMultiSheet, downloadXlsx } from '@/lib/xlsx-utils';
import type { SheetData } from '@/lib/xlsx-utils';
import {
  parseEdpuzzleFileFromBuffer,
  parseEdpuzzleData,
  validateEdpuzzleFile,
  calculateWeightedScore,
  countCompletedClips,
} from '@/lib/edpuzzle-utils';
import type { EdpuzzleParsed, EdpuzzleClip } from '@/lib/edpuzzle-utils';
import type { EdpuzzleConfig, ProjectFile, ParsedMasterData, MasterAssignment } from '@/types';
import {
  parseEdpuzzleTimestamp,
  calculateLateDeduction,
} from '@/lib/late-deduction-utils';
import type { CanvasLatePolicy, ManualLatePolicy } from '@/lib/late-deduction-utils';

const STEPS = [
  { label: 'เลือก Assignment' },
  { label: 'เลือกไฟล์ Edpuzzle' },
  { label: 'ตั้งค่าจำนวนคำถาม' },
  { label: 'ผลลัพธ์' },
];

function formatLateDuration(seconds: number): string {
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} วัน ${hours % 24} ชม.`;
  }
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  return `${minutes} นาที`;
}

/** Find the latest per-clip "Time turned in" across all clips for a student. */
function getLastClipTurnedIn(clipTimeTurnedIn: (string | null)[]): string {
  let latest: Date | null = null;
  let latestStr = '';
  for (const raw of clipTimeTurnedIn) {
    if (!raw) continue;
    const d = parseEdpuzzleTimestamp(raw);
    if (d && (!latest || d > latest)) {
      latest = d;
      latestStr = raw;
    }
  }
  return latestStr;
}

/** Determine submission status based on clip completion and timeliness. */
function getSubmissionStatus(
  completedClips: number,
  totalClips: number,
  lastClipTime: string,
  dueAt: Date | null,
): string {
  if (totalClips === 0) return '';
  const ratio = completedClips / totalClips;

  if (completedClips === totalClips) {
    if (!dueAt) return 'complete';
    const lastDate = parseEdpuzzleTimestamp(lastClipTime);
    if (!lastDate) return 'complete';
    return lastDate <= dueAt ? 'complete' : 'late';
  }

  // Check late for incomplete submissions using last clip time
  const lastDate = parseEdpuzzleTimestamp(lastClipTime);
  const isLate = !!(dueAt && lastDate && lastDate > dueAt);

  if (ratio >= 0.6) return isLate ? 'inProgress60Late' : 'inProgress60';
  if (ratio >= 0.3) return isLate ? 'inProgress30Late' : 'inProgress30';
  return isLate ? 'inProgressLowLate' : 'inProgressLow';
}

/** Format submission status for display. */
function formatSubmissionStatus(status: string): { label: string; color: string } {
  switch (status) {
    case 'complete': return { label: 'ส่งครบ', color: 'var(--color-success)' };
    case 'late': return { label: 'ส่งครบ (สาย)', color: 'var(--color-warning)' };
    case 'inProgress60': return { label: '≥60%', color: '#f97316' };
    case 'inProgress60Late': return { label: '≥60% (สาย)', color: '#f97316' };
    case 'inProgress30': return { label: '≥30%', color: 'var(--color-error)' };
    case 'inProgress30Late': return { label: '≥30% (สาย)', color: 'var(--color-error)' };
    case 'inProgressLow': return { label: '<30%', color: 'var(--color-text-muted)' };
    case 'inProgressLowLate': return { label: '<30% (สาย)', color: 'var(--color-text-muted)' };
    default: return { label: '-', color: 'var(--color-text-muted)' };
  }
}

interface CanvasAssignment {
  id: number;
  name: string;
  points_possible: number | null;
  due_at: string | null;
}

interface CanvasSubmission {
  user_id: number;
  score: number | null;
  entered_score: number | null;
  points_deducted: number | null;
  seconds_late: number;
  late: boolean;
  user?: {
    sis_user_id?: string;
    name?: string;
    sortable_name?: string;
    login_id?: string;
  };
}

interface MatchedStudent {
  // Canvas Columns A-F
  studentName: string;
  canvasId: string;
  studentId: string;
  sisLoginId: string;
  integrationId: string;
  section: string;
  // Registrar info
  regStatus: string;
  canvasScore: string;
  canvasEnteredScore: string;
  pointsDeducted: number | null;
  secondsLate: number;
  isLate: boolean;
  edpuzzleScore: number | null;
  edpuzzleScaledScore: number | null;
  edpuzzleTotalGrade: string;
  progress: number;
  totalClips: number;
  completedClips: number;
  clipGrades: (number | null)[];
  onTime: string;
  // EP late deduction fields
  epTimeTurnedIn: string;
  epSecondsLate: number;
  epDeductionPercent: number;
  epAdjustedScore: number | null;
  epAdjustedScaledScore: number | null;
  epIsLate: boolean;
  // EP submission tracking
  epLastClipTurnedIn: string;
  epSubmissionStatus: string;
  matchStatus: 'matched' | 'canvas-only' | 'edpuzzle-only';
}

export default function EdpuzzleAnalysisPage() {
  const { project, files, loadFileContent, loadMasterData, saveOutput, saveEdpuzzleConfig, saveEdpuzzleConfigs, loadEdpuzzleConfig, loadAllEdpuzzleConfigs, deleteEdpuzzleConfig } = useProject();
  const { showToast, ToastContainer } = useToast();

  const [currentStep, setCurrentStep] = useState(1);

  // Master data
  const [masterData, setMasterData] = useState<ParsedMasterData | null>(null);
  const [loadingMasterData, setLoadingMasterData] = useState(false);

  // No-master mode: use Canvas API directly when master data is unavailable
  const [noMasterMode, setNoMasterMode] = useState(false);
  const [canvasAssignments, setCanvasAssignments] = useState<any[]>([]);
  const [loadingCanvasAssignments, setLoadingCanvasAssignments] = useState(false);

  // Step 1: Assignment selection (from master data)
  const [selectedMasterAssignment, setSelectedMasterAssignment] = useState<MasterAssignment | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<CanvasAssignment | null>(null);
  const [canvasScores, setCanvasScores] = useState<Map<string, { name: string; score: number | null; enteredScore: number | null; pointsDeducted: number | null; secondsLate: number; isLate: boolean; section: string }>>(new Map());
  const [loadingScores, setLoadingScores] = useState(false);

  // Step 2: Edpuzzle file
  const [selectedEdpuzzleFile, setSelectedEdpuzzleFile] = useState<ProjectFile | null>(null);
  const [edpuzzleData, setEdpuzzleData] = useState<EdpuzzleParsed | null>(null);
  const [loadingEdpuzzle, setLoadingEdpuzzle] = useState(false);
  const [edpuzzleFilename, setEdpuzzleFilename] = useState('');

  // Step 3: Configuration
  const [clipQuestions, setClipQuestions] = useState<number[]>([]);
  const [savedConfig, setSavedConfig] = useState<EdpuzzleConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [allConfigs, setAllConfigs] = useState<EdpuzzleConfig[]>([]);

  // Step 4: Results
  const [results, setResults] = useState<MatchedStudent[]>([]);
  const [saving, setSaving] = useState(false);

  // Bookmarklet paste UI
  const [showBookmarklet, setShowBookmarklet] = useState(false);

  // Late policy
  const [latePolicy, setLatePolicy] = useState<CanvasLatePolicy | null>(null);
  const [manualLatePolicy, setManualLatePolicy] = useState<ManualLatePolicy>({
    deductionPercent: 10, interval: 'hour', minimumPercent: 0,
  });
  const [useManualPolicy, setUseManualPolicy] = useState(false);
  const latePolicyFetchedRef = useRef(false);

  const courseId = project?.canvasCourseId;
  const pointsPossible = selectedAssignment?.points_possible ?? null;

  // ==================== Load master data on mount ====================

  useEffect(() => {
    if (masterData || loadingMasterData) return;
    setLoadingMasterData(true);
    loadMasterData()
      .then(md => setMasterData(md))
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingMasterData(false));
  }, [loadMasterData, masterData, loadingMasterData]);

  // ==================== Load all saved Edpuzzle configs ====================

  useEffect(() => {
    (async () => {
      try {
        const configs = await loadAllEdpuzzleConfigs();
        setAllConfigs(configs);
      } catch { /* ignore */ }
    })();
  }, [loadAllEdpuzzleConfigs]);

  // ==================== Step 1: Fetch Canvas late policy ====================

  const fetchLatePolicy = useCallback(async () => {
    if (!courseId || latePolicyFetchedRef.current) return;
    latePolicyFetchedRef.current = true;
    try {
      const data = await apiGet<{ late_policy?: CanvasLatePolicy | null }>(
        '/api/canvas/late-policy',
        { courseId: String(courseId) }
      );
      setLatePolicy(data.late_policy ?? null);
    } catch {
      setLatePolicy(null);
    }
  }, [courseId]);

  useEffect(() => {
    if (courseId) {
      fetchLatePolicy();
    }
  }, [fetchLatePolicy, courseId]);

  const handleSelectAssignment = useCallback(async (assignment: MasterAssignment) => {
    if (!courseId || !assignment.id) {
      showToast('ไม่พบ Assignment ID', 'error');
      return;
    }
    setLoadingScores(true);
    try {
      const data = await apiGet<{ assignment?: any; submissions?: CanvasSubmission[]; error?: string }>(
        '/api/canvas/assignment-submissions',
        { courseId: String(courseId), assignmentId: String(assignment.id) }
      );
      if (data.error) {
        showToast(`ไม่สามารถดึงคะแนนได้: ${data.error}`, 'error');
        setLoadingScores(false);
        return;
      }

      // Set selectedAssignment from API response (includes due_at)
      const assignmentDetails = data.assignment;
      setSelectedAssignment({
        id: assignmentDetails?.id || Number(assignment.id),
        name: assignment.name,
        points_possible: assignment.pointsPossible,
        due_at: assignmentDetails?.due_at ?? null,
      });

      const submissions: CanvasSubmission[] = data.submissions || [];
      const scoreMap = new Map<string, { name: string; score: number | null; enteredScore: number | null; pointsDeducted: number | null; secondsLate: number; isLate: boolean; section: string }>();
      for (const sub of submissions) {
        const sisId = sub.user?.sis_user_id;
        if (sisId) {
          scoreMap.set(sisId, {
            name: sub.user?.sortable_name || sub.user?.name || '',
            score: sub.score,
            enteredScore: sub.entered_score ?? sub.score,
            pointsDeducted: sub.points_deducted ?? null,
            secondsLate: sub.seconds_late ?? 0,
            isLate: sub.late ?? false,
            section: '',
          });
        }
      }
      setCanvasScores(scoreMap);
      showToast(`โหลด ${scoreMap.size} คะแนนจาก Canvas สำเร็จ`, 'success');
      setCurrentStep(2);
    } catch {
      showToast('เกิดข้อผิดพลาดในการดึงคะแนน', 'error');
    } finally {
      setLoadingScores(false);
    }
  }, [courseId, showToast]);

  const handleFetchCanvasAssignments = useCallback(async () => {
    if (!courseId) {
      showToast('ไม่พบ Course ID', 'error');
      return;
    }
    setLoadingCanvasAssignments(true);
    try {
      const data = await apiGet<{ assignments?: any[] }>('/api/canvas/assignments', {
        courseId: String(courseId),
      });
      const assignments = (data.assignments || []).filter((a: any) => a.published);
      setCanvasAssignments(assignments);
      setNoMasterMode(true);
      showToast(`ดึง ${assignments.length} assignments สำเร็จ`, 'success');
    } catch {
      showToast('ไม่สามารถดึง assignments ได้', 'error');
    } finally {
      setLoadingCanvasAssignments(false);
    }
  }, [courseId, showToast]);

  const handleSelectCanvasAssignment = useCallback(async (assignment: any) => {
    if (!courseId) {
      showToast('ไม่พบ Course ID', 'error');
      return;
    }
    setLoadingScores(true);
    try {
      const data = await apiGet<{ assignment?: any; submissions?: CanvasSubmission[]; error?: string }>(
        '/api/canvas/assignment-submissions',
        { courseId: String(courseId), assignmentId: String(assignment.id) }
      );
      if (data.error) {
        showToast(`ไม่สามารถดึงคะแนนได้: ${data.error}`, 'error');
        setLoadingScores(false);
        return;
      }

      const assignmentDetails = data.assignment;
      setSelectedAssignment({
        id: assignmentDetails?.id || assignment.id,
        name: assignment.name,
        points_possible: assignment.points_possible ?? null,
        due_at: assignmentDetails?.due_at ?? assignment.due_at ?? null,
      });

      const submissions: CanvasSubmission[] = data.submissions || [];
      const scoreMap = new Map<string, { name: string; score: number | null; enteredScore: number | null; pointsDeducted: number | null; secondsLate: number; isLate: boolean; section: string }>();
      for (const sub of submissions) {
        const sisId = sub.user?.sis_user_id;
        if (sisId) {
          scoreMap.set(sisId, {
            name: sub.user?.sortable_name || sub.user?.name || '',
            score: sub.score,
            enteredScore: sub.entered_score ?? sub.score,
            pointsDeducted: sub.points_deducted ?? null,
            secondsLate: sub.seconds_late ?? 0,
            isLate: sub.late ?? false,
            section: '',
          });
        }
      }
      setCanvasScores(scoreMap);
      showToast(`โหลด ${scoreMap.size} คะแนนจาก Canvas สำเร็จ`, 'success');
      setCurrentStep(2);
    } catch {
      showToast('เกิดข้อผิดพลาดในการดึงคะแนน', 'error');
    } finally {
      setLoadingScores(false);
    }
  }, [courseId, showToast]);

  // ==================== Step 2: Upload & Parse Edpuzzle ====================

  const handleEdpuzzleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const filename = file.name;
    // Read file buffer BEFORE any state updates to avoid re-render invalidating the File reference
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      // Fallback: use FileReader for environments where arrayBuffer() fails
      try {
        buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        });
      } catch {
        showToast('ไม่สามารถอ่านไฟล์ได้ — ลองบันทึกไฟล์ไว้ใน Desktop แล้วอัพโหลดอีกครั้ง', 'error');
        e.target.value = '';
        return;
      }
    }
    setLoadingEdpuzzle(true);
    setEdpuzzleFilename(filename);
    try {
      const parsed = await parseEdpuzzleFileFromBuffer(buffer);
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
      e.target.value = '';
    }
  }, [showToast, loadEdpuzzleConfig]);

  // Select Edpuzzle file from project files (FileSelector)
  const handleSelectEdpuzzleFile = useCallback(async (file: ProjectFile) => {
    setSelectedEdpuzzleFile(file);
    setLoadingEdpuzzle(true);
    setEdpuzzleFilename(file.originalFilename);
    try {
      const content = await loadFileContent(file);
      if (!validateEdpuzzleFile(content)) {
        showToast('ไฟล์ไม่ใช่ Edpuzzle export ที่ถูกต้อง', 'error');
        return;
      }
      const epData = parseEdpuzzleData(content);
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
          showToast(`โหลดไฟล์สำเร็จ: ${epData.students.length} นศ., ${epData.totalClips} คลิป — โหลดจำนวนคำถามที่บันทึกไว้แล้ว`, 'success');
        }
      } catch { /* ignore */ }

      if (!loaded) {
        setClipQuestions(epData.clips.map(() => 0));
        setConfigLoaded(false);
        setSavedConfig(null);
        showToast(`โหลดไฟล์สำเร็จ: ${epData.students.length} นศ., ${epData.totalClips} คลิป`, 'success');
      }

      setCurrentStep(3);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอ่านไฟล์ Edpuzzle', 'error');
    } finally {
      setLoadingEdpuzzle(false);
    }
  }, [loadFileContent, showToast, loadEdpuzzleConfig]);

  // ==================== Step 3: Paste from Bookmarklet ====================

  const handlePasteFromBookmarklet = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showToast('Clipboard ว่าง — รัน Bookmarklet บน Edpuzzle ก่อน', 'error');
        return;
      }
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        showToast('ข้อมูลใน Clipboard ไม่ใช่ JSON — รัน Bookmarklet บน Edpuzzle ก่อน', 'error');
        return;
      }

      // Support both single playlist and array of playlists
      const playlists = Array.isArray(data) ? data : [data];

      if (playlists.length === 0) {
        showToast('ไม่พบข้อมูล playlist', 'error');
        return;
      }

      // Save all playlists to Firebase
      const configsToSave = playlists.map((pl: any) => ({
        totalClips: pl.totalClips || pl.clips?.length || 0,
        clipQuestions: pl.clips?.map((c: any) => c.questionCount ?? c.questions ?? 0) || [],
        label: pl.playlistName || pl.name || `${pl.totalClips} คลิป`,
        playlistName: pl.playlistName || pl.name || '',
      }));

      if (configsToSave.length > 1) {
        const saved = await saveEdpuzzleConfigs(configsToSave);
        showToast(`บันทึก ${saved} playlists สำเร็จ`, 'success');
      } else if (configsToSave.length === 1) {
        await saveEdpuzzleConfig(configsToSave[0]);
        showToast(`บันทึก playlist "${configsToSave[0].label}" สำเร็จ`, 'success');
      }

      // Reload all configs
      const updatedConfigs = await loadAllEdpuzzleConfigs();
      setAllConfigs(updatedConfigs);

      // If current edpuzzle data exists, try to match config
      if (edpuzzleData) {
        const matchingConfig = configsToSave.find((c: any) => c.totalClips === edpuzzleData.totalClips);
        if (matchingConfig && matchingConfig.clipQuestions.length === edpuzzleData.totalClips) {
          setClipQuestions(matchingConfig.clipQuestions);
          setConfigLoaded(true);
          showToast(`จำนวนคำถามถูกกรอกอัตโนมัติจาก "${matchingConfig.label}"`, 'success');
        }
      }
    } catch (err) {
      showToast('ไม่สามารถอ่าน Clipboard ได้ — ลอง copy ข้อมูลจาก Bookmarklet อีกครั้ง', 'error');
    }
  }, [edpuzzleData, saveEdpuzzleConfig, saveEdpuzzleConfigs, loadAllEdpuzzleConfigs, showToast]);

  // Apply a saved config to current clip questions
  const applySavedConfig = useCallback((config: EdpuzzleConfig) => {
    if (!edpuzzleData) return;
    if (config.clipQuestions.length !== edpuzzleData.totalClips) {
      showToast(`Config "${config.label}" มี ${config.clipQuestions.length} คลิป แต่ไฟล์มี ${edpuzzleData.totalClips} คลิป — ไม่ตรงกัน`, 'error');
      return;
    }
    setClipQuestions(config.clipQuestions);
    setSavedConfig(config);
    setConfigLoaded(true);
    showToast(`ใช้ config "${config.label}" สำเร็จ`, 'success');
  }, [edpuzzleData, showToast]);

  // ==================== Step 3→4: Calculate ====================

  const handleCalculate = useCallback(() => {
    if (!edpuzzleData || !selectedAssignment) return;
    if (!masterData && !noMasterMode) return;

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

    // Name-based matching helpers (fallback when SIS ID doesn't match)
    const THAI_TITLES = /^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|Mr\.|Ms\.|Mrs\.|Miss\.?)\s*/i;
    const normalizeName = (name: string): string[] =>
      name.replace(THAI_TITLES, '').replace(/[,]/g, ' ').split(/\s+/).filter(Boolean);

    // Build name-based lookup: key = sorted name parts joined, value = EP student
    const epByName = new Map<string, typeof edpuzzleData.students[number]>();
    // Also keep individual EP name parts for subset matching
    const epNameParts = new Map<typeof edpuzzleData.students[number], Set<string>>();
    edpuzzleData.students.forEach(s => {
      const parts = [
        ...normalizeName(s.lastName),
        ...normalizeName(s.firstName),
      ];
      if (parts.length > 0) {
        // Exact sorted key
        const key = [...parts].sort().join('|');
        epByName.set(key, s);
        epNameParts.set(s, new Set(parts));
      }
    });

    // Find EP student by name (used when SIS ID match fails)
    const findEpByName = (canvasName: string): typeof edpuzzleData.students[number] | undefined => {
      const canvasParts = normalizeName(canvasName);
      if (canvasParts.length === 0) return undefined;
      // Try exact sorted match first
      const exactKey = [...canvasParts].sort().join('|');
      const exact = epByName.get(exactKey);
      if (exact) return exact;
      // Subset match: EP firstName+lastName both appear in Canvas name parts
      const canvasSet = new Set(canvasParts);
      for (const [epStudent, parts] of epNameParts) {
        if (parts.size === 0) continue;
        const allFound = [...parts].every(p => canvasSet.has(p));
        if (allFound) return epStudent;
      }
      return undefined;
    };

    const ptsPossible = pointsPossible;
    const matchedStudents: MatchedStudent[] = [];
    const matchedEpIds = new Set<string>();

    // Late deduction setup
    const effectivePolicy: CanvasLatePolicy | ManualLatePolicy | null =
      useManualPolicy ? manualLatePolicy : latePolicy;
    const assignmentDueAt = selectedAssignment?.due_at
      ? new Date(selectedAssignment.due_at)
      : null;

    // Helper: calculate EP late deduction for a student
    const calcEpLate = (weightedScore: number | null, timeTurnedIn: string) => {
      const defaults = { epTimeTurnedIn: timeTurnedIn, epSecondsLate: 0, epDeductionPercent: 0, epAdjustedScore: weightedScore, epAdjustedScaledScore: weightedScore !== null && ptsPossible !== null ? Math.round((weightedScore * ptsPossible / 100) * 100) / 100 : null, epIsLate: false };
      if (weightedScore === null || !assignmentDueAt || !effectivePolicy) return defaults;
      const submittedAt = parseEdpuzzleTimestamp(timeTurnedIn);
      if (!submittedAt) return defaults;
      const result = calculateLateDeduction(weightedScore, submittedAt, assignmentDueAt, effectivePolicy);
      return {
        epTimeTurnedIn: timeTurnedIn,
        epSecondsLate: result.secondsLate,
        epDeductionPercent: result.deductionPercent,
        epAdjustedScore: result.adjustedScore,
        epAdjustedScaledScore: ptsPossible !== null ? Math.round((result.adjustedScore * ptsPossible / 100) * 100) / 100 : null,
        epIsLate: result.isLate,
      };
    };

    // Build student roster: from masterData or canvasScores (noMasterMode)
    const studentRoster: Array<{
      studentName: string; canvasId: string; sisUserId: string;
      sisLoginId: string; integrationId: string; section: string; regStatus: string;
    }> = [];

    if (noMasterMode) {
      // Use canvasScores Map as the student roster
      canvasScores.forEach((info, sisId) => {
        studentRoster.push({
          studentName: info.name || sisId,
          canvasId: '',
          sisUserId: sisId,
          sisLoginId: '',
          integrationId: '',
          section: '',
          regStatus: '—',
        });
      });
    } else if (masterData) {
      for (const row of masterData.rows) {
        studentRoster.push({
          studentName: row[0] || '',
          canvasId: row[1] || '',
          sisUserId: (row[2] || '').trim(),
          sisLoginId: row[3] || '',
          integrationId: row[4] || '',
          section: row[5] || '',
          regStatus: row[6] || '',
        });
      }
    }

    // Process students from roster
    for (const student of studentRoster) {
      const { studentName, canvasId, sisUserId, sisLoginId, integrationId, section, regStatus } = student;

      if (!sisUserId) continue;

      // Get submission details from canvasScores (from Canvas API)
      const submissionInfo = canvasScores.get(sisUserId);
      const canvasScore = submissionInfo?.score !== null && submissionInfo?.score !== undefined
        ? String(submissionInfo.score) : '';
      const canvasEnteredScore = submissionInfo?.enteredScore !== null && submissionInfo?.enteredScore !== undefined
        ? String(submissionInfo.enteredScore) : '';

      // Match by SIS ID first, fallback to name matching
      let epStudent = epBySisId.get(sisUserId);
      if (!epStudent && studentName) {
        epStudent = findEpByName(studentName);
      }
      if (epStudent) matchedEpIds.add(epStudent.studentId || `name:${epStudent.lastName},${epStudent.firstName}`);

      const weightedScore = epStudent
        ? calculateWeightedScore(epStudent.clipGrades, clipsWithQuestions)
        : null;

      const completedClips = epStudent ? countCompletedClips(epStudent.clipGrades) : 0;
      const lastClipTime = epStudent ? getLastClipTurnedIn(epStudent.clipTimeTurnedIn) : '';
      // Use timeTurnedIn if available (complete submission), otherwise use lastClipTime (incomplete)
      const epLateTime = epStudent?.timeTurnedIn || lastClipTime;
      const epLate = calcEpLate(weightedScore, epLateTime);
      const submissionStatus = epStudent
        ? getSubmissionStatus(completedClips, edpuzzleData.totalClips, lastClipTime, assignmentDueAt)
        : '';

      matchedStudents.push({
        studentName,
        canvasId,
        studentId: sisUserId,
        sisLoginId,
        integrationId,
        section,
        regStatus,
        canvasScore,
        canvasEnteredScore,
        pointsDeducted: submissionInfo?.pointsDeducted ?? null,
        secondsLate: submissionInfo?.secondsLate ?? 0,
        isLate: submissionInfo?.isLate ?? false,
        edpuzzleScore: weightedScore,
        edpuzzleScaledScore: weightedScore !== null && ptsPossible !== null
          ? Math.round((weightedScore * ptsPossible / 100) * 100) / 100
          : null,
        edpuzzleTotalGrade: epStudent?.totalGrade || '',
        progress: epStudent?.progress || 0,
        totalClips: edpuzzleData.totalClips,
        completedClips,
        clipGrades: epStudent?.clipGrades || [],
        onTime: epStudent?.onTime || '',
        ...epLate,
        epLastClipTurnedIn: lastClipTime,
        epSubmissionStatus: submissionStatus,
        matchStatus: epStudent ? 'matched' : 'canvas-only',
      });
    }

    // Edpuzzle-only students (not in roster / not matched)
    edpuzzleData.students.forEach(epStudent => {
      const epKey = epStudent.studentId || `name:${epStudent.lastName},${epStudent.firstName}`;
      if (!matchedEpIds.has(epKey)) {
        const weightedScore = calculateWeightedScore(epStudent.clipGrades, clipsWithQuestions);
        const epOnlyCompleted = countCompletedClips(epStudent.clipGrades);
        const epOnlyLastClip = getLastClipTurnedIn(epStudent.clipTimeTurnedIn);
        const epOnlyLateTime = epStudent.timeTurnedIn || epOnlyLastClip;
        const epLateOnly = calcEpLate(weightedScore, epOnlyLateTime);
        const epOnlyStatus = getSubmissionStatus(epOnlyCompleted, edpuzzleData.totalClips, epOnlyLastClip, assignmentDueAt);
        matchedStudents.push({
          studentName: `${epStudent.firstName} ${epStudent.lastName}`,
          canvasId: '',
          studentId: epStudent.studentId,
          sisLoginId: '',
          integrationId: '',
          section: '',
          regStatus: '',
          canvasScore: '',
          canvasEnteredScore: '',
          pointsDeducted: null,
          secondsLate: 0,
          isLate: false,
          edpuzzleScore: weightedScore,
          edpuzzleScaledScore: weightedScore !== null && ptsPossible !== null
            ? Math.round((weightedScore * ptsPossible / 100) * 100) / 100
            : null,
          edpuzzleTotalGrade: epStudent.totalGrade,
          progress: epStudent.progress,
          totalClips: edpuzzleData.totalClips,
          completedClips: epOnlyCompleted,
          clipGrades: epStudent.clipGrades,
          onTime: epStudent.onTime,
          ...epLateOnly,
          epLastClipTurnedIn: epOnlyLastClip,
          epSubmissionStatus: epOnlyStatus,
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
  }, [edpuzzleData, selectedAssignment, clipQuestions, canvasScores, masterData, noMasterMode, pointsPossible, latePolicy, manualLatePolicy, useManualPolicy, showToast]);

  // ==================== Step 4: Export ====================

  const totalQuestions = useMemo(() =>
    clipQuestions.reduce((sum, q) => sum + q, 0),
    [clipQuestions]
  );

  const assignmentName = selectedAssignment?.name || '';

  const buildXlsxBuffer = useCallback((): Uint8Array | null => {
    if (results.length === 0) return null;

    const hasScaled = pointsPossible !== null;
    const hasLate = results.some(s => s.pointsDeducted != null && s.pointsDeducted > 0);
    const hasEpLate = results.some(s => s.epIsLate);

    const mainHeaders = [
      // Canvas A-F columns
      'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
      // Master data columns
      'Reg Status', 'สถานะจับคู่',
      // Canvas score
      `Canvas: ${assignmentName}`,
      ...(hasLate ? ['Canvas (ก่อนหัก)', 'Canvas หักคะแนนสาย', 'Canvas สถานะส่งสาย'] : []),
      // EP scores
      'Edpuzzle Score (weighted %)',
      ...(hasScaled ? [`Edpuzzle Score (เต็ม ${pointsPossible})`] : []),
      ...(hasEpLate ? [
        hasScaled ? `EP หลังหักสาย (เต็ม ${pointsPossible})` : 'EP หลังหักสาย (%)',
        'EP สาย (เวลา)',
        'EP หัก %',
      ] : []),
      'Edpuzzle Total Grade',
      'EP Time Turned In',
      `Progress (out of ${edpuzzleData?.totalClips || 0})(%)`,
      'Completed Clips',
      'EP สถานะส่ง',
      'EP ส่งคลิปล่าสุด',
    ];

    const mainRows = results.map(s => [
      // Canvas A-F columns
      s.studentName,
      s.canvasId,
      s.studentId,
      s.sisLoginId,
      s.integrationId,
      s.section,
      // Master data columns
      s.regStatus,
      s.matchStatus === 'matched' ? 'ตรงกัน'
        : s.matchStatus === 'canvas-only' ? 'เฉพาะ Canvas'
        : 'เฉพาะ Edpuzzle',
      // Canvas score
      s.canvasScore,
      ...(hasLate ? [
        s.canvasEnteredScore,
        s.pointsDeducted != null && s.pointsDeducted > 0 ? s.pointsDeducted : '',
        s.isLate ? `สาย (${formatLateDuration(s.secondsLate)})` : '',
      ] : []),
      // EP scores
      s.edpuzzleScore !== null ? Math.round(s.edpuzzleScore * 100) / 100 : '',
      ...(hasScaled ? [s.edpuzzleScaledScore !== null ? s.edpuzzleScaledScore : ''] : []),
      ...(hasEpLate ? [
        hasScaled
          ? (s.epAdjustedScaledScore ?? '')
          : (s.epAdjustedScore !== null ? Math.round(s.epAdjustedScore * 100) / 100 : ''),
        s.epIsLate ? formatLateDuration(s.epSecondsLate) : '',
        s.epIsLate ? s.epDeductionPercent : '',
      ] : []),
      s.edpuzzleTotalGrade,
      s.epTimeTurnedIn,
      s.progress,
      `${s.completedClips}/${s.totalClips}`,
      formatSubmissionStatus(s.epSubmissionStatus).label,
      s.epLastClipTurnedIn,
    ]);

    // Detail sheet: per-clip grades with metadata rows (also A-F prefix)
    const clipHeaders = [
      'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
      ...(edpuzzleData?.clips.map((c, i) =>
        `(${c.index}/${c.totalClips}) Grade [${clipQuestions[i] || 0}Q]`
      ) || []),
    ];

    const totalQ = clipQuestions.reduce((sum, q) => sum + q, 0);
    const questionCountRow = [
      'จำนวนคำถาม', '', '', '', '', '',
      ...clipQuestions.map(q => q || 0),
    ];
    const weightRow = [
      'สัดส่วน (%)', '', '', '', '', '',
      ...clipQuestions.map(q => totalQ > 0 ? Math.round((q / totalQ) * 10000) / 100 : 0),
    ];

    const clipDataRows = results
      .filter(s => s.matchStatus !== 'canvas-only')
      .map(s => [
        s.studentName,
        s.canvasId,
        s.studentId,
        s.sisLoginId,
        s.integrationId,
        s.section,
        ...s.clipGrades.map(g => g !== null ? g : ''),
      ]);

    const clipRows = [questionCountRow, weightRow, ...clipDataRows];

    const sheets: SheetData[] = [
      { name: 'สรุปคะแนน', headers: mainHeaders, rows: mainRows },
      { name: 'คะแนนรายคลิป', headers: clipHeaders, rows: clipRows },
    ];

    return buildXlsxMultiSheet(sheets);
  }, [results, assignmentName, edpuzzleData, clipQuestions, pointsPossible]);

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
      const label = `Edpuzzle: ${edpuzzleFilename || 'analysis'} vs ${assignmentName}`;
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
    setSelectedMasterAssignment(null);
    setSelectedAssignment(null);
    setCanvasScores(new Map());
    setSelectedEdpuzzleFile(null);
    setEdpuzzleData(null);
    setEdpuzzleFilename('');
    setClipQuestions([]);
    setResults([]);
    setSavedConfig(null);
    setConfigLoaded(false);
    setNoMasterMode(false);
    setCanvasAssignments([]);
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
    const lateWithDeduction = results.filter(s => s.pointsDeducted != null && s.pointsDeducted > 0).length;
    return {
      total: results.length,
      matched: matched.length,
      canvasOnly: results.filter(s => s.matchStatus === 'canvas-only').length,
      epOnly: results.filter(s => s.matchStatus === 'edpuzzle-only').length,
      avgScore: Math.round(avgScore * 100) / 100,
      avgScaled: avgScaled !== null ? Math.round(avgScaled * 100) / 100 : null,
      fullProgress,
      lateWithDeduction,
    };
  }, [results]);

  const hasAnyLateDeduction = useMemo(() =>
    results.some(s => s.pointsDeducted != null && s.pointsDeducted > 0),
    [results]);

  const hasEpLateDeduction = useMemo(() =>
    results.some(s => s.epIsLate),
    [results]);

  // Bookmarklet code for display
  const bookmarkletCode = `javascript:void(function(){var a=[...document.querySelectorAll("span")].filter(function(s){return/^\\d+\\s*(min|sec|s)/.test(s.textContent?.trim()||"")&&s.children.length===0}),r=[],p=null,seen=new Set;a.forEach(function(d){var el=d.closest("a");if(!el)return;var w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),t=[];while(w.nextNode()){var x=w.currentNode.textContent?.trim();if(x)t.push(x)}var title=t[0]||"",qm=t.find(function(x){return/^\\d+\\s+question/.test(x)}),qc=qm?parseInt(qm):0;if(!seen.has(title)){seen.add(title);r.push({title:title,questionCount:qc})}if(!p){var h=el.closest("[class]");while(h&&!h.querySelector('[class*="activities"]'))h=h.parentElement;if(h){var label=h.querySelector('[class*="activities"]');if(label)p=h.querySelector("h3,h2,h4,[class*=title]")?.textContent?.trim()||""}}});var name=p||document.title.replace(/ - Edpuzzle$/,"");var out=[{playlistName:name,totalClips:r.length,clips:r}];navigator.clipboard.writeText(JSON.stringify(out)).then(function(){alert("Copied "+r.length+" clips from: "+name)})})()`;

  // ==================== Render ====================

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">วิเคราะห์คะแนน Edpuzzle</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          เลือก Assignment จากข้อมูลหลัก, อัพโหลดไฟล์ Edpuzzle, คำนวณคะแนนตามจำนวนคำถาม
        </p>
      </div>

      <div className="glass-card p-6">
        <StepWizard steps={STEPS} currentStep={currentStep}>
          {/* Step 1: Select Assignment from Master Data */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือก Assignment จากข้อมูลหลัก</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              เลือก Assignment จากข้อมูลหลักของวิชา เพื่อเปรียบเทียบกับ Edpuzzle
            </p>

            {loadingMasterData && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังโหลดข้อมูลหลัก...
              </div>
            )}

            {/* No master data → offer Canvas API fallback */}
            {!loadingMasterData && !masterData && !noMasterMode && (
              <div className="space-y-3 py-4">
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 text-sm text-yellow-300">
                  ยังไม่มีข้อมูลหลัก — สามารถสร้างที่หน้าโปรเจค หรือดึง Assignment จาก Canvas โดยตรง
                </div>
                <button
                  onClick={handleFetchCanvasAssignments}
                  disabled={loadingCanvasAssignments || !courseId}
                  className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loadingCanvasAssignments ? 'กำลังดึง...' : 'ดึง Assignment จาก Canvas'}
                </button>
              </div>
            )}

            {/* Master data path: show assignments from master data */}
            {masterData && masterData.assignments.length > 0 && (
              <div className="max-h-80 overflow-y-auto space-y-1 rounded-lg border border-white/10 p-3">
                {masterData.assignments.map((a) => (
                  <label
                    key={a.id || a.columnIndex}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-2.5 transition ${
                      selectedMasterAssignment?.columnIndex === a.columnIndex ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30' : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment"
                      checked={selectedMasterAssignment?.columnIndex === a.columnIndex}
                      onChange={() => setSelectedMasterAssignment(a)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="flex-1 text-sm text-[var(--color-text-primary)]">{a.name}</span>
                    {a.pointsPossible !== null && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                        เต็ม {a.pointsPossible}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}

            {masterData && masterData.assignments.length === 0 && (
              <div className="text-center py-4">
                <p className="text-sm text-[var(--color-text-muted)]">ไม่พบ Assignment ในข้อมูลหลัก</p>
              </div>
            )}

            {/* No-master mode: show assignments from Canvas API */}
            {noMasterMode && canvasAssignments.length > 0 && (
              <div className="space-y-2">
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-xs text-blue-300">
                  ใช้ข้อมูลจาก Canvas API (ไม่มี master data)
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1 rounded-lg border border-white/10 p-3">
                  {canvasAssignments.map((a: any) => (
                    <label
                      key={a.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg p-2.5 transition ${
                        selectedAssignment?.id === a.id ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <input
                        type="radio"
                        name="assignment"
                        checked={selectedAssignment?.id === a.id}
                        onChange={() => setSelectedAssignment({ id: a.id, name: a.name, points_possible: a.points_possible, due_at: a.due_at })}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="flex-1 text-sm text-[var(--color-text-primary)]">{a.name}</span>
                      {a.points_possible != null && (
                        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                          เต็ม {a.points_possible}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {loadingScores && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังดึงคะแนนจาก Canvas...
              </div>
            )}

            {/* Next button: master data path */}
            {!noMasterMode && (
              <div className="flex justify-end">
                <button
                  className="btn btn-primary"
                  disabled={!selectedMasterAssignment || loadingScores}
                  onClick={() => selectedMasterAssignment && handleSelectAssignment(selectedMasterAssignment)}
                >
                  {loadingScores ? 'กำลังโหลด...' : 'ถัดไป'}
                </button>
              </div>
            )}

            {/* Next button: no-master mode */}
            {noMasterMode && (
              <div className="flex justify-end">
                <button
                  className="btn btn-primary"
                  disabled={!selectedAssignment || loadingScores}
                  onClick={() => selectedAssignment && handleSelectCanvasAssignment(selectedAssignment)}
                >
                  {loadingScores ? 'กำลังโหลด...' : 'ถัดไป'}
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Select/Upload Edpuzzle file */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Edpuzzle</h3>

            {selectedAssignment && (
              <div className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-4 py-3 text-sm">
                <p className="font-medium text-[var(--color-accent)]">Assignment: {selectedAssignment.name}</p>
                <p className="text-[var(--color-text-muted)]">
                  คะแนนเต็ม: {selectedAssignment.points_possible ?? 'N/A'} | โหลดคะแนน Canvas: {canvasScores.size} คน
                </p>
              </div>
            )}

            {/* FileSelector: select from uploaded project files */}
            {files.edpuzzle.length > 0 && (
              <div>
                <p className="mb-2 text-sm text-[var(--color-text-muted)]">เลือกไฟล์ Edpuzzle ที่อัพโหลดไว้ในโปรเจค:</p>
                <FileSelector
                  group="edpuzzle"
                  label="Edpuzzle Export"
                  selectedFileId={selectedEdpuzzleFile?.id}
                  onSelect={handleSelectEdpuzzleFile}
                />
              </div>
            )}

            {/* Divider */}
            {files.edpuzzle.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-[var(--color-text-muted)]">หรืออัพโหลดไฟล์ใหม่</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
            )}

            {/* Inline upload fallback */}
            <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-white/20 p-6 transition hover:border-[var(--color-accent)]/50 hover:bg-white/5">
              <span className="text-3xl">📄</span>
              <span className="text-sm text-[var(--color-text-muted)]">
                {files.edpuzzle.length > 0 ? 'อัพโหลดไฟล์ใหม่' : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง'}
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
                  {edpuzzleFilename} — {edpuzzleData.students.length} นักศึกษา, {edpuzzleData.totalClips} คลิป
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
            {/* Paste from Bookmarklet */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">จำนวนคำถามในแต่ละคลิป</h3>
                <button
                  onClick={handlePasteFromBookmarklet}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)]"
                >
                  📋 Paste จาก Edpuzzle
                </button>
                <button
                  onClick={() => setShowBookmarklet(!showBookmarklet)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition"
                >
                  {showBookmarklet ? '▼ ซ่อนคำแนะนำ' : '▶ วิธีใช้ Bookmarklet'}
                </button>
              </div>

              {showBookmarklet && (
                <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm space-y-3">
                  <p className="font-medium text-[var(--color-text-primary)]">วิธีใช้ Bookmarklet ดึงจำนวนคำถามจาก Edpuzzle:</p>
                  <ol className="list-decimal pl-5 space-y-2 text-[var(--color-text-muted)]">
                    <li>เปิด class บน Edpuzzle แล้ว <strong>Expand</strong> playlist ที่ต้องการ (คลิกที่ playlist ให้เห็นรายการคลิปทั้งหมด)</li>
                    <li>
                      กด <strong>Copy</strong> ด้านล่างเพื่อคัดลอก code จากนั้นทำอย่างใดอย่างหนึ่ง:
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li><strong>วิธี A (Bookmarklet):</strong> สร้าง bookmark ใหม่ในเบราว์เซอร์ ตั้งชื่ออะไรก็ได้ แล้ววาง code ลงในช่อง URL จากนั้นเปิดหน้า Edpuzzle แล้วคลิก bookmark นั้น</li>
                        <li><strong>วิธี B (Console):</strong> เปิด DevTools (F12 หรือ Cmd+Opt+I) ไปที่แท็บ Console แล้ววาง code ลงไป กด Enter</li>
                      </ul>
                    </li>
                  </ol>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-[var(--color-text-muted)] max-h-24">
                      {bookmarkletCode}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(bookmarkletCode);
                        showToast('Copy Bookmarklet code สำเร็จ', 'success');
                      }}
                      className="absolute top-2 right-2 rounded bg-white/10 px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:bg-white/20"
                    >
                      Copy
                    </button>
                  </div>
                  <ol start={3} className="list-decimal pl-5 space-y-1 text-[var(--color-text-muted)]">
                    <li>จะมี alert แจ้งจำนวนคลิปที่ดึงได้ + ข้อมูลจะถูก copy ไป clipboard อัตโนมัติ</li>
                    <li>กลับมาหน้านี้แล้วกด <strong>📋 Paste จาก Edpuzzle</strong> ด้านบน</li>
                  </ol>
                </div>
              )}

              {/* Saved configs quick-apply */}
              {allConfigs.length > 0 && edpuzzleData && (
                <div className="mb-4">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">Config ที่บันทึกไว้:</p>
                  <div className="flex flex-wrap gap-2">
                    {allConfigs
                      .filter(c => c.clipQuestions.length === edpuzzleData.totalClips)
                      .map((c) => (
                        <span
                          key={c.id}
                          className={`group relative inline-flex items-center gap-1 rounded-lg border pr-1 text-xs transition ${
                            savedConfig?.id === c.id
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                              : 'border-white/10 bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'
                          }`}
                        >
                          <button
                            onClick={() => applySavedConfig(c)}
                            className="px-3 py-1.5"
                          >
                            {c.playlistName || c.label} ({c.totalClips} คลิป, {c.clipQuestions.reduce((a, b) => a + b, 0)} Q)
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`ลบ config "${c.playlistName || c.label}" ?`)) return;
                              try {
                                await deleteEdpuzzleConfig(c.id);
                                if (savedConfig?.id === c.id) {
                                  setSavedConfig(null);
                                  setConfigLoaded(false);
                                }
                                const updated = await loadAllEdpuzzleConfigs();
                                setAllConfigs(updated);
                                showToast('ลบ config สำเร็จ', 'success');
                              } catch {
                                showToast('ลบ config ไม่สำเร็จ', 'error');
                              }
                            }}
                            className="rounded p-0.5 text-[var(--color-text-muted)] opacity-0 transition hover:bg-white/10 hover:text-[var(--color-danger)] group-hover:opacity-100"
                            title="ลบ config นี้"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    {allConfigs.filter(c => c.clipQuestions.length === edpuzzleData.totalClips).length === 0 && (
                      <span className="text-xs text-[var(--color-text-muted)]">ไม่มี config ที่ตรงกับ {edpuzzleData.totalClips} คลิป</span>
                    )}
                  </div>
                </div>
              )}

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
                      ✅ {savedConfig.playlistName || savedConfig.label}
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
                        const updatedConfigs = await loadAllEdpuzzleConfigs();
                        setAllConfigs(updatedConfigs);
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

            {/* Late Policy Configuration */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                🕐 นโยบายหักคะแนนส่งสาย
              </h4>

              {/* Show Canvas due date */}
              {selectedAssignment?.due_at ? (
                <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                  กำหนดส่ง: <span className="font-medium text-[var(--color-text-primary)]">{new Date(selectedAssignment.due_at).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' })}</span>
                </p>
              ) : (
                <p className="mb-3 text-xs text-[var(--color-warning)]">
                  ⚠️ Assignment นี้ไม่มี due date — ไม่สามารถคำนวณการหักคะแนนสายได้
                </p>
              )}

              {/* Canvas late policy display */}
              {latePolicy && !useManualPolicy ? (
                <div className="rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-4 py-3">
                  <p className="text-sm font-medium text-[var(--color-success)]">
                    ✅ ใช้นโยบายจาก Canvas
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    หัก {latePolicy.late_submission_deduction}% ต่อ{latePolicy.late_submission_interval === 'hour' ? 'ชั่วโมง' : 'วัน'}
                    {latePolicy.late_submission_minimum_percent_enabled && ` (ขั้นต่ำ ${latePolicy.late_submission_minimum_percent}%)`}
                    {!latePolicy.late_submission_deduction_enabled && ' (ปิดอยู่)'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setUseManualPolicy(true);
                      setManualLatePolicy({
                        deductionPercent: latePolicy.late_submission_deduction,
                        interval: latePolicy.late_submission_interval,
                        minimumPercent: latePolicy.late_submission_minimum_percent_enabled ? latePolicy.late_submission_minimum_percent : 0,
                      });
                    }}
                    className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    ใช้ค่าอื่นแทน
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {!latePolicy && (
                    <p className="text-xs text-[var(--color-warning)]">
                      ไม่พบนโยบายส่งสายใน Canvas — กรุณาระบุเอง
                    </p>
                  )}
                  {useManualPolicy && latePolicy && (
                    <button
                      type="button"
                      onClick={() => setUseManualPolicy(false)}
                      className="text-xs text-[var(--color-accent)] hover:underline"
                    >
                      ← กลับไปใช้ค่าจาก Canvas
                    </button>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-[var(--color-text-muted)]">หัก</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={manualLatePolicy.deductionPercent}
                      onChange={e => setManualLatePolicy(p => ({ ...p, deductionPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                      className="w-16 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-center text-sm text-[var(--color-text-primary)]"
                    />
                    <span className="text-[var(--color-text-muted)]">% ต่อ</span>
                    <select
                      value={manualLatePolicy.interval}
                      onChange={e => setManualLatePolicy(p => ({ ...p, interval: e.target.value as 'hour' | 'day' }))}
                      className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-sm text-[var(--color-text-primary)]"
                    >
                      <option value="hour">ชั่วโมง</option>
                      <option value="day">วัน</option>
                    </select>
                    <span className="text-[var(--color-text-muted)]">ขั้นต่ำ</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={manualLatePolicy.minimumPercent}
                      onChange={e => setManualLatePolicy(p => ({ ...p, minimumPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                      className="w-16 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-center text-sm text-[var(--color-text-primary)]"
                    />
                    <span className="text-[var(--color-text-muted)]">%</span>
                  </div>
                </div>
              )}
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
                    <StatCard
                      icon="📊"
                      label={stats.avgScaled !== null ? `คะแนนเฉลี่ย (เต็ม ${pointsPossible})` : 'คะแนนเฉลี่ย (%)'}
                      value={stats.avgScaled !== null ? stats.avgScaled : stats.avgScore}
                      color="text-[var(--color-accent)]"
                    />
                    <StatCard icon="🎯" label="ครบ 100%" value={stats.fullProgress} color="text-[var(--color-info)]" />
                    {stats.lateWithDeduction > 0 && (
                      <StatCard icon="🕐" label="ถูกหักคะแนนสาย" value={stats.lateWithDeduction} color="text-[var(--color-warning)]" />
                    )}
                  </div>
                )}

                <DataTable
                  headers={[
                    'ชื่อ', 'ID', 'SIS User ID', 'Section',
                    'Reg Status', 'สถานะจับคู่',
                    `Canvas: ${assignmentName.substring(0, 25)}`,
                    ...(hasAnyLateDeduction ? ['Canvas หักสาย'] : []),
                    ...(pointsPossible !== null ? [`EP (เต็ม ${pointsPossible})`] : ['EP Score (%)']),
                    ...(hasEpLateDeduction ? [
                      pointsPossible !== null ? `EP หลังหักสาย (${pointsPossible})` : 'EP หลังหักสาย (%)',
                    ] : []),
                    'EP สถานะส่ง',
                    `Progress (${edpuzzleData?.totalClips || 0})`,
                    'EP ส่งคลิปล่าสุด',
                  ]}
                  rows={results.map(s => [
                    s.studentName,
                    s.canvasId,
                    s.studentId,
                    s.section,
                    s.regStatus ? <span key="reg" className="text-[var(--color-danger)] font-medium">{s.regStatus}</span> : '-',
                    <span key="match" className={
                      s.matchStatus === 'matched' ? 'text-[var(--color-success)]'
                        : s.matchStatus === 'canvas-only' ? 'text-[var(--color-warning)]'
                        : 'text-[var(--color-danger)]'
                    }>
                      {s.matchStatus === 'matched' ? '✅ ตรงกัน' : s.matchStatus === 'canvas-only' ? '⚠️ Canvas' : '❌ EP'}
                    </span>,
                    s.pointsDeducted != null && s.pointsDeducted > 0 ? (
                      <span key="canvas-score" className="flex flex-col">
                        <span className="font-semibold text-[var(--color-text-primary)]">{s.canvasScore}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          ก่อนหัก: {s.canvasEnteredScore}
                        </span>
                      </span>
                    ) : (
                      s.canvasScore || '-'
                    ),
                    ...(hasAnyLateDeduction ? [
                      s.pointsDeducted != null && s.pointsDeducted > 0 ? (
                        <span key="late" className="inline-flex items-center rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                          -{s.pointsDeducted} ({formatLateDuration(s.secondsLate)})
                        </span>
                      ) : '-',
                    ] : []),
                    pointsPossible !== null ? (
                      s.edpuzzleScaledScore !== null ? (
                        <span key="scaled" className={`font-semibold ${
                          s.edpuzzleScaledScore >= pointsPossible * 0.8 ? 'text-[var(--color-success)]'
                          : s.edpuzzleScaledScore >= pointsPossible * 0.5 ? 'text-[var(--color-warning)]'
                          : 'text-[var(--color-danger)]'
                        }`}>
                          {s.edpuzzleScaledScore}
                        </span>
                      ) : '-'
                    ) : (
                      s.edpuzzleScore !== null ? (
                        <span key="ep" className={s.edpuzzleScore >= 80 ? 'text-[var(--color-success)]' : s.edpuzzleScore >= 50 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}>
                          {Math.round(s.edpuzzleScore * 100) / 100}
                        </span>
                      ) : '-'
                    ),
                    ...(hasEpLateDeduction ? [
                      s.epIsLate ? (
                        <span key="ep-adj" className="flex flex-col">
                          <span className="font-semibold text-[var(--color-warning)]">
                            {pointsPossible !== null ? s.epAdjustedScaledScore : (s.epAdjustedScore !== null ? Math.round(s.epAdjustedScore * 100) / 100 : '-')}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            -{s.epDeductionPercent}% ({formatLateDuration(s.epSecondsLate)})
                          </span>
                        </span>
                      ) : (
                        pointsPossible !== null
                          ? (s.edpuzzleScaledScore ?? '-')
                          : (s.edpuzzleScore !== null ? Math.round(s.edpuzzleScore * 100) / 100 : '-')
                      ),
                    ] : []),
                    (() => {
                      const st = formatSubmissionStatus(s.epSubmissionStatus);
                      return s.epSubmissionStatus ? (
                        <span key="sub-status" className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `color-mix(in srgb, ${st.color} 20%, transparent)`, color: st.color }}>
                          {st.label}
                        </span>
                      ) : '-';
                    })(),
                    <span key="prog" className={s.progress === 100 ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}>
                      {s.completedClips}/{s.totalClips} ({s.progress}%)
                    </span>,
                    s.epLastClipTurnedIn ? (
                      <span key="last-clip" className="text-[11px] text-[var(--color-text-muted)]">
                        {(() => {
                          const d = parseEdpuzzleTimestamp(s.epLastClipTurnedIn);
                          return d ? d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : s.epLastClipTurnedIn;
                        })()}
                      </span>
                    ) : '-',
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
