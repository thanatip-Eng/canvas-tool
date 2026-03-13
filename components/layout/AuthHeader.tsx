'use client';

import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';

export default function AuthHeader() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
      <h1 className="text-lg font-bold bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-info)] bg-clip-text text-transparent">
        Canvas Tools
      </h1>
      <div className="flex items-center gap-3">
        {user.photoURL && (
          <Image
            src={user.photoURL}
            alt={user.displayName || 'User'}
            width={32}
            height={32}
            className="rounded-full"
          />
        )}
        <span className="text-sm text-[var(--color-text-muted)]">
          {user.displayName || user.email}
        </span>
        <button
          onClick={logout}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-danger)]"
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
