'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { getUserProjects, createProject, getProjectId } from '@/lib/project-service';
import { apiGet } from '@/lib/api-client';
import type { Course, Project } from '@/types';

interface CourseSelectorProps {
  onSelectProject: (projectId: string) => void;
}

export default function CourseSelector({ onSelectProject }: CourseSelectorProps) {
  const { user } = useAuth();
  const { showToast, ToastContainer } = useToast();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [coursesFetched, setCoursesFetched] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');
  const [projects, setProjects] = useState<Map<number, Project>>(new Map());
  const [creatingProjectFor, setCreatingProjectFor] = useState<number | null>(null);

  // Load existing projects
  const loadProjects = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const userProjects = await getUserProjects(user.uid);
      const projectMap = new Map<number, Project>();
      for (const p of userProjects) {
        projectMap.set(p.canvasCourseId, p);
      }
      setProjects(projectMap);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const fetchCourses = useCallback(async () => {
    setLoadingCourses(true);
    try {
      const data = await apiGet<{ courses?: Course[] }>('/api/canvas/courses');
      setCourses(data.courses || []);
      setCoursesFetched(true);
      if ((data.courses || []).length === 0) {
        showToast('ไม่พบรายวิชา กรุณาตรวจสอบ API Key', 'warning');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'ไม่สามารถดึงรายวิชาได้ กรุณาตรวจสอบ API Key และ URL',
        'error'
      );
    } finally {
      setLoadingCourses(false);
    }
  }, [showToast]);

  // Select a course — create project if needed, then navigate
  const handleSelectCourse = useCallback(async (course: Course) => {
    if (!user?.uid) return;
    const existingProject = projects.get(course.id);
    if (existingProject) {
      onSelectProject(existingProject.id);
      return;
    }

    // Create new project
    setCreatingProjectFor(course.id);
    try {
      const project = await createProject(user.uid, course);
      onSelectProject(project.id);
    } catch (error) {
      console.error('Error creating project:', error);
      showToast('ไม่สามารถสร้างโปรเจคได้', 'error');
    } finally {
      setCreatingProjectFor(null);
    }
  }, [user?.uid, projects, onSelectProject, showToast]);

  // Filtered courses
  const filteredCourses = courseSearch
    ? courses.filter(
        (c) =>
          c.name.toLowerCase().includes(courseSearch.toLowerCase()) ||
          c.course_code.toLowerCase().includes(courseSearch.toLowerCase())
      )
    : courses;

  // Format date for project badge
  const formatDate = (timestamp: { seconds: number }) => {
    const date = new Date(timestamp.seconds * 1000);
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  return (
    <div>
      <ToastContainer />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          เลือกรายวิชา
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          เลือกรายวิชาที่ต้องการจัดการ — จะสร้างโปรเจคสำหรับเก็บไฟล์และผลลัพธ์
        </p>
      </div>

      {/* Fetch courses button (before fetching) */}
      {!coursesFetched && (
        <div className="glass-card flex flex-col items-center gap-4 p-8 text-center">
          <div className="text-5xl">📚</div>
          <p className="text-[var(--color-text-muted)]">
            คลิกเพื่อดึงรายวิชาที่กำลังสอนจาก Canvas
          </p>
          <button
            onClick={fetchCourses}
            disabled={loadingCourses}
            className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-8 py-3 font-medium text-white transition hover:from-teal-600 hover:to-cyan-600 disabled:opacity-50"
          >
            {loadingCourses ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                กำลังโหลด...
              </span>
            ) : (
              'ดึงรายวิชา'
            )}
          </button>
        </div>
      )}

      {/* Course search + grid */}
      {coursesFetched && (
        <div className="space-y-6">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--color-text-muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              placeholder="ค้นหารายวิชา..."
              className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-3 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]"
            />
          </div>

          {/* Course grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCourses.map((course) => {
              const existingProject = projects.get(course.id);
              const isCreating = creatingProjectFor === course.id;
              return (
                <button
                  key={course.id}
                  onClick={() => handleSelectCourse(course)}
                  disabled={isCreating}
                  className="glass-card group relative p-4 text-left transition hover:border-[var(--color-border-medium)] hover:bg-[var(--color-surface-hover)] disabled:opacity-70"
                >
                  {/* Project badge */}
                  {existingProject && (
                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                      {formatDate(existingProject.updatedAt as unknown as { seconds: number })}
                    </div>
                  )}

                  <h3 className="pr-20 font-medium text-[var(--color-text-primary)] transition group-hover:text-[var(--color-accent)]">
                    {course.name}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {course.course_code}
                  </p>

                  {isCreating && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-accent)]">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                      กำลังสร้างโปรเจค...
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {filteredCourses.length === 0 && (
            <div className="py-12 text-center text-[var(--color-text-muted)]">
              {courseSearch ? 'ไม่พบรายวิชาที่ค้นหา' : 'ไม่พบรายวิชา'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
