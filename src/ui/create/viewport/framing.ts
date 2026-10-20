/** Where the camera goes when a design first opens. Pure, so it can be unit tested. */
import type { CreateFrameOptions, CreateProject, Vec3 } from '../../../lib/create/types';

/**
 * How far around the origin a blank design is framed (game units). Chosen so a six-click loop that
 * fills about half the screen is a 30-50 second lap (a retail lap is about 230,000 units).
 */
export const BLANK_HALF_EXTENT = 45000;

/**
 * A design made from a template opens in perspective, looking down at a 3/4 angle, with the track
 * filling about 70 % of the canvas. That reads as "a place" at a glance; the top view (T) is one key
 * away for drawing. `fill` is measured on the box around the road (its near corners are wider on
 * screen than the road itself), so 0.8 of the box is about 70 % of the canvas for the road.
 */
export const TEMPLATE_VIEW: Required<Pick<CreateFrameOptions, 'pitchDegrees' | 'yawDegrees' | 'fill'>> = {
  pitchDegrees: 38,
  yawDegrees: 0,
  fill: 0.8,
};

export type OpeningView =
  | { kind: 'top'; min: Vec3; max: Vec3 }
  | { kind: 'perspective'; min: Vec3; max: Vec3; options: CreateFrameOptions };

/**
 * A blank design (no road yet) opens in the top view, where drawing is easiest. Anything else opens
 * in the 3/4 perspective framed on `designBounds` (the roads and what is on them), falling back to
 * `fallbackBounds` (everything generated) when the design has no extent.
 */
export function openingView(project: Pick<CreateProject, 'roads'>, designBounds: { min: Vec3; max: Vec3 } | null, fallbackBounds: { min: Vec3; max: Vec3 }): OpeningView {
  if (project.roads.length === 0) {
    return { kind: 'top', min: { x: -BLANK_HALF_EXTENT, y: 0, z: -BLANK_HALF_EXTENT }, max: { x: BLANK_HALF_EXTENT, y: 0, z: BLANK_HALF_EXTENT } };
  }
  const bounds = designBounds ?? fallbackBounds;
  return { kind: 'perspective', min: bounds.min, max: bounds.max, options: { ...TEMPLATE_VIEW, animate: false } };
}

/** The look every 3D framing uses (opening a template, F in perspective, leaving the top view). */
export const PERSPECTIVE_VIEW: CreateFrameOptions = { pitchDegrees: TEMPLATE_VIEW.pitchDegrees, yawDegrees: TEMPLATE_VIEW.yawDegrees, fill: TEMPLATE_VIEW.fill };
