'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import CourseSelector from '@/components/project/CourseSelector';

export default function CoursesPage() {
  const router = useRouter();

  const handleSelectProject = useCallback((projectId: string) => {
    router.push(`/project/${projectId}`);
  }, [router]);

  return <CourseSelector onSelectProject={handleSelectProject} />;
}
