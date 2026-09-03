import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { classifyStatusMessage, splitStatusMessage, type StatusTone } from './statusMessage';

const TONE_ICON: Record<StatusTone, ReactNode> = {
  info: <Info size={13} />,
  success: <CheckCircle2 size={13} />,
  progress: <Loader2 size={13} className="uiSpin" />,
  warning: <AlertTriangle size={13} />,
  error: <XCircle size={13} />,
};

/**
 * Frames-per-second of the app's animation loop. The noclip viewport drives a continuous
 * rAF loop while a scene is up, so this is the viewport's frame rate in practice. Returns
 * `null` until it has a full sample window.
 */
export function useFrameRate(enabled: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null);
  const stateRef = useRef({ frames: 0, since: 0 });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setFps(null);
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let handle = 0;
    stateRef.current = { frames: 0, since: performance.now() };
    const tick = (now: number) => {
      const state = stateRef.current;
      state.frames += 1;
      const elapsed = now - state.since;
      if (elapsed >= 1000) {
        setFps(Math.round((state.frames * 1000) / elapsed));
        state.frames = 0;
        state.since = now;
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [enabled]);

  return fps;
}

export interface StatusBarStat {
  id: string;
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'error';
  title?: string;
}

/**
 * Bottom strip of the shell: the latest message (with a severity icon) on the left and the
 * document's vital statistics on the right.
 */
export function StatusBar({ message, stats, extra }: { message: string; stats: StatusBarStat[]; extra?: ReactNode }) {
  const tone = classifyStatusMessage(message);
  const { summary, detail } = splitStatusMessage(message);
  return (
    <footer className="uiStatusBar" role="contentinfo">
      <div className="uiStatusMessage" data-tone={tone} title={message}>
        <span className="uiStatusIcon">{TONE_ICON[tone]}</span>
        <span className="uiStatusSummary">{summary}</span>
        {detail && <span className="uiStatusDetail">{detail}</span>}
      </div>
      {extra}
      <div className="uiStatusStats">
        {stats.map((stat) => (
          <span className="uiStatusStat" key={stat.id} data-tone={stat.tone ?? 'default'} title={stat.title ?? `${stat.label}: ${stat.value}`}>
            <span className="uiStatusStatLabel">{stat.label}</span>
            <span className="uiStatusStatValue">{stat.value}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
