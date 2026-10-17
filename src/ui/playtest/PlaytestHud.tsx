import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buildPlaytestHudView, playtestHudViewsEqual, type PlaytestHudView } from './playtestHudModel';
import type { PlaytestHudSample } from './usePlaytestSession';

/**
 * The race HUD, drawn over the viewport canvas.
 *
 * Deliberately small: lap and timer top-left, speed bottom-left, restart/exit top-right, the
 * countdown in the middle. Nothing here is a panel and nothing here is interactive except the
 * two buttons, so the layer is `pointer-events: none` and the buttons opt back in.
 *
 * It reads the live sample from a ref in its own animation loop and only calls `setState` when
 * a string the user can see changes, so the editor shell never re-renders at 60 Hz.
 */
export function PlaytestHud({
  loading,
  hudRef,
  onRestart,
  onExit,
}: {
  loading: boolean;
  hudRef: { readonly current: PlaytestHudSample };
  onRestart: () => void;
  onExit: () => void;
}) {
  const [view, setView] = useState<PlaytestHudView | null>(null);
  const viewRef = useRef<PlaytestHudView | null>(null);

  useEffect(() => {
    if (loading) return;
    let frame = 0;
    let lastSampleMs = 0;
    const tick = (timeMs: number) => {
      frame = requestAnimationFrame(tick);
      // ~30 Hz is plenty for a millisecond timer nobody can read at 60.
      if (timeMs - lastSampleMs < 32) return;
      lastSampleMs = timeMs;
      const sample = hudRef.current;
      const next = buildPlaytestHudView(
        {
          stage: sample.stage,
          frame: sample.frame,
          timeMs: sample.timeMs,
          lap: sample.lap,
          maxLap: sample.maxLap,
          lapCompletion: 0,
          checkpointId: 0,
          respawnId: 0,
          lapSplitsMs: [],
        },
        { speed: sample.speed, miniTurbo: sample.miniTurbo, mushrooms: sample.mushrooms },
        undefined,
        sample.infiniteMushrooms,
      );
      if (playtestHudViewsEqual(viewRef.current, next)) return;
      viewRef.current = next;
      setView(next);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hudRef, loading]);

  return (
    <div className="playtestHud" data-loading={loading ? 'true' : 'false'}>
      {loading ? (
        <div className="playtestHudLoading">Loading physics…</div>
      ) : (
        <>
          <div className="playtestHudCorner playtestHudTopLeft">
            <span className="playtestHudLap">Lap {view?.lap ?? '1/3'}</span>
            <span className="playtestHudTime">{view?.time ?? '0:00.000'}</span>
            <PlaytestItemSlot mushrooms={view?.mushrooms ?? 0} />
          </div>
          <div className="playtestHudCorner playtestHudTopRight">
            <button type="button" className="playtestHudButton" onClick={onRestart}>
              <RotateCcw size={13} aria-hidden="true" />
              Restart <kbd>R</kbd>
            </button>
            <button type="button" className="playtestHudButton" onClick={onExit}>
              <X size={13} aria-hidden="true" />
              Exit <kbd>Esc</kbd>
            </button>
          </div>
          <div className="playtestHudCorner playtestHudBottomLeft">
            <span className="playtestHudSpeed" data-testid="playtest-speed">
              {view?.speed ?? '0 km/h'}
            </span>
            {view?.charge ? (
              <div className="playtestHudCharge" data-level={view.charge.level} data-kind={view.charge.kind}>
                <span className="playtestHudChargeLabel">{view.charge.label}</span>
                <span className="playtestHudChargeBar" aria-hidden="true">
                  <span className="playtestHudChargeFill" style={{ width: `${view.charge.percent}%` }} />
                </span>
              </div>
            ) : null}
          </div>
          {view?.centerText ? (
            <div className="playtestHudCenter" data-stage={view.stage}>
              {view.centerText}
              {view.finalTime && <span className="playtestHudFinalTime">{view.finalTime}</span>}
            </div>
          ) : null}
        </>
      )}
      <div
        hidden
        data-playtest-stage={view?.stage ?? 'loading'}
        data-playtest-speed={view?.speed ?? ''}
        data-playtest-time={view?.time ?? ''}
        data-playtest-mushrooms={view ? String(view.mushrooms) : ''}
        data-playtest-charge={view?.charge ? `${view.charge.kind}:${view.charge.level}:${view.charge.percent}` : ''}
      />
    </div>
  );
}

/** The item box: a mushroom with how many are left, dimmed once the slot is empty. */
function PlaytestItemSlot({ mushrooms }: { mushrooms: number | '∞' }) {
  const empty = mushrooms === 0;
  return (
    <div
      className="playtestHudItem"
      data-empty={empty ? 'true' : 'false'}
      title={empty ? 'No mushrooms left' : 'Use a mushroom (C)'}
      data-testid="playtest-item"
    >
      <MushroomIcon />
      <span className="playtestHudItemCount">{empty ? '0' : `×${mushrooms}`}</span>
      <kbd>C</kbd>
    </div>
  );
}

function MushroomIcon() {
  return (
    <svg className="playtestHudItemIcon" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 17h10v7.5a4.5 4.5 0 0 1-4.5 4.5h-1A4.5 4.5 0 0 1 11 24.5z" fill="#f6e3bf" stroke="#3a2412" strokeWidth="1.5" />
      <ellipse cx="14" cy="22" rx="1.1" ry="2" fill="#1d1208" />
      <ellipse cx="18" cy="22" rx="1.1" ry="2" fill="#1d1208" />
      <path d="M3 17.5C3 9.5 9 3 16 3s13 6.5 13 14.5c0 1.4-1.1 2.5-2.5 2.5h-21A2.5 2.5 0 0 1 3 17.5z" fill="#e5262c" stroke="#3a2412" strokeWidth="1.5" />
      <circle cx="16" cy="9" r="3.6" fill="#fff" />
      <path d="M4.2 14.5a4 4 0 0 1 3.3 5.5H5.5A2.5 2.5 0 0 1 3 17.5c0-1 .4-2 1.2-3z" fill="#fff" />
      <path d="M27.8 14.5a4 4 0 0 0-3.3 5.5h2A2.5 2.5 0 0 0 29 17.5c0-1-.4-2-1.2-3z" fill="#fff" />
    </svg>
  );
}
