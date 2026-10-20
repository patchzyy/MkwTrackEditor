/** Pure parts of the first-run tour: the steps, remembering it, and where a card goes. */

export const COACH_STORAGE_KEY = 'mkw.create.coach.v1';

export interface CoachStep {
  id: 'viewport' | 'tools' | 'palette' | 'testDrive';
  title: string;
  body: string;
  /** CSS selector of the element to point at, or null to centre the card in the viewport. */
  selector: string | null;
  placement: 'below' | 'above' | 'center';
}

export const COACH_STEPS: readonly CoachStep[] = [
  {
    id: 'viewport',
    title: 'This is your track',
    body: 'You are looking at it from above, which is the easiest way to draw and edit a road. Hold the right mouse button and drag to move around, scroll to zoom. Press T to switch to a 3D view.',
    selector: null,
    placement: 'center',
  },
  {
    id: 'tools',
    title: 'Pick a tool',
    body: 'Road draws the road, Pieces adds boosts and item boxes, Paint and Scenery dress the ground. The line under this bar always says what a click will do.',
    selector: '.crToolbar',
    placement: 'below',
  },
  {
    id: 'palette',
    title: 'Your building blocks',
    body: 'Click a tile to pick it up, then click in the viewport. Or drag a tile straight onto the road or the ground.',
    selector: '[data-create-slot="palette"]',
    placement: 'above',
  },
  {
    id: 'testDrive',
    title: 'Try it out',
    body: 'Press F5 whenever you like to drive your track. Stop the test drive and you are right back here.',
    selector: '.topBarTestDrive',
    placement: 'below',
  },
];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function coachSeen(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(COACH_STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markCoachSeen(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(COACH_STORAGE_KEY, 'done');
  } catch {
    // Private mode: the tour simply shows again next time.
  }
}

export function resetCoachMarks(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(COACH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const CARD_WIDTH = 320;
const GAP = 14;
const EDGE = 12;

/** Where the top-left corner of a card goes so it touches `target` and stays inside `bounds`. */
export function placeCoachCard(target: Box | null, cardHeight: number, bounds: Box, placement: CoachStep['placement']): { left: number; top: number; arrowLeft: number | null; side: 'above' | 'below' | null } {
  const clampX = (x: number) => Math.max(bounds.left + EDGE, Math.min(bounds.left + bounds.width - CARD_WIDTH - EDGE, x));
  const clampY = (y: number) => Math.max(bounds.top + EDGE, Math.min(bounds.top + bounds.height - cardHeight - EDGE, y));
  if (!target || placement === 'center') {
    return { left: clampX(bounds.left + bounds.width / 2 - CARD_WIDTH / 2), top: clampY(bounds.top + bounds.height / 2 - cardHeight / 2), arrowLeft: null, side: null };
  }
  const centerX = target.left + target.width / 2;
  const left = clampX(centerX - CARD_WIDTH / 2);
  const arrowLeft = Math.max(18, Math.min(CARD_WIDTH - 18, centerX - left));
  if (placement === 'below') {
    return { left, top: clampY(target.top + target.height + GAP), arrowLeft, side: 'below' };
  }
  return { left, top: clampY(target.top - cardHeight - GAP), arrowLeft, side: 'above' };
}
