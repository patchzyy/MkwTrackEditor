import { describe, expect, it } from 'vitest';
import { snapBrowserHeight } from '../../state/usePanelLayout';
import { CREATE_DOCK_SIZING, PALETTE_ROW_PITCH, paletteDockHeight } from './dockMetrics';

describe('Create palette dock sizing', () => {
  it('opens on exactly one row: tab bar + title + one tile row, and snaps by whole rows', () => {
    expect(CREATE_DOCK_SIZING.defaultHeight).toBe(paletteDockHeight(1));
    expect(paletteDockHeight(2) - paletteDockHeight(1)).toBe(PALETTE_ROW_PITCH);
    expect(CREATE_DOCK_SIZING.minHeight).toBe(paletteDockHeight(1));
  });

  it('snaps a dragged height to a whole number of rows, never below one', () => {
    const snap = (h: number, max = 900) => snapBrowserHeight(h, CREATE_DOCK_SIZING, max);
    const one = paletteDockHeight(1);
    expect(snap(100)).toBe(one);
    expect(snap(one + 20)).toBe(one);
    expect(snap(one + PALETTE_ROW_PITCH * 0.6)).toBe(paletteDockHeight(2));
    expect(snap(one + PALETTE_ROW_PITCH * 2.2)).toBe(paletteDockHeight(3));
    // Never taller than the room the shell leaves.
    expect(snap(2000, one + PALETTE_ROW_PITCH * 2 + 10)).toBe(paletteDockHeight(3));
  });

  it('leaves the other modes on their shared 150 px minimum with free resizing', () => {
    const shared = { key: 'default', defaultHeight: 260, minHeight: 150 };
    expect(snapBrowserHeight(40, shared, 600)).toBe(150);
    expect(snapBrowserHeight(333.4, shared, 600)).toBe(333);
    expect(snapBrowserHeight(900, shared, 600)).toBe(600);
  });
});
