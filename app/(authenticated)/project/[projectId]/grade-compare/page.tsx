'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsx, downloadXlsx } from '@/lib/xlsx-utils';
import { validateCanvasFile } from '@/lib/canvas-utils';
import { parseCanvasToSnapshot, saveGradeSnapshot, getLatestSnapshot, getSnapshotCourses } from '@/lib/grade-snapshot';
import type { ProjectFile, GradeSnapshot, StudentGrade, GradeDiff } from '@/types';

const STEPS = [
  { label: 'เลือกไฟล์ Canvas' },
  { label: 'เลือก Assignment' },
  { label: 'เปรียบเทียบคะแนน' },
];

interface CourseInfo {
  courseId: string;
  courseName: string;
  lastSaved: Date;
  count: number;
}

export default function GradeComparePage() {
  const { user } = useAuth();
  const { loadFileContent, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  // Saved courses
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // Current data
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [currentData, setCurrentData] = useState<Omit<GradeSnapshot, 'id' | 'savedAt'> | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Previous snapshot
  const [latestSnapshot, setLatestSnapshot] = useState<GradeSnapshot | null>(null);

  // Assignment
  const [selectedAssignment, setSelectedAssignment] = useState<string>('');

  // Diff
  const [diffs, setDiffs] = useState<GradeDiff[]>([]);
  const [editedScores, setEditedScores] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load courses
  useEffect(() => {
    if (user) {
      setLoadingCourses(true);
      try {
        getSnapshotCourses(user.uid)
          .then(setCourses)
          .catch((err) => {
            console.error('Failed to load snapshot courses:', err);
            setCourses([]);
          })
          .finally(() => setLoadingCourses(false));
      } catch (err) {
        console.error('Sync error loading snapshot courses:', err);
        setLoadingCourses(false);
      }
    }
  }, [user]);

  // Load Canvas file from project
  const handleLoadFile = useCallback(async (file: ProjectFile) => {
    setSelectedFile(file);
    setLoadingFile(true);
    try {
      const data = await loadFileContent(file);
      if (!validateCanvasFile(data)) {
        showToast('ไฟล์ไม่ใช่ Canvas gradebook export ที่ถูกต้อง', 'error');
        return;
      }
      const courseName = file.originalFilename.replace(/\.csv$|\.xlsx?$/i, '').replace(/_/g, ' ');
      const snapshot = parseCanvasToSnapshot(data, courseName);
      setCurrentData(snapshot);

      // Load latest snapshot
      if (user) {
        const latest = await getLatestSnapshot(user.uid, snapshot.courseId);
        setLatestSnapshot(latest);
        if (!latest) {
          await saveGradeSnapshot(user.uid, snapshot);
          showToast('บันทึกเป็น snapshot แรกเรียบร้อย', 'success');
        }
      }
      setCurrentStep(2);
      showToast(`โหลดสำเร็จ: ${snapshot.students.length} นักศึกษา, ${snapshot.assignments.length} assignments`, 'success');
    } catch (err) {
      console.error('Grade compare load error:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showToast(`เกิดข้อผิดพลาด: ${msg}`, 'error');
    } finally {
      setLoadingFile(false);
    }
  }, [loadFileContent, user, showToast]);

  // Load existing course snapshot
  const handleSelectCourse = useCallback(async (courseId: string) => {
    if (!user) return;
    const latest = await getLatestSnapshot(user.uid, courseId);
    if (latest) {
      setLatestSnapshot(latest);
      showToast(`โหลด snapshot: ${latest.courseName}`, 'info');
    }
  }, [user, showToast]);

  // Diff logic
  const handleCompare = useCallback(() => {
    if (!currentData || !selectedAssignment) return;
    const oldByStudent = new Map<string, StudentGrade>();
    if (latestSnapshot) {
      latestSnapshot.students.forEach(s => { if (s.sisId) oldByStudent.set(s.sisId, s); });
    }
    const diffResults: GradeDiff[] = [];
    const processedOldIds = new Set<string>();
    currentData.students.forEach(student => {
      const oldStudent = student.sisId ? oldByStudent.get(student.sisId) : undefined;
      const newScore = student.scores[selectedAssignment] || '';
      const oldScore = oldStudent ? (oldStudent.scores[selectedAssignment] || '') : null;
      let changeType: GradeDiff['changeType'] = 'unchanged';
      if (!oldStudent) { changeType = 'new_student'; }
      else {
        processedOldIds.add(student.sisId);
        const oldNum = parseFloat(oldScore || ''); const newNum = parseFloat(newScore || '');
        if (oldScore === null || oldScore === undefined) { changeType = 'new_score'; }
        else if (newScore !== oldScore) {
          if (!isNaN(oldNum) && !isNaN(newNum)) { changeType = newNum > oldNum ? 'increased' : 'decreased'; }
          else { changeType = newScore ? 'increased' : 'removed_score'; }
        }
      }
      diffResults.push({ studentId: student.sisId, studentName: student.name, section: student.section, oldScore, newScore, changed: changeType !== 'unchanged', changeType });
    });
    if (latestSnapshot) {
      latestSnapshot.students.forEach(s => {
        if (s.sisId && !processedOldIds.has(s.sisId)) {
          diffResults.push({ studentId: s.sisId, studentName: s.name, section: s.section, oldScore: s.scores[selectedAssignment] || '', newScore: '', changed: true, changeType: 'removed_student' });
        }
      });
    }
    setDiffs(diffResults);
    setEditedScores({});
    setCurrentStep(3);
  }, [currentData, selectedAssignment, latestSnapshot]);

  const handleScoreEdit = useCallback((studentId: string, value: string) => {
    setEditedScores(prev => ({ ...prev, [studentId]: value }));
    setEditingCell(null);
  }, []);

  const getEffectiveScore = useCallback((diff: GradeDiff) => {
    return editedScores[diff.studentId] !== undefined ? editedScores[diff.studentId] : diff.newScore;
  }, [editedScores]);

  // Build XLSX buffer
  const buildXlsxBuffer = useCallback((): Uint8Array | null => {
    if (!currentData) return null;
    const assignmentInfo = currentData.assignments.find(a => (a.id || a.name) === selectedAssignment);
    const assignmentName = assignmentInfo?.name || selectedAssignment;
    const headers = ['Student', 'ID', 'SIS User ID', 'Section', assignmentName];
    const rows = diffs.filter(d => d.changeType !== 'removed_student').map(d =>
      [d.studentName, d.studentId, d.studentId, d.section, getEffectiveScore(d)]
    );
    return buildXlsx(headers, rows, 'เปรียบเทียบคะแนน');
  }, [currentData, selectedAssignment, diffs, getEffectiveScore]);

  const handleExportCSV = useCallback(() => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    downloadXlsx(buf, `grade_compare_${selectedAssignment}`);
    showToast('ดาวน์โหลด XLSX สำเร็จ', 'success');
  }, [buildXlsxBuffer, selectedAssignment, showToast]);

  const handleSaveSnapshot = useCallback(async () => {
    if (!currentData || !user) return;
    const updatedStudents = currentData.students.map(s => {
      const edited = editedScores[s.sisId];
      if (edited !== undefined) return { ...s, scores: { ...s.scores, [selectedAssignment]: edited } };
      return s;
    });
    try {
      await saveGradeSnapshot(user.uid, { ...currentData, students: updatedStudents });
      showToast('บันทึก snapshot สำเร็จ', 'success');
    } catch {
      showToast('ไม่สามารถบันทึกได้', 'error');
    }
  }, [currentData, user, editedScores, selectedAssignment, showToast]);

  const handleSaveToProject = useCallback(async () => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    setSaving(true);
    try {
      await saveOutput('grade-compare', `เปรียบเทียบคะแนน - ${selectedAssignment}`, buf);
      showToast('บันทึกไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildXlsxBuffer, selectedAssignment, saveOutput, showToast]);

  // Pagination for diff table
  const [diffPage, setDiffPage] = useState(1);
  const [diffPageSize, setDiffPageSize] = useState(25);
  const diffTotalPages = Math.max(1, Math.ceil(diffs.length / diffPageSize));
  const safeDiffPage = Math.min(diffPage, diffTotalPages);
  const paginatedDiffs = useMemo(() => {
    const start = (safeDiffPage - 1) * diffPageSize;
    return diffs.slice(start, start + diffPageSize);
  }, [diffs, safeDiffPage, diffPageSize]);

  // Stats
  const changedCount = diffs.filter(d => d.changed).length;
  const increasedCount = diffs.filter(d => d.changeType === 'increased').length;
  const decreasedCount = diffs.filter(d => d.changeType === 'decreased').length;
  const newStudentCount = diffs.filter(d => d.changeType === 'new_student').length;
  const removedCount = diffs.filter(d => d.changeType === 'removed_student').length;

  const getRowBg = (d: GradeDiff) => {
    switch (d.changeType) {
      case 'increased': return 'bg-green-500/10';
      case 'decreased': return 'bg-red-500/10';
      case 'new_student': return 'bg-yellow-500/10';
      case 'removed_student': return 'bg-gray-500/10';
      case 'new_score': return 'bg-blue-500/10';
      default: return '';
    }
  };

  const getChangeIcon = (d: GradeDiff) => {
    switch (d.changeType) {
      case 'increased': return '↑'; case 'decreased': return '↓';
      case 'new_student': return '🆕'; case 'removed_student': return '🚫';
      case 'new_score': return '✨'; default: return '';
    }
  };

  return (
    <div>
      <ToastContainer />
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text-primary)]">เปรียบเทียบคะแนน</h1>

      <StepWizard steps={STEPS} currentStep={currentStep}>
        {/* Step 1 */}
        <div className="space-y-6">
          <div className="glass-card p-6 space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Canvas Export</h3>
            <FileSelector group="canvas" label="Canvas Export" selectedFileId={selectedFile?.id} onSelect={handleLoadFile} />
            {loadingFile && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังโหลดไฟล์...
              </div>
            )}
            {currentData && (
              <div className="flex items-center gap-3 rounded-lg bg-[var(--color-success)]/10 p-3">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-semibold text-[var(--color-text-primary)]">{selectedFile?.originalFilename}</p>
                  <p className="text-sm text-[var(--color-text-muted)]">{currentData.students.length} นักศึกษา, {currentData.assignments.length} assignments</p>
                </div>
              </div>
            )}
          </div>
          {!loadingCourses && courses.length > 0 && (
            <div>
              <h3 className="mb-3 font-semibold text-[var(--color-text-muted)]">Snapshots ที่บันทึกไว้</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map(c => (
                  <button key={c.courseId} onClick={() => handleSelectCourse(c.courseId)} className="glass-card p-4 text-left transition hover:bg-white/[0.08]">
                    <h4 className="font-semibold text-[var(--color-text-primary)]">{c.courseName}</h4>
                    <p className="text-sm text-[var(--color-text-muted)]">บันทึก: {c.lastSaved.toLocaleDateString('th-TH')} | {c.count} snapshots</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Assignment selection */}
        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold text-[var(--color-text-primary)]">เลือก Assignment</h3>
          {latestSnapshot && <p className="text-sm text-[var(--color-text-muted)]">เปรียบเทียบกับ snapshot: {latestSnapshot.savedAt.toDate().toLocaleDateString('th-TH')}</p>}
          <div className="max-h-60 overflow-y-auto space-y-2 rounded-lg border border-white/10 p-3">
            {currentData?.assignments.map((a, i) => {
              const key = a.id || a.name;
              return (
                <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${selectedAssignment === key ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                  <input type="radio" name="assignment" checked={selectedAssignment === key} onChange={() => setSelectedAssignment(key)} className="accent-[var(--color-accent)]" />
                  <span className="text-sm text-[var(--color-text-primary)]">{a.name}</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setCurrentStep(1)} className="rounded-xl bg-white/5 px-6 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">← ย้อนกลับ</button>
            <button onClick={handleCompare} disabled={!selectedAssignment} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">เปรียบเทียบ</button>
          </div>
        </div>

        {/* Step 3: Diff view */}
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExportCSV} className="rounded-xl bg-[var(--color-success)] px-5 py-2.5 font-semibold text-white transition hover:opacity-90">📥 ดาวน์โหลด XLSX</button>
            <button onClick={handleSaveSnapshot} className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)]">💾 บันทึก Snapshot</button>
            <button onClick={handleSaveToProject} disabled={saving} className="rounded-xl bg-[var(--color-info)] px-5 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              {saving ? '💾 กำลังบันทึก...' : '💾 บันทึกไปโปรเจค'}
            </button>
            <button onClick={() => { setCurrentStep(1); setCurrentData(null); setLatestSnapshot(null); setDiffs([]); setEditedScores({}); setSelectedFile(null); }} className="rounded-xl bg-white/5 px-5 py-2.5 text-[var(--color-text-muted)] transition hover:bg-white/10">🔄 เริ่มใหม่</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-5">
            <StatCard icon="📊" label="เปลี่ยนแปลง" value={changedCount} color="text-[var(--color-warning)]" />
            <StatCard icon="📈" label="เพิ่มขึ้น" value={increasedCount} color="text-[var(--color-success)]" />
            <StatCard icon="📉" label="ลดลง" value={decreasedCount} color="text-[var(--color-danger)]" />
            <StatCard icon="🆕" label="นศ.ใหม่" value={newStudentCount} color="text-[var(--color-info)]" />
            <StatCard icon="🚫" label="นศ.หายไป" value={removedCount} color="text-[var(--color-text-muted)]" />
          </div>

          <div className="table-container rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 sticky top-0 z-10">
                  <th colSpan={3} className="bg-white/5 px-4 py-3 text-center text-[var(--color-text-muted)] border-r border-white/10">
                    {latestSnapshot ? `📅 ${latestSnapshot.savedAt.toDate().toLocaleDateString('th-TH')}` : 'ไม่มีข้อมูลเดิม'}
                  </th>
                  <th colSpan={3} className="bg-white/5 px-4 py-3 text-center text-[var(--color-text-muted)]">📅 ปัจจุบัน</th>
                  <th className="bg-white/5 px-4 py-3"></th>
                </tr>
                <tr className="border-b border-white/10">
                  <th className="bg-white/5 px-3 py-2 text-left text-xs text-[var(--color-text-muted)]">ID</th>
                  <th className="bg-white/5 px-3 py-2 text-left text-xs text-[var(--color-text-muted)]">ชื่อ</th>
                  <th className="bg-white/5 px-3 py-2 text-right text-xs text-[var(--color-text-muted)] border-r border-white/10">คะแนน</th>
                  <th className="bg-white/5 px-3 py-2 text-left text-xs text-[var(--color-text-muted)]">ID</th>
                  <th className="bg-white/5 px-3 py-2 text-left text-xs text-[var(--color-text-muted)]">ชื่อ</th>
                  <th className="bg-white/5 px-3 py-2 text-right text-xs text-[var(--color-text-muted)]">คะแนน</th>
                  <th className="bg-white/5 px-3 py-2 text-center text-xs text-[var(--color-text-muted)]">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDiffs.map((d, idx) => {
                  const effectiveScore = getEffectiveScore(d);
                  const isEdited = editedScores[d.studentId] !== undefined;
                  return (
                    <tr key={idx} className={`border-b border-white/5 ${getRowBg(d)}`}>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] text-xs">{d.changeType !== 'new_student' ? d.studentId : ''}</td>
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">{d.changeType !== 'new_student' ? d.studentName : ''}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] border-r border-white/10">{d.oldScore ?? '-'}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] text-xs">{d.changeType !== 'removed_student' ? d.studentId : ''}</td>
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">{d.changeType !== 'removed_student' ? d.studentName : ''}</td>
                      <td className="px-3 py-2 text-right">
                        {d.changeType !== 'removed_student' ? (
                          editingCell === d.studentId ? (
                            <input type="text" defaultValue={effectiveScore}
                              onBlur={(e) => handleScoreEdit(d.studentId, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleScoreEdit(d.studentId, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditingCell(null); }}
                              autoFocus className="w-16 rounded border border-[var(--color-accent)] bg-transparent px-1 py-0.5 text-right text-[var(--color-text-primary)] outline-none" />
                          ) : (
                            <span onClick={() => setEditingCell(d.studentId)} className={`editable-cell ${isEdited ? 'edited' : ''}`} title="คลิกเพื่อแก้ไข">{effectiveScore || '-'}</span>
                          )
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center text-lg">{getChangeIcon(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Pagination controls */}
            {diffs.length > 25 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5">
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>{((safeDiffPage - 1) * diffPageSize) + 1}–{Math.min(safeDiffPage * diffPageSize, diffs.length)} จาก {diffs.length}</span>
                  <select value={diffPageSize} onChange={(e) => { setDiffPageSize(Number(e.target.value)); setDiffPage(1); }} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--color-text-primary)] outline-none">
                    {[25, 50, 100].map(s => <option key={s} value={s} className="bg-[var(--color-bg-primary)]">{s} แถว</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setDiffPage(p => Math.max(1, p - 1))} disabled={safeDiffPage <= 1} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-white/10 disabled:opacity-30 transition">‹</button>
                  <span className="px-2 text-xs text-[var(--color-text-muted)]">{safeDiffPage} / {diffTotalPages}</span>
                  <button onClick={() => setDiffPage(p => Math.min(diffTotalPages, p + 1))} disabled={safeDiffPage >= diffTotalPages} className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-white/10 disabled:opacity-30 transition">›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </StepWizard>
    </div>
  );
}
