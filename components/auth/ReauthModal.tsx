'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import CanvasCredsForm from './CanvasCredsForm';

/**
 * Prompts for a fresh Canvas access token without signing the user out.
 * Opens automatically when a Canvas call returns CANVAS_TOKEN_INVALID, or
 * manually from the header. Mounted once in AuthHeader so it covers every page.
 */
export default function ReauthModal() {
  const { needsReauth, canvasUrl, dismissReauth } = useAuth();

  useEffect(() => {
    if (!needsReauth) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissReauth();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [needsReauth, dismissReauth]);

  if (!needsReauth) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismissReauth}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        className="glass-card w-full max-w-md p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="reauth-title"
          className="mb-2 text-xl font-bold text-[var(--color-text-primary)]"
        >
          ตั้งค่า Canvas Access Token
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">
          Token เดิมหมดอายุหรือถูกเพิกถอน สร้าง Token ใหม่จาก Canvas แล้วใส่ด้านล่าง
          ไม่ต้องออกจากระบบ
        </p>

        <CanvasCredsForm
          initialCanvasUrl={canvasUrl}
          submitLabel="บันทึก Token ใหม่"
          onSaved={dismissReauth}
          onCancel={dismissReauth}
        />
      </div>
    </div>
  );
}
