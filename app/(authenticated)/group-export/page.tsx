'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GroupExportRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/courses');
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
    </div>
  );
}
