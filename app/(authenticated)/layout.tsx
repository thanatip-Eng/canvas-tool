'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Navbar from '@/components/layout/Navbar';
import AuthHeader from '@/components/layout/AuthHeader';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, apiKey, canvasUrl, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Project pages have their own navbar and main wrapper via ProjectLayout
  const isProjectRoute = pathname.startsWith('/project/');

  useEffect(() => {
    if (!loading && (!user || !apiKey || !canvasUrl)) {
      router.push('/');
    }
  }, [loading, user, apiKey, canvasUrl, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
      </div>
    );
  }

  if (isProjectRoute) {
    // Project layout handles its own navbar + main wrapper
    return (
      <div className="min-h-screen">
        <AuthHeader />
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AuthHeader />
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
