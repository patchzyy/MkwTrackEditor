// Labels, hints and per-type field relevance for the camera inspector.
//
// Pure data + small predicates so the inspector components stay declarative and so the wording
// can be checked by tests. Nothing here mentions a KMP section code.

import { CAMERA_TYPES, type CameraTypeInfo } from '../../lib/cameraPreview';

/** Which inspector fields a camera type actually reads. */
export interface CameraFieldRelevance {
  /** The camera's own position in the world. Player-following cameras ignore it. */
  position: boolean;
  rotation: boolean;
  /** A POTI route the camera position follows. */
  route: boolean;
  /** The shot length. Only the opening pans use it. */
  duration: boolean;
  /** Hand-over to the next camera. Only the opening pans use it. */
  nextCamera: boolean;
  /** Zoom start/end and zoom speed. */
  zoom: boolean;
  /** The moving look-at point. */
  viewEnd: boolean;
  /** How fast the camera travels along its route. */
  moveSpeed: boolean;
}

/**
 * Types 0-3 are runtime cameras: the game aims them at the player, so most of the pan fields do
 * nothing. Types 4-6 are the opening pans and use everything.
 */
export function getCameraFieldRelevance(type: number): CameraFieldRelevance {
  const opening = type === 4 || type === 5 || type === 6;
  const routed = type === 2 || type === 5 || type === 6;
  return {
    position: type !== 3,
    rotation: opening,
    route: routed,
    duration: opening,
    nextCamera: opening,
    zoom: opening || type === 0,
    viewEnd: opening,
    moveSpeed: routed,
  };
}

/** What the "view start" point means for this camera type, in the user's words. */
export function getViewStartLabel(type: number): string {
  if (type === 3) return 'Offset from the player';
  if (type === 1) return 'Camera position';
  return 'Looks at (start)';
}

export function getViewStartHint(type: number): string {
  if (type === 3) return 'How far behind and above the player the camera sits, in track units.';
  if (type === 1) return 'Where this camera sits while it watches the player.';
  if (type === 2) return 'Where the camera starts looking before the player takes over the aim.';
  return 'The point the shot looks at when it begins.';
}

export interface CameraTypeOption {
  value: number;
  label: string;
  description: string;
  usage: CameraTypeInfo['usage'];
}

/** Dropdown entries for the type picker, grouped by when the game plays them. */
export const CAMERA_TYPE_OPTIONS: CameraTypeOption[] = CAMERA_TYPES.map((info) => ({
  value: info.id,
  label: `${info.label}`,
  description: info.description,
  usage: info.usage,
}));

export const CAMERA_USAGE_GROUP_LABELS: Record<CameraTypeInfo['usage'], string> = {
  opening: 'Opening pan (played before the race)',
  replay: 'Replay / spectator',
  goal: 'Finish line',
  unused: 'Not used by the game',
};

/** Plain-language hint for each inspector field. */
export const CAMERA_FIELD_HINTS = {
  type: 'What the game does with this camera. Opening pans play before the race; the others follow the player during replays.',
  nextCamera: 'The camera that takes over when this shot ends. "None" ends the pan.',
  route: 'The path the camera slides along while the shot runs. Only route cameras use one.',
  duration: 'How long this shot lasts. The game counts in frames at 60 per second.',
  shake: 'Camera shake. The retail game ignores this, so leave it at 0 unless a mod reads it.',
  startFlag: 'Marks this camera as the first shot of a pan. The chain start below is what the game really reads.',
  movieFlag: 'Legacy "movie" flag. Track authors normally leave this at 0.',
  position: 'Where the camera itself sits, in track units.',
  rotation: 'Which way the camera body faces. The look-at points below decide what is on screen; this mostly sets the roll.',
  zoomStart: 'Field of view in degrees when the shot starts. Smaller is more zoomed in.',
  zoomEnd: 'Field of view in degrees the shot zooms towards.',
  zoomSpeed: 'How fast the zoom changes, in degrees per 100 frames. 0 keeps the starting zoom.',
  viewStart: 'The point the shot looks at when it begins.',
  viewEnd: 'The point the shot pans towards. Set it equal to the start for a still shot.',
  viewSpeed: 'How fast the look-at point slides from start to end, in track units per 100 frames.',
  moveSpeed: 'How fast the camera travels along its route, in track units per 100 frames. Route points can override it.',
} as const;
