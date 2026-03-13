'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const { user, apiKey, canvasUrl, loading, firebaseReady, login, saveApiKey } = useAuth();
  const router = useRouter();
  const [inputApiKey, setInputApiKey] = useState('');
  const [inputCanvasUrl, setInputCanvasUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Redirect to courses if fully authenticated
  useEffect(() => {
    if (!loading && user && apiKey && canvasUrl) {
      router.push('/courses');
    }
  }, [loading, user, apiKey, canvasUrl, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
          <p className="mt-4 text-[var(--color-text-muted)]">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  // Step 1: Google Login
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="glass-card w-full max-w-md p-8 text-center">
          <div className="mb-6">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-info)] bg-clip-text text-transparent">
              Canvas Tools
            </h1>
            <p className="mt-2 text-[var(--color-text-muted)]">
              เครื่องมือจัดการข้อมูล Canvas LMS สำหรับอาจารย์
            </p>
          </div>

          <div className="mb-8 space-y-3 text-left text-sm text-[var(--color-text-muted)]">
            <div className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-lg">📊</span>
              <div><strong className="text-[var(--color-text-primary)]">Map คะแนน</strong> — จับคู่คะแนนจากไฟล์ภายนอกกับ Canvas</div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-lg">🔍</span>
              <div><strong className="text-[var(--color-text-primary)]">ตรวจสอบสถานะ</strong> — เปรียบเทียบรายชื่อ Canvas กับทะเบียน</div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-lg">👥</span>
              <div><strong className="text-[var(--color-text-primary)]">ส่งออกกลุ่ม</strong> — ส่งออกรายชื่อนักศึกษาพร้อมกลุ่ม</div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-lg">📝</span>
              <div><strong className="text-[var(--color-text-primary)]">ส่งออกคำตอบ</strong> — ส่งออกคำตอบ quiz/assignment</div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
              <span className="text-lg">📈</span>
              <div><strong className="text-[var(--color-text-primary)]">เปรียบเทียบคะแนน</strong> — เปรียบเทียบคะแนนต่างช่วงเวลา</div>
            </div>
          </div>

          {!firebaseReady && (
            <div className="mb-4 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-left text-sm text-[var(--color-warning)]">
              <strong>Firebase ยังไม่ได้ตั้งค่า</strong>
              <p className="mt-1 text-xs">กรุณาตั้งค่า NEXT_PUBLIC_FIREBASE_* ใน .env.local ก่อนใช้งาน</p>
            </div>
          )}

          <button
            onClick={login}
            disabled={!firebaseReady}
            className="w-full rounded-xl bg-white/10 px-6 py-3 font-semibold text-[var(--color-text-primary)] transition hover:bg-white/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>
        </div>
      </div>
    );
  }

  // Step 2: API Key Input
  if (!apiKey || !canvasUrl) {
    const handleSave = async () => {
      if (!inputApiKey.trim() || !inputCanvasUrl.trim()) {
        setError('กรุณากรอกข้อมูลให้ครบ');
        return;
      }
      setSaving(true);
      setError('');
      try {
        await saveApiKey(inputApiKey.trim(), inputCanvasUrl.trim());
      } catch (err) {
        setError('ไม่สามารถบันทึกได้ กรุณาลองใหม่');
        console.error(err);
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="glass-card w-full max-w-md p-8">
          <h2 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">ตั้งค่า Canvas API</h2>
          <p className="mb-6 text-sm text-[var(--color-text-muted)]">
            ใส่ URL ของ Canvas และ API Key เพื่อเชื่อมต่อกับระบบ
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-[var(--color-text-muted)]">Canvas URL</label>
              <input
                type="url"
                placeholder="https://canvas.university.ac.th"
                value={inputCanvasUrl}
                onChange={(e) => setInputCanvasUrl(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--color-text-muted)]">API Key</label>
              <input
                type="password"
                placeholder="Canvas API Key"
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                ไปที่ Canvas → Account → Settings → New Access Token
              </p>
            </div>

            {error && (
              <p className="text-sm text-[var(--color-danger)]">{error}</p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-xl bg-[var(--color-accent)] px-6 py-3 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกและเริ่มใช้งาน'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Redirecting...
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"></div>
        <p className="mt-4 text-[var(--color-text-muted)]">กำลังเปลี่ยนหน้า...</p>
      </div>
    </div>
  );
}
