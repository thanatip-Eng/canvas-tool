'use client';

import { useState, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { buildXlsx, downloadXlsx } from '@/lib/xlsx-utils';
import { useToast } from '@/components/ui/Toast';
import { apiGet } from '@/lib/api-client';
import DataTable from '@/components/ui/DataTable';
import StatCard from '@/components/ui/StatCard';
import type { Student, Section, GroupCategory, Group, StudentRow } from '@/types';

export default function ProjectGroupExportPage() {
  const { project, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [groupCategories, setGroupCategories] = useState<GroupCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');
  const [fetched, setFetched] = useState(false);
  const [saving, setSaving] = useState(false);

  const courseId = project?.canvasCourseId;

  // ==================== Fetch Students & Groups ====================

  const fetchStudentsAndGroups = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setStudents([]);
    setGroupCategories([]);

    try {
      // 1. Fetch sections
      setFetchProgress('กำลังดึงข้อมูล Sections...');
      const sectionsData = await apiGet<{ sections?: Section[] }>('/api/canvas/sections', { courseId: String(courseId) });
      const sections: Section[] = sectionsData.sections || [];
      const sectionMap = new Map(sections.map((s) => [s.id, s.name]));

      // 2. Fetch students
      setFetchProgress('กำลังดึงข้อมูลนักศึกษา...');
      const studentsData = await apiGet<{ students?: Student[] }>('/api/canvas/students', { courseId: String(courseId) });
      const rawStudents: Student[] = studentsData.students || [];

      // 3. Fetch group categories
      setFetchProgress('กำลังดึงข้อมูลหมวดหมู่กลุ่ม...');
      const categoriesData = await apiGet<{ categories?: GroupCategory[] }>('/api/canvas/group-categories', { courseId: String(courseId) });
      const categories: GroupCategory[] = categoriesData.categories || [];
      setGroupCategories(categories);

      // 4. Fetch groups for each category
      const categoryGroupMap = new Map<number, Group[]>();
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        setFetchProgress(
          `กำลังดึงกลุ่มในหมวด "${category.name}" (${i + 1}/${categories.length})...`
        );
        const groupsData = await apiGet<{ groups?: Group[] }>('/api/canvas/groups', { categoryId: String(category.id) });
        categoryGroupMap.set(category.id, groupsData.groups || []);
      }

      // 5. Fetch members for each group
      const userGroupMap = new Map<number, Map<number, string>>();
      const allGroups = Array.from(categoryGroupMap.entries());
      let groupIndex = 0;
      const totalGroups = allGroups.reduce((sum, [, groups]) => sum + groups.length, 0);

      for (const [categoryId, groups] of allGroups) {
        for (const group of groups) {
          groupIndex++;
          setFetchProgress(
            `กำลังดึงสมาชิกกลุ่ม "${group.name}" (${groupIndex}/${totalGroups})...`
          );
          const membersData = await apiGet<{ members?: Array<{ user_id: number }> }>(
            '/api/canvas/group-members',
            { groupId: String(group.id) }
          );
          const members: Array<{ user_id: number }> = membersData.members || [];

          for (const member of members) {
            if (!userGroupMap.has(member.user_id)) {
              userGroupMap.set(member.user_id, new Map());
            }
            userGroupMap.get(member.user_id)!.set(categoryId, group.name);
          }
        }
      }

      // 6. Build student rows
      const studentRows: StudentRow[] = rawStudents.map((student) => {
        const enrollment = student.enrollments?.find(
          (e) => (e as unknown as { type: string }).type === 'StudentEnrollment'
        );
        const sectionName = enrollment ? sectionMap.get(enrollment.course_section_id) || '' : '';

        const groups: Record<string, string> = {};
        for (const category of categories) {
          const userGroups = userGroupMap.get(student.id);
          groups[category.name] = userGroups?.get(category.id) || '';
        }

        return {
          name: student.name,
          sortable_name: student.sortable_name,
          id: student.id,
          sis_user_id: student.sis_user_id || '',
          login_id: student.login_id || '',
          integration_id: student.integration_id || '',
          section: sectionName,
          groups,
        };
      });

      setStudents(studentRows);
      setFetched(true);
      showToast(
        `โหลดข้อมูลสำเร็จ: ${studentRows.length} นักศึกษา, ${categories.length} หมวดหมู่กลุ่ม`,
        'success'
      );
    } catch {
      showToast('ไม่สามารถดึงข้อมูลนักศึกษาและกลุ่มได้', 'error');
    } finally {
      setLoading(false);
      setFetchProgress('');
    }
  }, [courseId, showToast]);

  // ==================== Build XLSX ====================

  const buildXlsxBuffer = useCallback((): Uint8Array | null => {
    if (students.length === 0) return null;
    const headers = [
      'Student',
      'ID',
      'SIS User ID',
      'SIS Login ID',
      'Integration ID',
      'Section',
      ...groupCategories.map(cat => cat.name),
    ];

    const rows = students.map((student) => [
      student.name,
      String(student.id),
      student.sis_user_id,
      student.login_id,
      student.integration_id,
      student.section,
      ...groupCategories.map(cat => student.groups[cat.name] || ''),
    ]);

    return buildXlsx(headers, rows, 'กลุ่มนักศึกษา');
  }, [students, groupCategories]);

  // ==================== Export XLSX ====================

  const exportCSV = useCallback(() => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    const prefix = project?.courseName || 'students_groups';
    downloadXlsx(buf, prefix);
    showToast('ส่งออก XLSX สำเร็จ', 'success');
  }, [buildXlsxBuffer, project, showToast]);

  // ==================== Save to Project ====================

  const saveToProject = useCallback(async () => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    setSaving(true);
    try {
      const stats: Record<string, number> = {
        students: students.length,
        categories: groupCategories.length,
      };
      await saveOutput(
        'group-export',
        `กลุ่มนักศึกษา (${groupCategories.map((c) => c.name).join(', ') || 'ไม่มีกลุ่ม'})`,
        buf,
        stats
      );
      showToast('บันทึกผลลัพธ์ไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('ไม่สามารถบันทึกผลลัพธ์ได้', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildXlsxBuffer, students.length, groupCategories, saveOutput, showToast]);

  // ==================== Statistics ====================

  const getStatistics = useCallback(() => {
    if (students.length === 0) return null;

    const sectionsSet = new Set<string>();
    const ungroupedCounts: Record<string, number> = {};

    for (const cat of groupCategories) {
      ungroupedCounts[cat.name] = 0;
    }

    for (const student of students) {
      if (student.section) sectionsSet.add(student.section);
      for (const cat of groupCategories) {
        if (!student.groups[cat.name]) {
          ungroupedCounts[cat.name]++;
        }
      }
    }

    return {
      totalStudents: students.length,
      totalSections: sectionsSet.size,
      totalCategories: groupCategories.length,
      ungroupedCounts,
    };
  }, [students, groupCategories]);

  // ==================== Table Data ====================

  const tableHeaders = [
    'Student',
    'ID',
    'SIS User ID',
    'Section',
    ...groupCategories.map((cat) => cat.name),
  ];

  const tableRows = students.map((student) => [
    student.name,
    String(student.id),
    student.sis_user_id,
    student.section,
    ...groupCategories.map((cat) => {
      const groupName = student.groups[cat.name];
      return groupName ? (
        <span className="rounded-md bg-[var(--color-accent)]/15 px-2 py-0.5 text-xs text-[var(--color-accent)]">
          {groupName}
        </span>
      ) : (
        <span className="text-[var(--color-text-muted)]">-</span>
      );
    }),
  ]);

  const stats = getStatistics();

  // ==================== Render ====================

  if (!project) return null;

  return (
    <div>
      <ToastContainer />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          ส่งออกกลุ่มนักศึกษา
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          ดึงข้อมูลนักศึกษาและกลุ่มจาก Canvas แล้วส่งออกเป็น XLSX
        </p>
      </div>

      {/* Initial fetch state */}
      {!fetched && !loading && (
        <div className="glass-card flex flex-col items-center gap-4 p-8 text-center">
          <div className="text-5xl">👥</div>
          <p className="text-[var(--color-text-muted)]">
            คลิกเพื่อดึงข้อมูลนักศึกษาและกลุ่มจาก Canvas
          </p>
          <button
            onClick={fetchStudentsAndGroups}
            className="rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-8 py-3 font-medium text-white transition hover:from-purple-600 hover:to-pink-600"
          >
            ดึงข้อมูล
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="glass-card flex flex-col items-center gap-4 p-12 text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
          <p className="text-[var(--color-text-muted)]">
            {fetchProgress || 'กำลังดึงข้อมูล...'}
          </p>
        </div>
      )}

      {/* Data loaded */}
      {fetched && !loading && students.length > 0 && (
        <div className="space-y-6">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-end">
            <button
              onClick={saveToProject}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-2.5 text-sm font-medium text-white transition hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  กำลังบันทึก...
                </span>
              ) : (
                <>💾 บันทึกไปโปรเจค</>
              )}
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-2.5 text-sm font-medium text-white transition hover:from-green-600 hover:to-emerald-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export XLSX
            </button>
          </div>

          {/* Statistics */}
          {stats && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon="👥" label="นักศึกษาทั้งหมด" value={stats.totalStudents} />
              <StatCard icon="📚" label="Sections" value={stats.totalSections} />
              <StatCard icon="🏷️" label="หมวดหมู่กลุ่ม" value={stats.totalCategories} />
              {groupCategories.map((cat) => (
                <StatCard
                  key={cat.id}
                  icon="⚠️"
                  label={`ยังไม่มีกลุ่ม (${cat.name})`}
                  value={stats.ungroupedCounts[cat.name] || 0}
                  color={
                    (stats.ungroupedCounts[cat.name] || 0) > 0
                      ? 'text-[var(--color-warning)]'
                      : 'text-[var(--color-success)]'
                  }
                />
              ))}
            </div>
          )}

          {/* Data table */}
          <DataTable headers={tableHeaders} rows={tableRows} paginate filterable />
        </div>
      )}

      {/* No students */}
      {fetched && !loading && students.length === 0 && (
        <div className="glass-card py-12 text-center text-[var(--color-text-muted)]">
          ไม่พบข้อมูลนักศึกษาในรายวิชานี้
        </div>
      )}
    </div>
  );
}
