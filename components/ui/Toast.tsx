'use client';

import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'border-[var(--color-success)] bg-[var(--color-success)]/10',
  error: 'border-[var(--color-danger)] bg-[var(--color-danger)]/10',
  warning: 'border-[var(--color-warning)] bg-[var(--color-warning)]/10',
  info: 'border-[var(--color-info)] bg-[var(--color-info)]/10',
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

export default function Toast({ message, type = 'info', duration = 4000, onClose }: ToastProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className={`fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-5 py-3 shadow-lg ${TOAST_STYLES[type]} ${exiting ? 'toast-exit' : 'toast-enter'}`}>
      <div className="flex items-center gap-2">
        <span>{TOAST_ICONS[type]}</span>
        <span className="text-sm text-[var(--color-text-primary)]">{message}</span>
        <button onClick={() => { setExiting(true); setTimeout(onClose, 300); }} className="ml-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">✕</button>
      </div>
    </div>
  );
}

// Toast container hook
let toastCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: ToastType }>>([]);

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const ToastContainer = () => (
    <>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
      ))}
    </>
  );

  return { showToast, ToastContainer };
}
