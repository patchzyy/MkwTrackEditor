/**
 * Props (free-standing objects) and the object profiles shared with road pieces.
 *
 * Defaults copied (not imported) from the editor's object profiles and measured on the retail
 * tracks: item boxes sit exactly on the road surface, a Goomba walks a two-point back-and-forth
 * route and uses settings `[600, 40, 120]`, and so on.
 */
import type { CreateProject, Prop, Vec3 } from './types';
import type { KmpObject } from '../kmpFile';

export const OBJECT_ID_ITEM_BOX = 0x65;
export const GOBJ_NO_ROUTE = 0xffff;
export const PRESENCE_ALL = 0x3f;

export interface ObjectProfile {
  name: string;
  settings: number[];
  /** Needs a POTI route. `cross` = a back-and-forth walk across the road. */
  route?: 'cross';
  scale?: number;
}

const zeros = () => [0, 0, 0, 0, 0, 0, 0, 0];

export const OBJECT_PROFILES: Record<number, ObjectProfile> = {
  0x65: { name: 'Item box', settings: zeros() },
  0x191: { name: 'Goomba', settings: [600, 40, 120, 0, 0, 0, 0, 0], route: 'cross' },
  0x194: { name: 'Piranha plant', settings: [420, 0, 0, 0, 0, 0, 0, 0], scale: 1.3 },
  0xdb: { name: 'Thwomp', settings: [0, 0, 30, 120, 0, 0, 0, 0] },
  // Space rocks: the third setting must not be 0 or the retail game crashes (retail uses 2000).
  0x214: { name: 'Space rock', settings: [0, 0, 2000, 0, 0, 0, 0, 0] },
  0x215: { name: 'Space rock (big)', settings: [0, 0, 2000, 0, 0, 0, 0, 0] },
};

export function objectProfile(objectId: number): ObjectProfile {
  return OBJECT_PROFILES[objectId] ?? { name: `Object ${objectId}`, settings: zeros() };
}

export function defaultObjectSettings(objectId: number): number[] {
  return [...objectProfile(objectId).settings];
}

export function normalizeSettings(settings: number[] | undefined, objectId: number): number[] {
  const base = settings ? [...settings] : defaultObjectSettings(objectId);
  while (base.length < 8) base.push(0);
  return base.slice(0, 8).map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(0xffff, Math.round(v))) : 0));
}

export function makeObject(
  objectId: number,
  position: Vec3,
  rotation: Vec3,
  scale: Vec3,
  settings: number[] | undefined,
  routeIndex = GOBJ_NO_ROUTE,
): KmpObject {
  return {
    objectId,
    extendedPresence: 0,
    position: { ...position },
    rotation: { ...rotation },
    scale: { ...scale },
    routeIndex,
    settings: normalizeSettings(settings, objectId),
    presenceFlags: PRESENCE_ALL,
  };
}

/** Where the ground is under (x, z), searching from `fromY` downwards. `null` = nothing there. */
export type GroundQuery = (x: number, fromY: number, z: number) => number | null;

/**
 * The props as the track has them: every prop with `snapToGround` is dropped onto the ground that is
 * actually there now (terrain after sculpting, a road, a ramp). Derived from the design, never written
 * back to it, so a prop placed before the ground was sculpted follows the hill up or down. The first query
 * starts just above the prop (so a prop under a bridge stays under it); when the ground has risen past that,
 * the second starts from far above and takes the highest surface.
 */
export function snapProps(project: CreateProject, ground: GroundQuery): Prop[] {
  return project.props.map((prop: Prop) => {
    if (!prop.snapToGround) return prop;
    const { x, y, z } = prop.position;
    const hit = ground(x, y + 400, z) ?? ground(x, 1e5, z);
    if (hit === null || Math.abs(hit - y) < 0.01) return prop;
    return { ...prop, position: { x, y: hit, z } };
  });
}

/** GOBJ records for the free-standing props, snapped to the ground when asked (`snapped`: already derived by `snapProps`). */
export function propObjects(project: CreateProject, ground?: GroundQuery, snapped?: Prop[]): KmpObject[] {
  const props = snapped ?? (ground ? snapProps(project, ground) : project.props);
  return props.map((prop: Prop) => makeObject(prop.objectId, prop.position, prop.rotation, prop.scale, prop.settings));
}
