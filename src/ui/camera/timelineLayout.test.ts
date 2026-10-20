import { describe, expect, it } from 'vitest';
import {
  MIN_CLIP_WIDTH,
  buildRulerTicks,
  formatClock,
  frameToX,
  insertionSlot,
  layoutClips,
  layoutWithPlaceholder,
  layoutWidth,
  pickRulerStepSeconds,
  totalFramesOf,
  xToFrame,
} from './timelineLayout';

const clips = [
  { cameraIndex: 4, durationFrames: 120 },
  { cameraIndex: 2, durationFrames: 240 },
  { cameraIndex: 7, durationFrames: 60 },
];

describe('timeline layout', () => {
  it('lays clips end to end with widths proportional to duration', () => {
    const layouts = layoutClips(clips, 1);
    expect(layouts.map((l) => [l.left, l.width, l.startFrame])).toEqual([
      [0, 120, 0],
      [120, 240, 120],
      [360, MIN_CLIP_WIDTH, 360],
    ]);
    expect(totalFramesOf(layouts)).toBe(420);
    expect(layoutWidth(layouts)).toBe(360 + MIN_CLIP_WIDTH);
  });

  it('maps frames to pixels and back, even through a clip stretched to the minimum width', () => {
    const layouts = layoutClips(clips, 1);
    expect(frameToX(layouts, 180, 1)).toBe(180);
    expect(frameToX(layouts, 390, 1)).toBeCloseTo(360 + MIN_CLIP_WIDTH / 2);
    expect(xToFrame(layouts, 360 + MIN_CLIP_WIDTH / 2, 1)).toBeCloseTo(390);
    for (const frame of [0, 33, 119, 120, 300, 359, 400]) {
      expect(xToFrame(layouts, frameToX(layouts, frame, 1), 1)).toBeCloseTo(frame);
    }
  });

  it('stays linear past the last clip and never goes negative', () => {
    const layouts = layoutClips(clips, 2);
    const end = layoutWidth(layouts);
    expect(frameToX(layouts, 420 + 10, 2)).toBeCloseTo(end + 20);
    expect(xToFrame(layouts, end + 20, 2)).toBeCloseTo(430);
    expect(xToFrame(layouts, -50, 2)).toBe(0);
  });

  it('picks the drop slot from the pointer position, counting clip centres', () => {
    const layouts = layoutClips(clips, 1);
    expect(insertionSlot(layouts, 10)).toBe(0);
    expect(insertionSlot(layouts, 70)).toBe(1);
    expect(insertionSlot(layouts, 200)).toBe(1);
    expect(insertionSlot(layouts, 260)).toBe(2);
    expect(insertionSlot(layouts, 9999)).toBe(3);
  });

  it('opens a gap for the dragged clip', () => {
    const layouts = layoutWithPlaceholder(clips.slice(0, 2), 1, 90, 1);
    expect(layouts.map((l) => [l.cameraIndex, l.left, l.width])).toEqual([
      [4, 0, 120],
      [-1, 120, 90],
      [2, 210, 240],
    ]);
    expect(layouts[1].placeholder).toBe(true);
  });
});

describe('timeline ruler', () => {
  it('labels every second when zoomed in and every few seconds when zoomed out', () => {
    expect(pickRulerStepSeconds(2)).toBe(1);
    expect(pickRulerStepSeconds(0.5)).toBe(2);
    expect(pickRulerStepSeconds(0.2)).toBe(5);
  });

  it('puts labelled ticks on whole seconds and covers the end of the sequence', () => {
    const ticks = buildRulerTicks(60 * 3 + 10, 2);
    const labelled = ticks.filter((tick) => tick.label);
    expect(labelled.map((tick) => tick.label)).toEqual(['0s', '1s', '2s', '3s', '4s']);
    expect(labelled[3].frame).toBe(180);
    expect(ticks.some((tick) => !tick.major)).toBe(true);
  });
});

describe('timeline clock', () => {
  it('reads seconds, frames and the total', () => {
    expect(formatClock(204, 720)).toBe('3.4 s · 204 f / 12.0 s');
    expect(formatClock(30, 0)).toBe('0.5 s · 30 f');
  });
});
