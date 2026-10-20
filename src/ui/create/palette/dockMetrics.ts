import { CONTENT_BROWSER_COLLAPSED_HEIGHT, type BrowserSizing } from '../../state/usePanelLayout';

/**
 * The palette's vertical rhythm. `palette.css` sets the same numbers as custom properties on
 * `.crPalette`; keep the two in step. They decide how tall the bottom dock is when it shows
 * exactly N whole rows of tiles, so a row is never cut in half.
 */
export const PALETTE_TILE_HEIGHT = 104;
export const PALETTE_ROW_GAP = 4;
/** A section title line plus the gap under it. */
export const PALETTE_TITLE_HEIGHT = 22;
export const PALETTE_BODY_PAD_TOP = 8;
export const PALETTE_BODY_PAD_BOTTOM = 12;
/** The dock's 1 px top border. */
const DOCK_BORDER = 1;

/** Tab bar (the dock header strip) plus the dock border and the body's padding. */
const CHROME = DOCK_BORDER + CONTENT_BROWSER_COLLAPSED_HEIGHT + PALETTE_BODY_PAD_TOP + PALETTE_BODY_PAD_BOTTOM;

/** Distance between the tops of two neighbouring tile rows. */
export const PALETTE_ROW_PITCH = PALETTE_TILE_HEIGHT + PALETTE_ROW_GAP;

/** Dock height that shows the tab bar, one section title and `rows` full rows of tiles. */
export function paletteDockHeight(rows: number): number {
  return CHROME + PALETTE_TITLE_HEIGHT + rows * PALETTE_TILE_HEIGHT + Math.max(0, rows - 1) * PALETTE_ROW_GAP;
}

/** Create mode opens the palette on one full row; dragging the edge steps by whole rows. */
export const CREATE_DOCK_SIZING: BrowserSizing = {
  key: 'create',
  defaultHeight: paletteDockHeight(1),
  minHeight: paletteDockHeight(1),
  rowSnap: { base: paletteDockHeight(1), pitch: PALETTE_ROW_PITCH },
};
