import { describe, expect, it } from 'vitest';
import {
  advanceTransport,
  clampFrame,
  defaultStudioTransport,
  describeActiveAnimations,
  formatTransportPosition,
  formatTransportSeconds,
  formatTransportSpeed,
  scrubTransport,
  seekTransport,
  stepTransport,
  STUDIO_FPS,
  toggleTransportPlaying,
  type StudioTransport,
} from './animationTransport';

const playing: StudioTransport = { ...defaultStudioTransport, playing: true, frame: 0, speed: 1, loop: true };

describe('studio animation transport', () => {
  it('advances at 60 frames a second at 1x', () => {
    const next = advanceTransport(playing, 1000, 240);
    expect(next.frame).toBeCloseTo(STUDIO_FPS, 6);
  });

  it('scales with the speed', () => {
    expect(advanceTransport({ ...playing, speed: 2 }, 500, 240).frame).toBeCloseTo(60, 6);
    expect(advanceTransport({ ...playing, speed: 0.25 }, 1000, 240).frame).toBeCloseTo(15, 6);
  });

  it('does nothing while paused, or for a non-advancing tick', () => {
    const paused = { ...playing, playing: false, frame: 12 };
    expect(advanceTransport(paused, 1000, 240)).toBe(paused);
    expect(advanceTransport(playing, 0, 240)).toBe(playing);
    expect(advanceTransport(playing, Number.NaN, 240)).toBe(playing);
  });

  it('wraps a looping timeline', () => {
    const next = advanceTransport({ ...playing, frame: 230 }, 1000, 240);
    expect(next.frame).toBeCloseTo(50, 6);
    expect(next.playing).toBe(true);
  });

  it('stops a one-shot on its last frame', () => {
    const next = advanceTransport({ ...playing, loop: false, frame: 230 }, 1000, 240);
    expect(next.frame).toBe(240);
    expect(next.playing).toBe(false);
  });

  it('sits at zero when nothing is playing', () => {
    expect(advanceTransport(playing, 1000, 0).frame).toBe(0);
  });

  it('scrubbing pauses and clamps; seeking keeps the play state', () => {
    expect(scrubTransport(playing, 500, 240)).toEqual({ ...playing, playing: false, frame: 240 });
    expect(scrubTransport(playing, -20, 240).frame).toBe(0);
    expect(seekTransport(playing, 30, 240)).toEqual({ ...playing, frame: 30 });
  });

  it('stepping moves one frame at a time and pauses', () => {
    expect(stepTransport({ ...playing, frame: 10 }, 1, 240)).toEqual({ ...playing, playing: false, frame: 11 });
    expect(stepTransport({ ...playing, frame: 0 }, -1, 240).frame).toBe(0);
  });

  it('play at the end of a finished one-shot starts it again', () => {
    const finished: StudioTransport = { playing: false, frame: 240, speed: 1, loop: false };
    expect(toggleTransportPlaying(finished, 240)).toEqual({ ...finished, playing: true, frame: 0 });
    expect(toggleTransportPlaying({ ...finished, frame: 100 }, 240)).toEqual({ ...finished, playing: true, frame: 100 });
    expect(toggleTransportPlaying(playing, 240).playing).toBe(false);
  });

  it('clamps a frame to a timeline that may not exist', () => {
    expect(clampFrame(10, 0)).toBe(0);
    expect(clampFrame(Number.NaN, 240)).toBe(0);
    expect(clampFrame(1000, 240)).toBe(240);
  });

  it('formats the readout in frames and in seconds', () => {
    const at = { ...playing, frame: 30 };
    expect(formatTransportPosition(at, 240)).toBe('30 / 240');
    expect(formatTransportSeconds(at, 240)).toBe('0.50s / 4.00s');
    expect(formatTransportSpeed(0.25)).toBe('0.25x');
  });

  it('says what is playing without listing a crowd', () => {
    expect(describeActiveAnimations([])).toBe('Nothing playing');
    expect(describeActiveAnimations([{ kind: 'chr0', name: 'wait' }])).toBe('Playing wait');
    expect(describeActiveAnimations([
      { kind: 'chr0', name: 'wait' },
      { kind: 'srt0', name: 'body' },
    ])).toBe('Playing wait, body');
    expect(describeActiveAnimations(new Array(6).fill({ kind: 'chr0', name: 'x' }))).toBe('Playing 6 animations');
  });
});
