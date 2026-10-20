/**
 * The viewport's mouse model, as pure rules.
 *
 * `Noclip3DViewport` owns the pointer outright (noclip's own `InputManager` mouse grab is turned
 * off), so every decision about what a press means lives here rather than being spread through
 * the event handlers: which button starts what, how far the pointer may travel before a click
 * stops counting as a click, which gestures take pointer lock, and what an interrupted gesture
 * should do with the edit it was making.
 *
 * Documented in `docs/viewport-api.md` ("Mouse model").
 */

/** How far the pointer may move between press and release and still count as a click. */
export const CLICK_SLOP_PX = 4;

/**
 * Chromium can deliver an enormous bogus `movementX/Y` on the frame pointer lock engages.
 * https://bugs.chromium.org/p/chromium/issues/detail?id=1031906
 */
export const MAX_CAMERA_LOOK_DELTA_PX = 240;

export type ViewportMouseButton = 'left' | 'middle' | 'right' | 'other';

export function toViewportMouseButton(button: number): ViewportMouseButton {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'other';
}

export interface PointerModifiers {
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function readModifiers(event: PointerModifiers): PointerModifiers {
  return { altKey: event.altKey, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
}

export function isAdditiveSelection(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

export function isCollisionSnap(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * What a camera gesture does with its deltas. `look` rotates a first-person camera in place;
 * `orbit` swings an orthographic camera around its target; `pan` slides it sideways.
 */
export type CameraGestureMode = 'look' | 'orbit' | 'pan' | 'zoom';

/**
 * What a press turned out to mean.
 *
 * - `select` — a left press with nothing draggable under it. It selects on release if the
 *   pointer stayed inside the slop, and turns into a camera gesture if it did not.
 * - `drag` — a gizmo handle, an entity, a marquee, a checkpoint being drawn, a path link. Owns
 *   the pointer until the button is released, wherever that happens.
 * - `camera` — a right or middle press: the camera and nothing else.
 */
export type ViewportGestureKind = 'select' | 'drag' | 'camera';

export interface ViewportGesture {
  kind: ViewportGestureKind;
  pointerId: number;
  button: ViewportMouseButton;
  modifiers: PointerModifiers;
  startX: number;
  startY: number;
  /** Set once the pointer has travelled further than `CLICK_SLOP_PX` from the press. */
  moved: boolean;
  /** Set when a `select` gesture was promoted into a camera gesture by moving. */
  camera: CameraGestureMode | null;
}

export interface BeginGestureInput {
  kind: ViewportGestureKind;
  pointerId: number;
  button: ViewportMouseButton;
  clientX: number;
  clientY: number;
  modifiers: PointerModifiers;
  camera?: CameraGestureMode | null;
}

export function beginGesture(input: BeginGestureInput): ViewportGesture {
  return {
    kind: input.kind,
    pointerId: input.pointerId,
    button: input.button,
    modifiers: input.modifiers,
    startX: input.clientX,
    startY: input.clientY,
    moved: false,
    camera: input.camera ?? null,
  };
}

export function movedBeyondSlop(gesture: ViewportGesture, clientX: number, clientY: number, slop = CLICK_SLOP_PX): boolean {
  return Math.hypot(clientX - gesture.startX, clientY - gesture.startY) >= slop;
}

/** Why a gesture stopped. Anything that is not the user changing their mind commits the edit. */
export type GestureEndReason = 'pointerup' | 'pointercancel' | 'lostcapture' | 'blur' | 'escape' | 'teardown';

/**
 * A drag that ends for any reason other than Escape keeps what it did: the rendered transform
 * has already been pushed at the renderer, so dropping it silently is what desynced the viewport
 * from the document. Escape is the one gesture that explicitly puts the mesh back.
 */
export function shouldCommitOnEnd(reason: GestureEndReason): boolean {
  return reason !== 'escape';
}

/** The preset's selection button selects only on an unmoved, uninterrupted click. */
export function shouldSelectOnRelease(gesture: ViewportGesture, reason: GestureEndReason, selectionButton: ViewportMouseButton = 'left'): boolean {
  return gesture.kind === 'select' && gesture.button === selectionButton && !gesture.moved && reason === 'pointerup';
}

export interface CameraGestureOptions {
  preset?: 'editor' | 'blender27' | 'blender';
  modifiers?: PointerModifiers;
  /** Orthographic view modes orbit their target instead of turning in place. */
  orthographic: boolean;
  /** False while a camera preview or a playtest owns the camera. */
  mouseLookAllowed: boolean;
}

/** Which camera gesture a button starts, or `null` when that button does not drive the camera. */
export function cameraModeForButton(button: ViewportMouseButton, options: CameraGestureOptions): CameraGestureMode | null {
  if (!options.mouseLookAllowed) return null;
  if (options.preset && options.preset !== 'editor') {
    if (button !== 'middle') return null;
    if (options.modifiers?.shiftKey) return 'pan';
    if (options.modifiers?.ctrlKey) return 'zoom';
    return 'orbit';
  }
  if (button === 'middle') return options.orthographic ? 'pan' : 'look';
  if (button === 'right' || button === 'left') return options.orthographic ? 'orbit' : 'look';
  return null;
}

/**
 * Pointer lock is for the right-button first-person look only: it is the one gesture where the
 * cursor should stay put and turning past the window edge has to keep working. Left-drag looking
 * uses pointer capture and a cursor change instead, so a stuck lock can never eat a user's mouse.
 */
export function usesPointerLock(gesture: ViewportGesture): boolean {
  return gesture.kind === 'camera' && gesture.button === 'right' && gesture.camera === 'look';
}

/**
 * Whether losing pointer capture really ends the gesture.
 *
 * Pointer lock implicitly releases any pointer capture the moment it engages (Pointer Events,
 * "implicit release of pointer capture"). Chromium reports that as a `lostpointercapture` on the
 * canvas while the right button is still down, so treating every capture loss as a release ended
 * the first-person look a fraction of a second after the lock engaged — and the cleanup then
 * exited the lock again. A locked look keeps going and is ended by `pointerlockchange` when the
 * lock itself goes away; every other gesture is over as soon as its capture is gone.
 */
export function endsOnLostPointerCapture(gesture: ViewportGesture): boolean {
  return !usesPointerLock(gesture);
}

/** The cursor the canvas should show for the gesture in progress. */
export function cursorForGesture(gesture: ViewportGesture | null): 'default' | 'look' | 'drag' {
  if (!gesture) return 'default';
  if (gesture.camera !== null) return 'look';
  if (gesture.kind === 'drag') return 'drag';
  return 'default';
}

/**
 * The mouse delta to feed the camera, or `null` when the delta is junk and should be dropped
 * (the first event after a pointer-lock transition, and Chromium's giant bogus deltas).
 */
export function cameraLookDelta(
  dx: number,
  dy: number,
  options: { skip?: boolean; max?: number } = {},
): { dx: number; dy: number } | null {
  const max = options.max ?? MAX_CAMERA_LOOK_DELTA_PX;
  if (options.skip) return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) > max || Math.abs(dy) > max) return null;
  return { dx, dy };
}
