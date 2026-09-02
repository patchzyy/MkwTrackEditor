// User-facing label and formatting helpers. Extracted from src/ui/App.tsx.
import type { TrackDocument } from '../lib/track';
import type { PlaceableCourseAssetRecord } from '../lib/courseAssets';
import objectNamesById from '../generated/mkwObjectNames.json';

export function friendlySectionLabel(section: string): string {
  switch (section) {
    case 'KTPT':
      return 'Start Points';
    case 'ENPT':
      return 'Enemy Routes';
    case 'ITPT':
      return 'Item Routes';
    case 'CKPT':
      return 'Checkpoints';
    case 'POTI':
      return 'Object Routes';
    case 'CAME':
      return 'Cameras';
    case 'AREA':
      return 'Areas';
    case 'JGPT':
      return 'Respawn Points';
    case 'CNPT':
      return 'Cannon Points';
    case 'MSPT':
      return 'Battle Finish Points';
    case 'STGI':
      return 'Track Settings';
    default:
      return section;
  }
}

export function friendlySectionSingularLabel(section: string): string {
  switch (section) {
    case 'KTPT':
      return 'start point';
    case 'ENPT':
      return 'enemy route point';
    case 'ITPT':
      return 'item route point';
    case 'CKPT':
      return 'checkpoint';
    case 'POTI':
      return 'object route';
    case 'CAME':
      return 'camera';
    case 'AREA':
      return 'area trigger';
    case 'JGPT':
      return 'respawn point';
    case 'CNPT':
      return 'cannon point';
    case 'MSPT':
      return 'battle finish point';
    default:
      return section.toLowerCase();
  }
}

export function friendlyGroupSectionLabel(section: string): string {
  switch (section) {
    case 'ENPH':
      return 'enemy route';
    case 'ITPH':
      return 'item route';
    case 'CKPH':
      return 'checkpoint';
    default:
      return section;
  }
}

export function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : 'nan';
}
export function presentValidationIssue(message: string): { summary: string; detail?: string } {
  if (message === 'course_model.brres is missing.') return { summary: 'The course model is missing.', detail: 'Exported tracks need course geometry to render in-game.' };
  if (message === 'course.kmp is missing.') return { summary: 'The track data file is missing.', detail: 'The course cannot load gameplay objects, paths, or start data without course.kmp.' };
  if (message === 'course.kcl is missing; snapping and collision overlay are unavailable.') return { summary: 'Collision data is missing.', detail: 'Surface snapping and collision-based editing will not work until the track collision data is present.' };
  if (message === 'No start position is defined.') return { summary: 'No player start position is set.' };
  if (message === 'Checkpoints are missing.') return { summary: 'No checkpoints are set.' };
  if (message === 'Respawn points are missing.') return { summary: 'No respawn points are set.', detail: 'Lakitu recoveries will not have a valid place to send the player.' };
  if (message === 'Enemy route points exist without enemy path groups.') return { summary: 'Enemy routes are incomplete.', detail: 'Enemy route points exist, but they are not grouped into usable path sections.' };
  if (message === 'Item route points exist without item path groups.') return { summary: 'Item routes are incomplete.', detail: 'Item route points exist, but they are not grouped into usable path sections.' };
  if (message === 'Checkpoints exist without checkpoint path groups.') return { summary: 'Checkpoint groups are incomplete.', detail: 'The checkpoints exist, but their path-group structure is missing.' };
  if (message.includes('groups cover') && message.includes('points.')) return { summary: 'A route group does not cover all of its points.', detail: message };
  if (message.includes('has points but no path connections.')) return { summary: 'A route has points but no connections.', detail: message };
  if (message.includes('appears disconnected')) return { summary: 'A route appears disconnected.', detail: message };
  if (message.includes('intro start references missing camera')) return { summary: 'The intro camera start is invalid.', detail: message };
  if (message.includes('selection start references missing camera')) return { summary: 'The selection camera start is invalid.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing respawn point')) return { summary: 'A checkpoint points to a respawn that does not exist.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing previous checkpoint')) return { summary: 'A checkpoint previous-link is invalid.', detail: message };
  if (message.startsWith('Checkpoint ') && message.includes('references missing next checkpoint')) return { summary: 'A checkpoint next-link is invalid.', detail: message };
  if (message.startsWith('Object ') && message.includes('requires a route')) return { summary: 'A route-driven object is missing its route.', detail: message };
  if (message.startsWith('Object ') && message.includes('references missing route')) return { summary: 'An object points to a route that does not exist.', detail: message };
  if (message.startsWith('Area ') && message.includes('references missing route')) return { summary: 'An area points to a route that does not exist.', detail: message };
  if (message.startsWith('Area ') && message.includes('references missing camera')) return { summary: 'An area points to a camera that does not exist.', detail: message };
  if (message.startsWith('Camera ') && message.includes('references missing route')) return { summary: 'A camera points to a route that does not exist.', detail: message };
  if (message.startsWith('Camera ') && message.includes('references missing next camera')) return { summary: 'A camera chain points to a camera that does not exist.', detail: message };
  if (message === 'Common.szs is not loaded; object resource validation is unavailable.') return { summary: 'Common object data is not loaded.', detail: 'Object resource checks are limited until the shared game asset archive is available.' };
  if (message.includes('has no ObjFlow definition in Common.szs')) return { summary: 'An object type is missing its shared game definition.', detail: 'The shared game object data does not contain a definition for this object type.' };
  if (message.includes('references missing resource')) return { summary: 'An object is missing one of its required model files.', detail: message };
  if (message.includes('is a gameplay object but is hidden for some multiplayer player counts')) return { summary: 'A gameplay object is hidden in some multiplayer modes.', detail: message };
  if (message.includes('unsupported player item-box setting')) return { summary: 'An item box uses an unsupported player-item setting.', detail: message };
  if (message.includes('unsupported CPU item-box setting')) return { summary: 'An item box uses an unsupported CPU-item setting.', detail: message };
  if (message.includes('unsupported item-box timing setting')) return { summary: 'An item box uses an unsupported timing setting.', detail: message };
  if (message.includes('Monty Mole variants choropu and choropu2 are both present')) return { summary: 'Two incompatible Monty Mole variants are mixed together.', detail: message };
  if (message.includes('has Setting 3 left at 0, which is known to crash vanilla Mario Kart Wii')) return { summary: 'A falling rock still uses a crash-prone setting.', detail: message };
  if (message.includes('Daisy Circuit') || message.includes('MiiObjD')) return { summary: 'A Daisy Circuit crowd object is duplicated.', detail: message };
  if (message.includes('slot-restricted objects')) return { summary: 'This track uses objects that only work on certain vanilla slots.', detail: message };
  if (message.includes('begoman_spike must be the first placed game object')) return { summary: 'A Topman hazard is ordered incorrectly.', detail: message };
  return { summary: message };
}

export function getKnownObjectName(objectId: number | undefined): string | null {
  if (objectId === undefined) return null;
  const raw = (objectNamesById as Record<string, string>)[String(objectId)];
  if (!raw) return null;
  return humanizeObjectName(raw);
}

export function humanizeObjectName(value: string): string {
  const normalized = value
    .trim()
    .replace(/_/g, ' ')
    .replace(/itembox/gi, 'item box')
    .replace(/sticklift/gi, 'stick lift')
    .replace(/firebar/gi, 'fire bar')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/\s+/g, ' ');
  return normalized
    .split(' ')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'npc') return 'NPC';
      if (lower === 'mii') return 'Mii';
      if (lower === 'gc' || lower === 'gba' || lower === 'sfc' || lower === 'ds' || lower === 'wii') return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
export function fallbackObjectName(objectId: number): string {
  return getKnownObjectName(objectId) ?? `Unknown object ${objectId}`;
}
export function shortAssetName(resource: string): string {
  return resource.replace(/\.[^.]+$/, '').replace(/_/g, ' ').slice(0, 18) || 'model';
}

export function friendlyTrackAssetName(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  const lower = fileName.toLowerCase();
  if (lower === 'course_model.brres') return 'Course Model';
  if (lower === 'vrcorn_model.brres') return 'Skybox Model';
  if (lower.endsWith('.brres')) return shortAssetName(fileName);
  return fileName;
}
export function describeCourseAsset(asset: PlaceableCourseAssetRecord): string {
  const kindLabel =
    asset.kind === 'sharedObject'
      ? 'shared object'
      : asset.kind === 'course'
        ? 'course mesh'
        : asset.kind === 'skybox'
        ? 'skybox'
          : 'course asset';
  return asset.objectId !== null ? `${kindLabel} · drag to place · ${asset.trackLabel}` : `${kindLabel} · reference only · ${asset.trackLabel}`;
}

export function describeBrres(summary: TrackDocument['brresSummaries'][string] | undefined): string {
  if (!summary) return '';
  return `${summary.models.length} models · ${summary.textures.length} textures · ${Object.values(summary.animations).flat().length} animations`;
}
