import { ChevronsLeft, ChevronsRight, Pause, Play, Repeat, SkipBack } from 'lucide-react';
import { IconButton, Select, Toggle, Tooltip } from '../components';
import {
  clampFrame,
  describeActiveAnimations,
  formatTransportPosition,
  formatTransportSeconds,
  formatTransportSpeed,
  scrubTransport,
  seekTransport,
  stepTransport,
  toggleTransportPlaying,
  STUDIO_TRANSPORT_SPEEDS,
  type StudioTransport,
} from './animationTransport';

export interface StudioTransportBarProps {
  transport: StudioTransport;
  onChange: (next: StudioTransport) => void;
  duration: number;
  active: ReadonlyArray<{ kind: string; name: string }>;
}

/**
 * The animation transport, under the viewport, exactly where a DAW or Unreal's Persona puts it.
 *
 * There is one timeline for the whole studio because there is one clock: the game plays a
 * driver's CHR0 and its kart's SRT0 together, so the studio does too, and the timeline spans the
 * longest animation that is currently on.
 */
export function StudioTransportBar({ transport, onChange, duration, active }: StudioTransportBarProps) {
  const disabled = duration <= 0;
  const frame = clampFrame(transport.frame, duration);

  return (
    <div className="studioTransport" role="group" aria-label="Animation transport">
      <div className="studioTransportButtons">
        <IconButton
          tooltip="Back to the start"
          tooltipSide="top"
          size="sm"
          icon={<SkipBack size={13} />}
          disabled={disabled}
          onClick={() => onChange(seekTransport({ ...transport, playing: false }, 0, duration))}
        />
        <IconButton
          tooltip="Back one frame"
          tooltipSide="top"
          size="sm"
          icon={<ChevronsLeft size={13} />}
          disabled={disabled}
          onClick={() => onChange(stepTransport(transport, -1, duration))}
        />
        <IconButton
          tooltip={transport.playing ? 'Pause' : 'Play'}
          tooltipSide="top"
          size="sm"
          variant="primary"
          icon={transport.playing ? <Pause size={14} /> : <Play size={14} />}
          disabled={disabled}
          onClick={() => onChange(toggleTransportPlaying(transport, duration))}
        />
        <IconButton
          tooltip="Forward one frame"
          tooltipSide="top"
          size="sm"
          icon={<ChevronsRight size={13} />}
          disabled={disabled}
          onClick={() => onChange(stepTransport(transport, 1, duration))}
        />
      </div>

      <input
        className="studioTransportScrubber"
        type="range"
        min={0}
        max={Math.max(1, Math.round(duration))}
        step={1}
        value={Math.round(frame)}
        disabled={disabled}
        aria-label="Animation frame"
        onChange={(event) => onChange(scrubTransport(transport, Number(event.currentTarget.value), duration))}
      />

      <span className="studioTransportReadout" aria-live="off">
        <strong>{formatTransportPosition(transport, duration)}</strong>
        <span>{formatTransportSeconds(transport, duration)}</span>
      </span>

      <Select
        label="Playback speed"
        size="sm"
        value={String(transport.speed)}
        options={STUDIO_TRANSPORT_SPEEDS.map((speed) => ({ value: String(speed), label: formatTransportSpeed(speed) }))}
        onChange={(value) => onChange({ ...transport, speed: Number(value) })}
      />

      <Tooltip label="Loop the timeline when it reaches the end" side="top">
        <span className="studioTransportLoop">
          <Repeat size={12} aria-hidden="true" />
          <Toggle label="Loop" checked={transport.loop} onChange={(loop) => onChange({ ...transport, loop })} />
        </span>
      </Tooltip>

      <span className="studioTransportStatus">{describeActiveAnimations(active)}</span>
    </div>
  );
}
