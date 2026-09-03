import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';
import type { StatusTone } from './statusMessage';

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  tone: StatusTone;
  /** Milliseconds before the toast auto-dismisses. `0` keeps it until dismissed. */
  durationMs?: number;
}

export interface ToastApi {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION: Record<StatusTone, number> = {
  info: 4000,
  success: 4000,
  progress: 0,
  warning: 7000,
  error: 0,
};

const TONE_ICON: Record<StatusTone, ReactNode> = {
  info: <Info size={15} />,
  success: <CheckCircle2 size={15} />,
  progress: <Info size={15} />,
  warning: <AlertTriangle size={15} />,
  error: <XCircle size={15} />,
};

/**
 * Toast store. Own this in the shell (`App`), pass the result to `ToastProvider` so nested
 * panels can call `useToast()`, and render `<ToastViewport />` once.
 */
export function useToastStore(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: Omit<Toast, 'id'> & { id?: string }) => {
    const id = toast.id ?? `toast-${++counterRef.current}`;
    setToasts((current) => [...current.filter((existing) => existing.id !== id), { ...toast, id }].slice(-4));
    return id;
  }, []);

  return useMemo(() => ({ toasts, showToast, dismissToast }), [dismissToast, showToast, toasts]);
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ value, children }: { value: ToastApi; children: ReactNode }) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/**
 * Toast API for anything rendered inside the shell. Returns a no-op store outside a
 * provider so components stay renderable in tests.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { toasts: [], showToast: () => '', dismissToast: () => {} };
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const duration = toast.durationMs ?? DEFAULT_DURATION[toast.tone];
  useEffect(() => {
    if (!duration) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss, toast.id]);
  return (
    <div className="uiToast" data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="uiToastIcon">{TONE_ICON[toast.tone]}</span>
      <div className="uiToastCopy">
        <strong className="uiToastTitle">{toast.title}</strong>
        {toast.detail && <span className="uiToastDetail">{toast.detail}</span>}
      </div>
      <IconButton icon={<X size={14} />} tooltip="Dismiss" variant="ghost" size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

/** Bottom-right toast stack. Render once, next to the status bar. */
export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="uiToastViewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
