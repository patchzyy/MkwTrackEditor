import type { ReactNode } from 'react';

/**
 * Full-panel loading veil with a progress line. Sits above the viewport while a track is
 * decompressed and the scene is built.
 */
export function LoadingOverlay({ title, detail, progress }: { title: string; detail?: ReactNode; progress?: number | null }) {
  const percent = progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));
  return (
    <div className="uiLoadingOverlay" role="status" aria-live="polite">
      <div className="uiLoadingCard">
        <span className="uiLoadingSpinner" aria-hidden="true" />
        <strong className="uiLoadingTitle">{title}</strong>
        {detail && <span className="uiLoadingDetail">{detail}</span>}
        <span
          className="uiLoadingBar"
          data-indeterminate={percent === null ? 'true' : 'false'}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent === null ? undefined : Math.round(percent * 100)}
        >
          <span className="uiLoadingBarFill" style={percent === null ? undefined : { width: `${percent * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
