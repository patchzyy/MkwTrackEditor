/**
 * The playtest session: everything between pressing Start and leaving the race.
 *
 * Owns the runtime instance, the controller listeners, the HUD sample the overlay reads, and
 * the dock layout it borrows for the duration. The viewport does the per-frame work (the fixed
 * 60 Hz step loop, the camera and the kart model) through {@link PlaytestViewportSession}; this
 * hook never touches the renderer.
 *
 * `App.tsx` only wires props: everything stateful lives here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportTrack, type TrackDocument } from '../../lib/track';
import { buildPublicAssetUrl } from '../../lib/assetPaths';
import type { CommonResourceArchive } from '../../lib/objflow';
import {
  PlaytestError,
  type PlaytestCourseOptions,
  type PlaytestInput,
  type PlaytestKartState,
  type PlaytestRaceState,
  type PlaytestRuntime,
  type PlaytestMiniTurbo,
} from '../../lib/playtest/types';
import type { ToastApi } from '../components/Toast';
import {
  PLAYTEST_EXIT_CODE,
  PLAYTEST_RESTART_CODE,
  isPlaytestKeyCode,
  mergePlaytestInputs,
  playtestInputFromKeys,
  readConnectedGamepadInput,
} from './playtestInput';
import { readStoredPlaytestOptions, writeStoredPlaytestOptions } from './playtestOptions';
import { playtestRuntimeFactory } from './runtimeFactory';

/** Status-bar text while a session is running. */
export const PLAYTEST_STATUS_MESSAGE = 'Playtesting — Esc to exit';

export type PlaytestPhase = 'idle' | 'loading' | 'running';

/** The live numbers the HUD renders. Mutated in place every frame; never a React state object. */
export interface PlaytestHudSample {
  stage: PlaytestRaceState['stage'];
  frame: number;
  timeMs: number;
  lap: number;
  maxLap: number;
  speed: number;
  miniTurbo: PlaytestMiniTurbo;
  mushrooms: number;
  infiniteMushrooms: boolean;
}

/** The imperative handle the viewport drives once per animation frame. */
export interface PlaytestViewportSession {
  readonly runtime: PlaytestRuntime;
  /** Bumped by `restart()`. The viewport re-snaps its camera and clock when it changes. */
  resetKey: number;
  /** Controller state for the frames about to be simulated. */
  getInput(): PlaytestInput;
  /** Called after stepping, with the runtime's own reused state objects. */
  onFrame(kart: PlaytestKartState, race: PlaytestRaceState): void;
  /** Anything the runtime threw, or `runtime.disposed` flipping mid-session. Ends the session. */
  onError(error: unknown): void;
}

/**
 * The subset of `usePanelLayout` the session borrows while the race is on: one switch that draws
 * every dock closed without changing (or saving) the user's own open/closed choices.
 */
export interface PlaytestLayoutControl {
  setDocksHidden: (hidden: boolean) => void;
}

export interface PlaytestSession {
  phase: PlaytestPhase;
  /** True from Start until the session has fully torn down. */
  active: boolean;
  /** True while the runtime is being created and the course packed. */
  loading: boolean;
  options: PlaytestCourseOptions;
  setOptions: (options: PlaytestCourseOptions) => void;
  /** False when the loaded track cannot be driven; `disabledReason` says why. */
  canPlaytest: boolean;
  disabledReason: string | null;
  start: () => void;
  stop: () => void;
  restart: () => void;
  viewportSession: PlaytestViewportSession | null;
  /** Read by `PlaytestHud` in its own animation loop, so the shell does not re-render at 60 Hz. */
  hudRef: { readonly current: PlaytestHudSample };
}

function emptyHudSample(): PlaytestHudSample {
  return { stage: 'intro', frame: 0, timeMs: 0, lap: 1, maxLap: 3, speed: 0, miniTurbo: { kind: 'none', level: 0, charge: 0 }, mushrooms: 0, infiniteMushrooms: false };
}

function describePlaytestError(error: unknown): string {
  if (error instanceof PlaytestError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Why this track cannot be driven, or `null` when it can. */
export function playtestDisabledReason(track: TrackDocument | null): string | null {
  if (!track) return 'Playtest needs a loaded track';
  if (!track.kmp) return 'Playtest needs a track with a KMP';
  if (!track.kcl) return 'Playtest needs a track with a collision mesh';
  return null;
}

export function usePlaytestSession({
  track,
  commonArchive,
  commonArchiveUrl,
  layout,
  showToast,
}: {
  track: TrackDocument | null;
  commonArchive: CommonResourceArchive | null;
  commonArchiveUrl: string | null;
  layout: PlaytestLayoutControl;
  showToast: ToastApi['showToast'];
}): PlaytestSession {
  const [phase, setPhase] = useState<PlaytestPhase>('idle');
  const [options, setOptionsState] = useState<PlaytestCourseOptions>(readStoredPlaytestOptions);
  const [viewportSession, setViewportSession] = useState<PlaytestViewportSession | null>(null);

  const hudRef = useRef<PlaytestHudSample>(emptyHudSample());
  /** Mirrors `phase` synchronously, so two Starts in the same tick cannot both go through. */
  const phaseRef = useRef<PlaytestPhase>('idle');
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const runtimeRef = useRef<PlaytestRuntime | null>(null);
  const startTokenRef = useRef(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const trackRef = useRef(track);
  trackRef.current = track;
  const commonArchiveRef = useRef(commonArchive);
  commonArchiveRef.current = commonArchive;
  const commonArchiveUrlRef = useRef(commonArchiveUrl);
  commonArchiveUrlRef.current = commonArchiveUrl;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const disabledReason = playtestDisabledReason(track);
  const canPlaytest = disabledReason === null;

  const setOptions = useCallback((next: PlaytestCourseOptions) => {
    setOptionsState(next);
    writeStoredPlaytestOptions(next);
  }, []);

  /** Puts the docks back exactly as the user had them. Safe to call when nothing was borrowed. */
  const restoreLayout = useCallback(() => {
    layoutRef.current.setDocksHidden(false);
  }, []);

  const stop = useCallback(() => {
    startTokenRef.current++;
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    setViewportSession(null);
    phaseRef.current = 'idle';
    setPhase('idle');
    pressedKeysRef.current.clear();
    restoreLayout();
    if (runtime && !runtime.disposed) {
      try {
        runtime.dispose();
      } catch {
        // A runtime that traps on teardown must not keep the editor in playtest mode.
      }
    }
  }, [restoreLayout]);

  /** Ends the session and tells the user why, for anything the runtime throws. */
  const failSession = useCallback(
    (error: unknown) => {
      stop();
      showToastRef.current({ tone: 'error', title: 'Playtest stopped', detail: describePlaytestError(error) });
    },
    [stop],
  );
  const failSessionRef = useRef(failSession);
  failSessionRef.current = failSession;

  const start = useCallback(() => {
    const currentTrack = trackRef.current;
    const reason = playtestDisabledReason(currentTrack);
    if (!currentTrack || reason) {
      showToastRef.current({ tone: 'warning', title: 'Cannot playtest', detail: reason ?? 'No track loaded' });
      return;
    }
    // A second Start while one is loading or running (F5 pressed twice, a double click) is ignored.
    if (phaseRef.current !== 'idle') return;
    const token = ++startTokenRef.current;
    layoutRef.current.setDocksHidden(true);
    pressedKeysRef.current.clear();
    Object.assign(hudRef.current, emptyHudSample());
    phaseRef.current = 'loading';
    setPhase('loading');

    void (async () => {
      try {
        // The course the user is driving is the one on screen, unsaved edits included.
        // Uncompressed: the runtime unpacks it straight away and Yaz0 would cost a second.
        const courseBytes = exportTrack(currentTrack, { common: commonArchiveRef.current, compress: false });
        const commonUrl = commonArchiveUrlRef.current ?? buildPublicAssetUrl('data/MarioKartWii/Race/Common.szs');
        const response = await fetch(commonUrl);
        if (!response.ok) throw new PlaytestError(`Could not load the shared game data (HTTP ${response.status}).`);
        const commonBytes = new Uint8Array(await response.arrayBuffer());
        if (startTokenRef.current !== token) return;

        const runtime = await playtestRuntimeFactory({
          commonArchive: commonBytes,
          onLog: (line) => console.warn(`[playtest] ${line}`),
        });
        if (startTokenRef.current !== token) {
          runtime.dispose();
          return;
        }
        runtime.loadCourse(courseBytes, options);
        runtimeRef.current = runtime;
        setViewportSession({
          runtime,
          resetKey: 0,
          getInput: () => mergePlaytestInputs(playtestInputFromKeys(pressedKeysRef.current), readConnectedGamepadInput()),
          onFrame: (kart, race) => {
            const hud = hudRef.current;
            hud.stage = race.stage;
            hud.frame = race.frame;
            hud.timeMs = race.timeMs;
            hud.lap = race.lap;
            hud.maxLap = race.maxLap;
            hud.speed = kart.speed;
            hud.miniTurbo.kind = kart.miniTurbo.kind;
            hud.miniTurbo.level = kart.miniTurbo.level;
            hud.miniTurbo.charge = kart.miniTurbo.charge;
            hud.mushrooms = kart.mushrooms;
            hud.infiniteMushrooms = options.infiniteMushrooms;
          },
          onError: (error) => failSessionRef.current(error),
        });
        phaseRef.current = 'running';
        setPhase('running');
      } catch (error) {
        if (startTokenRef.current !== token) return;
        failSessionRef.current(error);
      }
    })();
  }, [options]);

  const restart = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    try {
      runtime.restart();
    } catch (error) {
      failSessionRef.current(error);
      return;
    }
    Object.assign(hudRef.current, emptyHudSample());
    setViewportSession((current) => (current ? { ...current, resetKey: current.resetKey + 1 } : current));
  }, []);

  const active = phase !== 'idle';

  // Controller listeners. They run from `loading` onwards so a key pressed while the runtime is
  // still starting cannot reach the editor's shortcuts.
  useEffect(() => {
    if (!active) return;
    const pressed = pressedKeysRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isPlaytestKeyCode(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === PLAYTEST_EXIT_CODE) {
        stop();
        return;
      }
      if (event.code === PLAYTEST_RESTART_CODE) {
        restart();
        return;
      }
      pressed.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isPlaytestKeyCode(event.code)) return;
      event.preventDefault();
      pressed.delete(event.code);
    };
    // A blurred window never sends the matching keyup, which would leave the throttle stuck on.
    const onBlur = () => pressed.clear();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      pressed.clear();
    };
  }, [active, restart, stop]);

  // The editor's own shortcut handlers and the viewport's pointer handlers check this flag, the
  // same way they check `viewportCameraLook`.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.playtest = active ? 'active' : 'inactive';
    return () => {
      document.documentElement.dataset.playtest = 'inactive';
    };
  }, [active]);

  // Loading a different track (or unmounting) must not leave a runtime running.
  useEffect(() => {
    if (!active) return;
    return () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      startTokenRef.current++;
      if (runtime && !runtime.disposed) {
        try {
          runtime.dispose();
        } catch {
          // Nothing useful to do while unmounting.
        }
      }
    };
  }, [active]);

  const trackKey = track?.sourceId ?? track?.fileName ?? null;
  useEffect(() => {
    if (phase === 'idle') return;
    stop();
    // Only when the loaded track itself changes underneath a running session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  return useMemo(
    () => ({
      phase,
      active,
      loading: phase === 'loading',
      options,
      setOptions,
      canPlaytest,
      disabledReason,
      start,
      stop,
      restart,
      viewportSession,
      hudRef,
    }),
    [active, canPlaytest, disabledReason, options, phase, restart, setOptions, start, stop, viewportSession],
  );
}
