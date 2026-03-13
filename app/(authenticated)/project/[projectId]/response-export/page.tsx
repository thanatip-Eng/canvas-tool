'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProject } from '@/contexts/ProjectContext';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsx, buildXlsxMultiSheet, downloadXlsx } from '@/lib/xlsx-utils';
import { stripHtml } from '@/lib/html-utils';
import type { Quiz, Assignment, Section } from '@/types';

interface StudentInfo {
  name: string;
  id: number;
  sisUserId: string;
  sisLoginId: string;
  integrationId: string;
  section: string;
}

interface ItemResponse {
  itemId: number;
  itemName: string;
  itemType: string;
  questions: string[];
  studentResponses: Map<number, string[]>;
}

export default function ProjectResponseExportPage() {
  const { apiKey, canvasUrl } = useAuth();
  const { project, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();

  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedQuizzes, setSelectedQuizzes] = useState<number[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<number[]>([]);
  const [itemResponses, setItemResponses] = useState<ItemResponse[]>([]);
  const [studentInfoMap, setStudentInfoMap] = useState<Map<number, StudentInfo>>(new Map());
  const [saving, setSaving] = useState(false);

  const courseId = project?.canvasCourseId;
  const apiParams = `apiKey=${encodeURIComponent(apiKey)}&canvasUrl=${encodeURIComponent(canvasUrl)}`;

  // Fetch quizzes & assignments on mount
  useEffect(() => {
    if (!courseId) return;

    const fetchItems = async () => {
      setLoadingItems(true);
      try {
        const [sectionsRes, quizzesRes, assignmentsRes] = await Promise.all([
          fetch(`/api/canvas/sections?${apiParams}&courseId=${courseId}`),
          fetch(`/api/canvas/quizzes?${apiParams}&courseId=${courseId}`),
          fetch(`/api/canvas/assignments?${apiParams}&courseId=${courseId}`),
        ]);
        const sectionsData = await sectionsRes.json();
        const quizzesData = await quizzesRes.json();
        const assignmentsData = await assignmentsRes.json();

        setSections(sectionsData.sections || []);
        setQuizzes(quizzesData.quizzes || []);
        setAssignments(assignmentsData.assignments || []);
      } catch {
        showToast('ไม่สามารถดึงข้อมูล Quiz/Assignment ได้', 'error');
      } finally {
        setLoadingItems(false);
      }
    };

    fetchItems();
  }, [courseId, apiParams, showToast]);

  // Fetch responses for selected items
  const fetchResponses = useCallback(async () => {
    if (selectedQuizzes.length === 0 && selectedAssignments.length === 0) {
      showToast('กรุณาเลือก Quiz หรือ Assignment อย่างน้อย 1 รายการ', 'error');
      return;
    }
    if (!courseId) return;

    setLoadingResponses(true);
    setFetchProgress('กำลังดึงข้อมูลนักศึกษา...');

    try {
      // Fetch students
      const studentsRes = await fetch(
        `/api/canvas/students?${apiParams}&courseId=${courseId}`
      );
      const studentsData = await studentsRes.json();
      const rawStudents = studentsData.students || [];

      const sectionMap = new Map(sections.map((s) => [s.id, s.name]));
      const newStudentInfoMap = new Map<number, StudentInfo>();
      rawStudents.forEach((student: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
        const enrollment = student.enrollments?.find(
          (e: any) => e.type === 'StudentEnrollment'  // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        newStudentInfoMap.set(student.id, {
          name: student.name,
          id: student.id,
          sisUserId: student.sis_user_id || '',
          sisLoginId: student.login_id || '',
          integrationId: student.integration_id || '',
          section: enrollment ? sectionMap.get(enrollment.course_section_id) || '' : '',
        });
      });
      setStudentInfoMap(newStudentInfoMap);

      const allItemResponses: ItemResponse[] = [];

      // Fetch quiz responses
      for (let i = 0; i < selectedQuizzes.length; i++) {
        const quizId = selectedQuizzes[i];
        const quiz = quizzes.find((q) => q.id === quizId);
        if (!quiz) continue;

        setFetchProgress(
          `กำลังดึงคำตอบ Quiz: ${quiz.title} (${i + 1}/${selectedQuizzes.length})`
        );

        const res = await fetch(
          `/api/canvas/quiz-submissions?${apiParams}&courseId=${courseId}&quizId=${quizId}`
        );
        const data = await res.json();
        const submissions = data.submissions || [];
        const questions = data.questions || [];

        let targetQuestions = questions.filter((q: any) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
          ['essay_question', 'short_answer_question', 'text_only_question'].includes(
            q.question_type
          )
        );
        if (targetQuestions.length === 0) targetQuestions = questions;

        const questionNames = targetQuestions.map(
          (q: any, idx: number) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
            stripHtml(q.question_name || q.question_text || `Q${idx + 1}`).substring(0, 100)
        );

        const studentResponses = new Map<number, string[]>();
        submissions.forEach((sub: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
          const answers: string[] = targetQuestions.map((q: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
            let text = '';
            if (sub.submission_history?.length > 0) {
              const last = sub.submission_history[sub.submission_history.length - 1];
              const ans = last.submission_data?.find(
                (a: any) => a.question_id === q.id || a.id === q.id  // eslint-disable-line @typescript-eslint/no-explicit-any
              );
              if (ans) text = ans.text || ans.answer || '';
            }
            if (!text && sub.answers) {
              const ans = sub.answers.find(
                (a: any) => a.question_id === q.id || a.id === q.id  // eslint-disable-line @typescript-eslint/no-explicit-any
              );
              if (ans) text = ans.text || ans.answer || '';
            }
            return stripHtml(text);
          });
          studentResponses.set(sub.user_id, answers);
        });

        allItemResponses.push({
          itemId: quizId,
          itemName: quiz.title,
          itemType: 'quiz',
          questions: questionNames,
          studentResponses,
        });
      }

      // Fetch assignment responses
      for (let i = 0; i < selectedAssignments.length; i++) {
        const assignmentId = selectedAssignments[i];
        const assignment = assignments.find((a) => a.id === assignmentId);
        if (!assignment) continue;

        setFetchProgress(
          `กำลังดึงคำตอบ Assignment: ${assignment.name} (${i + 1}/${selectedAssignments.length})`
        );

        const isNewQuiz =
          assignment.is_quiz_lti_assignment ||
          assignment.external_tool_tag_attributes?.url?.includes('quiz-lti');

        if (isNewQuiz) {
          const res = await fetch(
            `/api/canvas/new-quiz-submissions?${apiParams}&courseId=${courseId}&assignmentId=${assignmentId}`
          );
          const data = await res.json();

          if (data.items?.length > 0) {
            const items = data.items;
            const subs = data.submissions || [];
            const qNames = items.map(
              (item: any, idx: number) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
                stripHtml(
                  item.entry?.item_body ||
                    item.item_body ||
                    item.entry?.title ||
                    item.title ||
                    `Q${idx + 1}`
                ).substring(0, 100)
            );
            const hasAnswers = subs.some((s: any) => s.answers?.length > 0);  // eslint-disable-line @typescript-eslint/no-explicit-any
            const studentResponses = new Map<number, string[]>();

            if (hasAnswers) {
              subs.forEach((sub: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                const answers = items.map((item: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                  const itemId = item.id || item.entry?.id;
                  const ans = (sub.answers || []).find(
                    (a: any) => a.item_id === itemId || a.question_id === itemId  // eslint-disable-line @typescript-eslint/no-explicit-any
                  );
                  return stripHtml(ans?.response || ans?.text || ans?.answer || '');
                });
                studentResponses.set(sub.user_id, answers);
              });
              allItemResponses.push({
                itemId: assignmentId,
                itemName: `${assignment.name} (New Quiz)`,
                itemType: 'assignment',
                questions: qNames,
                studentResponses,
              });
            } else {
              subs
                .filter((s: any) => s.workflow_state === 'graded' || s.submitted_at)  // eslint-disable-line @typescript-eslint/no-explicit-any
                .forEach((sub: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                  studentResponses.set(sub.user_id, [
                    [sub.score != null ? `${sub.score}` : '-', sub.workflow_state || '']
                      .filter(Boolean)
                      .join(' | '),
                  ]);
                });
              allItemResponses.push({
                itemId: assignmentId,
                itemName: `${assignment.name} (New Quiz - สถานะ)`,
                itemType: 'assignment',
                questions: ['สถานะ'],
                studentResponses,
              });
              showToast(
                `"${assignment.name}": แสดงเฉพาะคะแนน/สถานะ (API จำกัดการเข้าถึง New Quiz)`,
                'warning'
              );
            }
          } else {
            allItemResponses.push({
              itemId: assignmentId,
              itemName: `${assignment.name} (ไม่สามารถดึงได้)`,
              itemType: 'assignment',
              questions: ['หมายเหตุ'],
              studentResponses: new Map(),
            });
          }
        } else {
          // Regular assignment
          const res = await fetch(
            `/api/canvas/assignment-submissions?${apiParams}&courseId=${courseId}&assignmentId=${assignmentId}`
          );
          const data = await res.json();
          const subs = data.submissions || [];
          const studentResponses = new Map<number, string[]>();

          subs.forEach((sub: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
            let text = '';
            if (sub.body) text = stripHtml(sub.body);
            else if (sub.attachments?.length > 0)
              text = `[ไฟล์แนบ: ${sub.attachments.map((a: any) => a.filename).join(', ')}]`;  // eslint-disable-line @typescript-eslint/no-explicit-any
            else if (sub.url)
              text = sub.url.includes('quiz-lti') ? '[New Quiz]' : `[URL: ${sub.url}]`;
            studentResponses.set(sub.user_id, [text]);
          });

          allItemResponses.push({
            itemId: assignmentId,
            itemName: assignment.name,
            itemType: 'assignment',
            questions: ['คำตอบ'],
            studentResponses,
          });
        }
      }

      setItemResponses(allItemResponses);
      setFetchProgress('');
      showToast(`ดึงข้อมูลสำเร็จ: ${allItemResponses.length} รายการ`, 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการดึงข้อมูล', 'error');
    } finally {
      setLoadingResponses(false);
      setFetchProgress('');
    }
  }, [
    selectedQuizzes,
    selectedAssignments,
    courseId,
    quizzes,
    assignments,
    sections,
    apiParams,
    showToast,
  ]);

  // Build XLSX buffer for a single item
  const buildItemXlsx = useCallback(
    (item: ItemResponse): Uint8Array => {
      const headers = [
        'Student',
        'ID',
        'SIS User ID',
        'SIS Login ID',
        'Integration ID',
        'Section',
        ...item.questions,
      ];
      const rows: string[][] = [];
      studentInfoMap.forEach((student, studentId) => {
        const answers = item.studentResponses.get(studentId) || item.questions.map(() => '');
        rows.push([
          student.name,
          student.id.toString(),
          student.sisUserId,
          student.sisLoginId,
          student.integrationId,
          student.section,
          ...answers,
        ]);
      });
      return buildXlsx(headers, rows, item.itemName.substring(0, 31));
    },
    [studentInfoMap]
  );

  // Export single item XLSX
  const exportItemCSV = useCallback(
    (item: ItemResponse) => {
      const buf = buildItemXlsx(item);
      const safeName = item.itemName
        .replace(/[^a-zA-Z0-9\u0E00-\u0E7F]/g, '_')
        .substring(0, 50);
      downloadXlsx(buf, `${project?.courseName || 'course'}_${safeName}`);
    },
    [buildItemXlsx, project]
  );

  // Build combined XLSX with multi-sheet (one sheet per item)
  const buildCombinedXlsx = useCallback((): Uint8Array | null => {
    if (itemResponses.length === 0) return null;

    // If only one item, use single sheet
    if (itemResponses.length === 1) {
      return buildItemXlsx(itemResponses[0]);
    }

    // Multi-sheet: one combined sheet + individual sheets
    const allColumns: string[] = [];
    itemResponses.forEach((item) => {
      item.questions.forEach((q) => {
        allColumns.push(item.questions.length > 1 ? `${item.itemName} - ${q}` : item.itemName);
      });
    });
    const combinedHeaders = [
      'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
      ...allColumns,
    ];
    const combinedRows: string[][] = [];
    studentInfoMap.forEach((student, studentId) => {
      const allAnswers: string[] = [];
      itemResponses.forEach((item) => {
        allAnswers.push(
          ...(item.studentResponses.get(studentId) || item.questions.map(() => ''))
        );
      });
      combinedRows.push([
        student.name, student.id.toString(), student.sisUserId,
        student.sisLoginId, student.integrationId, student.section,
        ...allAnswers,
      ]);
    });

    const sheets = [
      { name: 'รวมทั้งหมด', headers: combinedHeaders, rows: combinedRows },
      ...itemResponses.map((item) => {
        const itemHeaders = [
          'Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section',
          ...item.questions,
        ];
        const itemRows: string[][] = [];
        studentInfoMap.forEach((student, studentId) => {
          const answers = item.studentResponses.get(studentId) || item.questions.map(() => '');
          itemRows.push([
            student.name, student.id.toString(), student.sisUserId,
            student.sisLoginId, student.integrationId, student.section,
            ...answers,
          ]);
        });
        return { name: item.itemName.substring(0, 31), headers: itemHeaders, rows: itemRows };
      }),
    ];

    return buildXlsxMultiSheet(sheets);
  }, [itemResponses, studentInfoMap, buildItemXlsx]);

  // Export combined XLSX
  const exportCombinedCSV = useCallback(() => {
    const buf = buildCombinedXlsx();
    if (!buf) return;
    downloadXlsx(buf, `${project?.courseName || 'course'}_all_responses`);
  }, [buildCombinedXlsx, project]);

  // Save combined to project
  const saveCombinedToProject = useCallback(async () => {
    if (itemResponses.length === 0) return;
    setSaving(true);
    try {
      const buf = buildCombinedXlsx();
      if (!buf) return;
      const stats: Record<string, number> = {
        items: itemResponses.length,
        students: studentInfoMap.size,
        responses: itemResponses.reduce((sum, item) => sum + item.studentResponses.size, 0),
      };
      await saveOutput(
        'response-export',
        `คำตอบ (${itemResponses.map((i) => i.itemName).join(', ').substring(0, 100)})`,
        buf,
        stats
      );
      showToast('บันทึกผลลัพธ์ไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('ไม่สามารถบันทึกผลลัพธ์ได้', 'error');
    } finally {
      setSaving(false);
    }
  }, [itemResponses, studentInfoMap, buildCombinedXlsx, saveOutput, showToast]);

  // Save single item to project
  const saveItemToProject = useCallback(
    async (item: ItemResponse) => {
      setSaving(true);
      try {
        const buf = buildItemXlsx(item);
        const stats: Record<string, number> = {
          students: studentInfoMap.size,
          responses: item.studentResponses.size,
          questions: item.questions.length,
        };
        const safeName = item.itemName.substring(0, 80);
        await saveOutput('response-export', `คำตอบ: ${safeName}`, buf, stats);
        showToast(`บันทึก "${safeName}" ไปโปรเจคสำเร็จ`, 'success');
      } catch {
        showToast('ไม่สามารถบันทึกผลลัพธ์ได้', 'error');
      } finally {
        setSaving(false);
      }
    },
    [buildItemXlsx, studentInfoMap, saveOutput, showToast]
  );

  if (!project) return null;

  // ==================== Render ====================

  return (
    <div>
      <ToastContainer />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">ส่งออกคำตอบ</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          ดึงคำตอบจาก Quiz และ Assignment แล้วส่งออกเป็น XLSX
        </p>
      </div>

      {loadingItems ? (
        <div className="py-12 text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
          <p className="mt-3 text-[var(--color-text-muted)]">
            กำลังโหลด Quiz และ Assignment...
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Quiz selection */}
          {quizzes.length > 0 && (
            <div className="glass-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  Quiz ({quizzes.length})
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedQuizzes(quizzes.map(q => q.id))}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 transition"
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    onClick={() => setSelectedQuizzes([])}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] bg-white/5 hover:bg-white/10 transition"
                  >
                    ยกเลิกทั้งหมด
                  </button>
                  <span className="text-xs text-[var(--color-text-muted)]">({selectedQuizzes.length}/{quizzes.length})</span>
                </div>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {quizzes.map((q) => (
                  <label
                    key={q.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${
                      selectedQuizzes.includes(q.id)
                        ? 'bg-[var(--color-accent)]/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedQuizzes.includes(q.id)}
                      onChange={() =>
                        setSelectedQuizzes((prev) =>
                          prev.includes(q.id)
                            ? prev.filter((id) => id !== q.id)
                            : [...prev, q.id]
                        )
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">{q.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Assignment selection */}
          {assignments.length > 0 && (
            <div className="glass-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-[var(--color-text-primary)]">
                  Assignment ({assignments.length})
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedAssignments(assignments.map(a => a.id))}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 transition"
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    onClick={() => setSelectedAssignments([])}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] bg-white/5 hover:bg-white/10 transition"
                  >
                    ยกเลิกทั้งหมด
                  </button>
                  <span className="text-xs text-[var(--color-text-muted)]">({selectedAssignments.length}/{assignments.length})</span>
                </div>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {assignments.map((a) => (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${
                      selectedAssignments.includes(a.id)
                        ? 'bg-[var(--color-accent)]/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAssignments.includes(a.id)}
                      onChange={() =>
                        setSelectedAssignments((prev) =>
                          prev.includes(a.id)
                            ? prev.filter((id) => id !== a.id)
                            : [...prev, a.id]
                        )
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">{a.name}</span>
                    {a.is_new_quiz && (
                      <span className="rounded bg-[var(--color-warning)]/20 px-2 py-0.5 text-xs text-[var(--color-warning)]">
                        New Quiz
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* No items */}
          {quizzes.length === 0 && assignments.length === 0 && (
            <div className="glass-card py-12 text-center text-[var(--color-text-muted)]">
              ไม่พบ Quiz หรือ Assignment ในรายวิชานี้
            </div>
          )}

          {/* Fetch button */}
          {(quizzes.length > 0 || assignments.length > 0) && (
            <button
              onClick={fetchResponses}
              disabled={
                loadingResponses ||
                (selectedQuizzes.length === 0 && selectedAssignments.length === 0)
              }
              className="rounded-xl bg-[var(--color-accent)] px-6 py-3 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
            >
              {loadingResponses
                ? fetchProgress || 'กำลังดึงข้อมูล...'
                : `ดึงคำตอบ (${selectedQuizzes.length + selectedAssignments.length} รายการ)`}
            </button>
          )}

          {/* Results */}
          {itemResponses.length > 0 && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={saveCombinedToProject}
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 font-semibold text-white transition hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึกรวมไปโปรเจค'}
                </button>
                <button
                  onClick={exportCombinedCSV}
                  className="rounded-xl bg-[var(--color-success)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90"
                >
                  📥 ดาวน์โหลดรวม XLSX
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard icon="📋" label="รายการทั้งหมด" value={itemResponses.length} />
                <StatCard icon="👥" label="นักศึกษา" value={studentInfoMap.size} />
                <StatCard
                  icon="📝"
                  label="คำตอบรวม"
                  value={itemResponses.reduce(
                    (sum, item) => sum + item.studentResponses.size,
                    0
                  )}
                />
              </div>

              {itemResponses.map((item, idx) => (
                <div key={idx} className="glass-card p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="font-semibold text-[var(--color-text-primary)]">
                      {item.itemName}
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveItemToProject(item)}
                        disabled={saving}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-white/10 disabled:opacity-50"
                      >
                        💾 บันทึก
                      </button>
                      <button
                        onClick={() => exportItemCSV(item)}
                        className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-white/10"
                      >
                        📥 Export
                      </button>
                    </div>
                  </div>
                  <p className="mb-3 text-sm text-[var(--color-text-muted)]">
                    {item.studentResponses.size} คำตอบ | {item.questions.length} คำถาม
                  </p>
                  <DataTable
                    headers={['ชื่อ', 'Section', ...item.questions]}
                    rows={Array.from(studentInfoMap.entries())
                      .map(([studentId, student]) => {
                        const answers =
                          item.studentResponses.get(studentId) ||
                          item.questions.map(() => '');
                        return [
                          student.name,
                          student.section,
                          ...answers.map(
                            (a) => a.substring(0, 80) + (a.length > 80 ? '...' : '')
                          ),
                        ];
                      })}
                    paginate
                    filterable
                    defaultPageSize={30}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
