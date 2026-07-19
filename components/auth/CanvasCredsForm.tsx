'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface CanvasCredsFormProps {
  /** Prefills the Canvas URL — the URL rarely changes when only the token expired. */
  initialCanvasUrl?: string;
  submitLabel?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

/**
 * Canvas URL + access token inputs. Shared by the first-run login step and the
 * re-auth modal so both paths write credentials the same way.
 */
export default function CanvasCredsForm({
  initialCanvasUrl = '',
  submitLabel = 'บันทึกและเริ่มใช้งาน',
  onSaved,
  onCancel,
}: CanvasCredsFormProps) {
  const { saveApiKey } = useAuth();
  const [inputApiKey, setInputApiKey] = useState('');
  const [inputCanvasUrl, setInputCanvasUrl] = useState(initialCanvasUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!inputApiKey.trim() || !inputCanvasUrl.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveApiKey(inputApiKey.trim(), inputCanvasUrl.trim());
      onSaved?.();
    } catch (err) {
      setError('ไม่สามารถบันทึกได้ กรุณาลองใหม่');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]';

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-[var(--color-text-muted)]">Canvas URL</label>
        <input
          type="url"
          placeholder="https://canvas.university.ac.th"
          value={inputCanvasUrl}
          onChange={(e) => setInputCanvasUrl(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-[var(--color-text-muted)]">Access Token</label>
        <input
          type="password"
          placeholder="Canvas Access Token"
          value={inputApiKey}
          onChange={(e) => setInputApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !saving) handleSave();
          }}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          ไปที่ Canvas → Account → Settings → New Access Token
        </p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl bg-white/5 px-5 py-3 font-semibold text-[var(--color-text-muted)] transition hover:bg-white/10 disabled:opacity-50"
          >
            ยกเลิก
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-xl bg-[var(--color-accent)] px-6 py-3 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50"
        >
          {saving ? 'กำลังบันทึก...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
