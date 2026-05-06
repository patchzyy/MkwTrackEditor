import type { KmpEntity, Vec3 } from '../lib/kmp';

export interface FillBetweenSelection {
  endpoints: [KmpEntity, KmpEntity];
  objectId: number;
}

export function getFillBetweenSelection(entities: KmpEntity[]): FillBetweenSelection | null {
  if (entities.length !== 2) return null;
  const [first, second] = entities;
  if (first.section !== 'GOBJ' || second.section !== 'GOBJ') return null;
  if (first.objectId === undefined || second.objectId === undefined) return null;
  if (first.objectId !== second.objectId) return null;
  return { endpoints: [first, second], objectId: first.objectId };
}

export function buildFillBetweenPositions(start: Vec3, end: Vec3, count: number): Vec3[] {
  const steps = Math.max(0, Math.trunc(count));
  if (steps === 0) return [];
  const out: Vec3[] = [];
  for (let index = 1; index <= steps; index++) {
    const t = index / (steps + 1);
    out.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    });
  }
  return out;
}
