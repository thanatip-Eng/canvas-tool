'use client';

import { use } from 'react';
import { ProjectProvider, useProject } from '@/contexts/ProjectContext';
import ProjectNavbar from '@/components/layout/ProjectNavbar';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

function ProjectContent({ children }: { children: React.ReactNode }) {
  const { project, loading } = useProject();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">กำลังโหลดโปรเจค...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-[var(--color-danger)]">ไม่พบโปรเจค</p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">โปรเจคนี้อาจถูกลบไปแล้ว</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ProjectNavbar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </>
  );
}

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return (
    <ProjectProvider projectId={projectId}>
      <ProjectContent>{children}</ProjectContent>
    </ProjectProvider>
  );
}
