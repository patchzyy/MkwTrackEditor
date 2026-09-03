import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import { framesToSeconds } from '../../lib/cameraPreview';
import type { CameraPreviewProgress } from '../Noclip3DViewport';

export interface CameraPlaybackControlsProps {
  /** The camera the preview starts at. */
  cameraIndex: number;
  /** Friendly one-line name for any camera index, e.g. `"Camera 3 — Opening pan (fixed)"`. */
  describeCamera: (index: number) => string;
  /** True when the preview plays the whole opening chain instead of one shot. */
  sequence: boolean;
  playing: boolean;
  looping: boolean;
  /** Scrub position in frames; only meaningful while paused. */
  time: number;
  /** Length of the whole preview in frames; 0 when the shot has no fixed length. */
  totalFrames: number;
  /** Written by the viewport every rendered frame, so playback does not re-render the app. */
  progressRef: MutableRefObject<CameraPreviewProgress | null>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onScrub: (frames: number) => void;
  onToggleLoop: () => void;
  onPlayOpening: () => void;
  canPlayOpening: boolean;
}

/**
 * Viewport top-right playback HUD. While the preview runs the viewport owns the clock, so this
 * polls the progress ref on its own animation frame and keeps the re-renders inside this panel.
 */
export function CameraPlaybackControls({
  cameraIndex,
  describeCamera,
  sequence,
  playing,
  looping,
  time,
  totalFrames,
  progressRef,
  onPlay,
  onPause,
  onStop,
  onScrub,
  onToggleLoop,
  onPlayOpening,
  canPlayOpening,
}: CameraPlaybackControlsProps) {
  const [live, setLive] = useState<CameraPreviewProgress | null>(progressRef.current);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      setLive(progressRef.current);
      return;
    }
    const tick = () => {
      setLive(progressRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [playing, progressRef]);

  const frames = playing ? (live?.frames ?? time) : time;
  const shownCamera = playing ? (live?.cameraIndex ?? cameraIndex) : cameraIndex;
  const length = Math.max(1, totalFrames || live?.totalFrames || 1);

  return (
    <div className="viewportOverlayPanel cameraPlayback">
      <div className="viewportOverlayHeader">
        <strong>{sequence ? 'Opening pan' : `Camera ${cameraIndex}`}</strong>
        <span className="cameraPlaybackClock">
          {Math.round(frames)} f · {framesToSeconds(frames).toFixed(2)} s
        </span>
      </div>
      <p className="viewportOverlayDetail">Now showing {describeCamera(shownCamera)}</p>

      <input
        className="cameraPlaybackScrub"
        type="range"
        aria-label="Playback position"
        min={0}
        max={Math.round(length)}
        step={1}
        value={Math.min(Math.round(frames), Math.round(length))}
        onChange={(event) => onScrub(Number(event.currentTarget.value))}
      />

      <div className="cameraPlaybackButtons">
        {playing ? (
          <button type="button" className="button" onClick={onPause} title="Pause the preview">
            <Pause size={14} />
            Pause
          </button>
        ) : (
          <button type="button" className="button" onClick={onPlay} title="Play this camera">
            <Play size={14} />
            Play
          </button>
        )}
        <button type="button" className="button" onClick={onStop} title="Stop and go back to the free camera (Escape)">
          <Square size={14} />
          Stop
        </button>
        <button
          type="button"
          className={looping ? 'button isActive' : 'button'}
          aria-pressed={looping}
          onClick={onToggleLoop}
          title="Restart the preview when it reaches the end"
        >
          <Repeat size={14} />
          Loop
        </button>
      </div>
      <button type="button" className="button cameraPlaybackOpening" onClick={onPlayOpening} disabled={!canPlayOpening} title="Play every camera of the opening pan in order">
        Play opening sequence
      </button>
      <p className="viewportOverlayHint">Escape stops the preview and puts the free camera back where it was.</p>
    </div>
  );
}
