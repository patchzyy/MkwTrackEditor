// Gravity fields: KMP AREA type 11, the configurable gravity of Retro Rewind (Pulsar,
// rr-pulsar `PulsarEngine/Race/Gravity/`, format documented in its docs/gravity-zones.md).
//
// AREA layout for type 11:
//   shape       0 box / 1 cylinder. Kept valid for the vanilla AREA loader; the gravity volume
//               itself is `enemyIndex`.
//   enemyIndex  (0x2d) volume: 0 box, 1 cylinder, 2 sphere (other values: use `shape`).
//               Path gates (mode 5): AREA index of the next gate, 0xff = end of the chain.
//   routeIndex  (0x2c) field mode, see GravityMode (unknown values behave as parallel).
//   setting1    strength x1000 (1300 = normal gravity, 0 = normal), capped at 10x.
//   setting2    transition frames when entering the field (0 = 10).
//   priority    the higher priority wins where fields overlap.
//   cameraIndex unused, 0xff.
//   flags       (0x2e, u16) GravityFlag bits. A path chain is one field: its flags are the OR of
//               its gates' flags.
//
// Volumes in AREA local space (origin = position, axes from the rotation, s = scale):
//   box      |x| <= 5000 sx, 0 <= y <= 10000 sy, |z| <= 5000 sz
//   cylinder (x / 5000 sx)^2 + (z / 5000 sz)^2 <= 1, 0 <= y <= 10000 sy
//   sphere   ellipsoid centred at (0, 5000 sy, 0) with radii 5000 (sx, sy, sz)
// Path gates: the local XY rectangle |x| <= 5000 sx, 0 <= y <= 10000 sy at z = 0, facing +Z.
// Between linked gates the gate frame is interpolated (origin on a cubic Hermite curve leaving
// and entering along the gates' forward axes, rotation nlerp, size / strength lerp); the swept
// rectangle is the volume and the interpolated local +Y is up.
//
// Everything here mirrors the game code (Gravity.cpp) in game units, so what the viewport draws
// is what the game resolves.

import type { KmpEntity } from './kmp';
import type { Vec3 } from './kmpFile';

export const GRAVITY_AREA_TYPE = 11;
export const GRAVITY_RADIUS = 5000;
export const GRAVITY_HEIGHT = 10000;
export const GRAVITY_PATH_END = 0xff;
export const GRAVITY_NORMAL_STRENGTH = 1300;
export const GRAVITY_DEFAULT_TRANSITION_FRAMES = 10;
const GRAVITY_MAX_SCALE = 10;
const GRAVITY_PATH_BISECT_STEPS = 14;
const GRAVITY_PATH_MIN_SPACING = 1000;

export const GravityVolume = { Box: 0, Cylinder: 1, Sphere: 2 } as const;
export const GravityMode = { Parallel: 0, PointAttract: 1, PointRepel: 2, AxisAttract: 3, AxisRepel: 4, Path: 5 } as const;
export const GravityFlag = { ResetOnExit: 0x1, CameraWorldUp: 0x2 } as const;

export interface GravityOption {
  value: number;
  label: string;
  description: string;
}

export const gravityModeOptions: GravityOption[] = [
  { value: GravityMode.Parallel, label: 'Parallel', description: "Pulls along the AREA's local -Y. Rotate the AREA to aim it: walls, ceilings, ramps." },
  { value: GravityMode.PointAttract, label: 'Planet', description: 'Pulls toward the centre of the volume. Drive around the outside of a planet.' },
  { value: GravityMode.PointRepel, label: 'Inside sphere', description: 'Pushes away from the centre of the volume. Drive on the inside of a sphere.' },
  { value: GravityMode.AxisAttract, label: 'Outside tube', description: "Pulls toward the AREA's local Y axis. Drive around the outside of a tube." },
  { value: GravityMode.AxisRepel, label: 'Inside tube', description: "Pushes away from the AREA's local Y axis. Drive on the inside of a tube or a loop-the-loop." },
  { value: GravityMode.Path, label: 'Path (gates)', description: 'Each AREA is a gate (its local XY rectangle, local -Y is down). Linked gates form one smooth field that twists between them: corkscrews, loops, banked ribbons.' },
];

export const gravityVolumeOptions: GravityOption[] = [
  { value: GravityVolume.Box, label: 'Box', description: 'Box from the AREA origin up to 10000 x scale Y.' },
  { value: GravityVolume.Cylinder, label: 'Cylinder', description: 'Upright cylinder along the local Y axis.' },
  { value: GravityVolume.Sphere, label: 'Sphere', description: 'Ellipsoid centred halfway up the AREA.' },
];

export const gravityResetOptions: GravityOption[] = [
  { value: 0, label: 'On landing', description: 'Airborne karts keep this gravity until they land, even outside the volume, so jumps feel like jumps off normal road.' },
  { value: GravityFlag.ResetOnExit, label: 'On leaving', description: 'Gravity lets go as soon as a kart leaves the volume, even in the air. Use it where a jump should end in normal gravity.' },
];

export const gravityCameraOptions: GravityOption[] = [
  { value: 0, label: 'Follow gravity', description: 'The camera turns with the gravity, so the road ahead always looks level.' },
  { value: GravityFlag.CameraWorldUp, label: 'Stay upright', description: 'The camera keeps world Y up the whole time, even while the kart drives on a wall or ceiling.' },
];

/** RGB per field mode, shared by the viewport overlay and the inspector swatch. */
export const gravityModeColors: Record<number, [number, number, number]> = {
  [GravityMode.Parallel]: [0.27, 0.86, 0.78],
  [GravityMode.PointAttract]: [1.0, 0.64, 0.26],
  [GravityMode.PointRepel]: [1.0, 0.44, 0.64],
  [GravityMode.AxisAttract]: [0.66, 0.52, 1.0],
  [GravityMode.AxisRepel]: [0.38, 0.66, 1.0],
  [GravityMode.Path]: [0.58, 0.95, 0.42],
};

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** The AREA fields gravity needs; `index` is the AREA index (what gate links refer to). */
export interface GravityAreaRecord {
  index: number;
  type: number;
  shape: number;
  priority: number;
  setting1: number;
  setting2: number;
  routeIndex: number;
  enemyIndex: number;
  flags: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface GravityTransformOverride {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

export function gravityRecordFromEntity(entity: KmpEntity, override?: GravityTransformOverride): GravityAreaRecord | null {
  if (entity.section !== 'AREA' || !entity.area) return null;
  return {
    index: entity.index,
    type: entity.area.type,
    shape: entity.area.shape,
    priority: entity.area.priority,
    setting1: entity.area.setting1,
    setting2: entity.area.setting2,
    routeIndex: entity.area.routeIndex,
    enemyIndex: entity.area.enemyIndex,
    flags: entity.area.flags,
    position: override?.position ?? entity.position,
    rotation: override?.rotation ?? entity.rotation ?? { x: 0, y: 0, z: 0 },
    scale: override?.scale ?? entity.scale ?? { x: 1, y: 1, z: 1 },
  };
}

/** Every AREA record (gravity or not), in AREA order, so gate links can be resolved by index. */
export function gravityRecordsFromEntities(entities: readonly KmpEntity[], overrides?: ReadonlyMap<number, GravityTransformOverride>): GravityAreaRecord[] {
  const records: GravityAreaRecord[] = [];
  for (const entity of entities) {
    const record = gravityRecordFromEntity(entity, entity.section === 'AREA' ? overrides?.get(entity.index) : undefined);
    if (record) records[record.index] = record;
  }
  return records;
}

export function isGravityArea(record: Pick<GravityAreaRecord, 'type'>): boolean {
  return record.type === GRAVITY_AREA_TYPE;
}

export function isGravityPathGate(record: Pick<GravityAreaRecord, 'type' | 'routeIndex'>): boolean {
  return record.type === GRAVITY_AREA_TYPE && record.routeIndex === GravityMode.Path;
}

/** Effective mode: 0..5, anything else behaves as parallel (like the game). */
export function getGravityMode(record: Pick<GravityAreaRecord, 'routeIndex'>): number {
  return record.routeIndex <= GravityMode.Path ? record.routeIndex : GravityMode.Parallel;
}

/** Effective volume of a non-path field: 0 box, 1 cylinder, 2 sphere. */
export function getGravityVolume(record: Pick<GravityAreaRecord, 'enemyIndex' | 'shape'>): number {
  if (record.enemyIndex <= GravityVolume.Sphere) return record.enemyIndex;
  return record.shape === 1 ? GravityVolume.Cylinder : GravityVolume.Box;
}

/** Strength multiplier (1 = normal gravity), as the game computes it. */
export function getGravityScale(setting1: number): number {
  if (setting1 === 0) return 1;
  return Math.min(setting1 / GRAVITY_NORMAL_STRENGTH, GRAVITY_MAX_SCALE);
}

export function getGravityTransitionFrames(setting2: number): number {
  return Math.min(setting2 === 0 ? GRAVITY_DEFAULT_TRANSITION_FRAMES : setting2, 600);
}

// ---------------------------------------------------------------------------
// Math (plain objects, game space)
// ---------------------------------------------------------------------------

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
function normalize(a: Vec3): Vec3 | null {
  const len = length(a);
  return len * len > 1e-12 ? scale(a, 1 / len) : null;
}
/** a + x * ax + y * ay + z * az */
function local(o: Vec3, axes: GravityAxes, x: number, y: number, z: number): Vec3 {
  return v(
    o.x + axes.x.x * x + axes.y.x * y + axes.z.x * z,
    o.y + axes.x.y * x + axes.y.y * y + axes.z.y * z,
    o.z + axes.x.z * x + axes.y.z * y + axes.z.z * z,
  );
}

/** EGG::Quatf::fromRPY (degrees): R = Rz * Ry * Rx, which is how the game builds AREA axes. */
export function quatFromRotation(rotationDeg: Vec3): Quat {
  const d = Math.PI / 360;
  const cx = Math.cos(rotationDeg.x * d), sx = Math.sin(rotationDeg.x * d);
  const cy = Math.cos(rotationDeg.y * d), sy = Math.sin(rotationDeg.y * d);
  const cz = Math.cos(rotationDeg.z * d), sz = Math.sin(rotationDeg.z * d);
  return {
    w: cz * cy * cx + sz * sy * sx,
    x: cz * cy * sx - sz * sy * cx,
    y: cz * sy * cx + sz * cy * sx,
    z: sz * cy * cx - cz * sy * sx,
  };
}

export function quatRotate(q: Quat, a: Vec3): Vec3 {
  const tx = 2 * (q.y * a.z - q.z * a.y);
  const ty = 2 * (q.z * a.x - q.x * a.z);
  const tz = 2 * (q.x * a.y - q.y * a.x);
  return v(
    a.x + q.w * tx + (q.y * tz - q.z * ty),
    a.y + q.w * ty + (q.z * tx - q.x * tz),
    a.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}

function quatNlerp(a: Quat, b: Quat, t: number): Quat {
  const s = 1 - t;
  const q = { x: a.x * s + b.x * t, y: a.y * s + b.y * t, z: a.z * s + b.z * t, w: a.w * s + b.w * t };
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len <= 1e-12) return a;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** The gate turned 180 degrees about its local Y (q * (0, 1, 0, 0)), like Gravity.cpp FlipGate. */
function flipQuat(q: Quat): Quat {
  return { x: -q.z, y: q.w, z: q.x, w: -q.y };
}

export interface GravityAxes {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

function axesOfQuat(q: Quat): GravityAxes {
  return { x: quatRotate(q, v(1, 0, 0)), y: quatRotate(q, v(0, 1, 0)), z: quatRotate(q, v(0, 0, 1)) };
}

/** The AREA's local axes in game space (unit vectors). */
export function getAreaAxes(rotationDeg: Vec3): GravityAxes {
  return axesOfQuat(quatFromRotation(rotationDeg));
}

// ---------------------------------------------------------------------------
// Regular fields (modes 0-4)
// ---------------------------------------------------------------------------

export interface GravityVolumeFrame {
  origin: Vec3;
  axes: GravityAxes;
  halfX: number;
  halfY: number;
  halfZ: number;
  /** Local (0, halfY, 0): the volume centre / point-mode centre. */
  center: Vec3;
}

export function getGravityVolumeFrame(record: GravityAreaRecord): GravityVolumeFrame | null {
  const halfX = GRAVITY_RADIUS * Math.abs(record.scale.x);
  const halfY = GRAVITY_RADIUS * Math.abs(record.scale.y);
  const halfZ = GRAVITY_RADIUS * Math.abs(record.scale.z);
  if (!(halfX > 0 && halfY > 0 && halfZ > 0)) return null;
  const axes = getAreaAxes(record.rotation);
  return { origin: record.position, axes, halfX, halfY, halfZ, center: local(record.position, axes, 0, halfY, 0) };
}

function volumeContains(frame: GravityVolumeFrame, volume: number, pos: Vec3): boolean {
  const d = sub(pos, frame.center);
  const lx = dot(d, frame.axes.x) / frame.halfX;
  const ly = dot(d, frame.axes.y) / frame.halfY;
  const lz = dot(d, frame.axes.z) / frame.halfZ;
  if (volume === GravityVolume.Cylinder) return ly >= -1 && ly <= 1 && lx * lx + lz * lz <= 1;
  if (volume === GravityVolume.Sphere) return lx * lx + ly * ly + lz * lz <= 1;
  return Math.abs(lx) <= 1 && Math.abs(ly) <= 1 && Math.abs(lz) <= 1;
}

/** Gravity up of a regular field at pos (Gravity.cpp FieldAt). */
function volumeUp(frame: GravityVolumeFrame, mode: number, pos: Vec3): Vec3 {
  let d: Vec3;
  if (mode === GravityMode.PointAttract || mode === GravityMode.PointRepel) {
    d = sub(pos, frame.center);
  } else if (mode === GravityMode.AxisAttract || mode === GravityMode.AxisRepel) {
    d = sub(pos, frame.origin);
    d = sub(d, scale(frame.axes.y, dot(d, frame.axes.y)));
  } else {
    return frame.axes.y;
  }
  const n = normalize(d);
  if (!n) return frame.axes.y;
  return mode === GravityMode.PointRepel || mode === GravityMode.AxisRepel ? scale(n, -1) : n;
}

// ---------------------------------------------------------------------------
// Path chains (mode 5)
// ---------------------------------------------------------------------------

export interface GravityGateFrame {
  index: number;
  origin: Vec3;
  /** Rotation, already turned to face along the chain. */
  q: Quat;
  axes: GravityAxes;
  halfWidth: number;
  height: number;
  scale: number;
  /** True when the gate was turned around to face along its chain. */
  flipped: boolean;
}

/** Valid next gate of the gate at index (a different path gate), or -1. */
export function getGravityNextGate(records: readonly (GravityAreaRecord | undefined)[], index: number): number {
  const gate = records[index];
  if (!gate || !isGravityPathGate(gate)) return -1;
  const next = gate.enemyIndex;
  if (next === GRAVITY_PATH_END || next === index) return -1;
  const target = records[next];
  return target && isGravityPathGate(target) ? next : -1;
}

/** Valid links [from, to] between path gates. */
export function getGravityPathLinks(records: readonly (GravityAreaRecord | undefined)[]): Array<[number, number]> {
  const links: Array<[number, number]> = [];
  records.forEach((record, index) => {
    if (!record) return;
    const next = getGravityNextGate(records, index);
    if (next >= 0) links.push([index, next]);
  });
  return links;
}

/** Path gates grouped into chains (connected through links). Each chain is one field. */
export function getGravityPathChains(records: readonly (GravityAreaRecord | undefined)[]): number[][] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(i) !== root) {
      const up = parent.get(i)!;
      parent.set(i, root);
      i = up;
    }
    return root;
  };
  records.forEach((record, index) => {
    if (record && isGravityPathGate(record)) parent.set(index, index);
  });
  for (const [from, to] of getGravityPathLinks(records)) {
    const a = find(from);
    const b = find(to);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const chains = new Map<number, number[]>();
  for (const index of [...parent.keys()].sort((a, b) => a - b)) {
    const root = find(index);
    if (!chains.has(root)) chains.set(root, []);
    chains.get(root)!.push(index);
  }
  return [...chains.values()];
}

/** The chain (sorted AREA indices) a path gate belongs to, or [index] for anything else. */
export function getGravityChainOf(records: readonly (GravityAreaRecord | undefined)[], index: number): number[] {
  return getGravityPathChains(records).find((chain) => chain.includes(index)) ?? [index];
}

/** Gate frames of all valid path gates, each facing along its chain (Gravity.cpp BuildZones). */
export function getGravityGateFrames(records: readonly (GravityAreaRecord | undefined)[]): Map<number, GravityGateFrame> {
  const frames = new Map<number, GravityGateFrame>();
  records.forEach((record, index) => {
    if (!record || !isGravityPathGate(record)) return;
    const halfWidth = GRAVITY_RADIUS * Math.abs(record.scale.x);
    const height = GRAVITY_HEIGHT * Math.abs(record.scale.y);
    if (!(halfWidth > 0 && height > 0)) return;
    const q = quatFromRotation(record.rotation);
    frames.set(index, { index, origin: record.position, q, axes: axesOfQuat(q), halfWidth, height, scale: getGravityScale(record.setting1), flipped: false });
  });
  const links = getGravityPathLinks(records).filter(([from, to]) => frames.has(from) && frames.has(to));
  const chainDir = new Map<number, Vec3>();
  for (const [from, to] of links) {
    const d = normalize(sub(frames.get(to)!.origin, frames.get(from)!.origin));
    if (!d) continue;
    chainDir.set(from, add(chainDir.get(from) ?? v(0, 0, 0), d));
    chainDir.set(to, add(chainDir.get(to) ?? v(0, 0, 0), d));
  }
  for (const [index, frame] of frames) {
    const dir = chainDir.get(index);
    if (dir && dot(frame.axes.z, dir) < 0) {
      const q = flipQuat(frame.q);
      frames.set(index, { ...frame, q, axes: axesOfQuat(q), flipped: true });
    }
  }
  return frames;
}

/** One linked gate pair. */
export interface GravityPathSegment {
  from: number;
  to: number;
  a: GravityGateFrame;
  b: GravityGateFrame;
  q1: Quat;
  m0: Vec3;
  m1: Vec3;
}

export function getGravityPathSegment(a: GravityGateFrame, b: GravityGateFrame): GravityPathSegment {
  let q1 = b.q;
  if (a.q.x * q1.x + a.q.y * q1.y + a.q.z * q1.z + a.q.w * q1.w < 0) q1 = { x: -q1.x, y: -q1.y, z: -q1.z, w: -q1.w };
  // Hermite tangents along the gates' forward axes, length chord * 2 / (1 + cos(theta / 2)):
  // exact circular arcs for planar turns.
  const chord = sub(b.origin, a.origin);
  const len = length(chord);
  let d0 = a.axes.z;
  let d1 = b.axes.z;
  if (dot(d0, chord) < 0) d0 = scale(d0, -1);
  if (dot(d1, chord) < 0) d1 = scale(d1, -1);
  const c = Math.max(-1, Math.min(1, dot(d0, d1)));
  const k = 2 / (1 + Math.sqrt(0.5 * (1 + c)));
  return { from: a.index, to: b.index, a, b, q1, m0: scale(d0, len * k), m1: scale(d1, len * k) };
}

export interface GravityPathFrame {
  origin: Vec3;
  axes: GravityAxes;
  halfWidth: number;
  height: number;
  scale: number;
}

/** Interpolated gate frame at t in [0, 1]. */
export function getGravityPathFrame(segment: GravityPathSegment, t: number): GravityPathFrame {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const { a, b } = segment;
  const origin = add(add(scale(a.origin, h00), scale(segment.m0, h10)), add(scale(b.origin, h01), scale(segment.m1, h11)));
  return {
    origin,
    axes: axesOfQuat(quatNlerp(a.q, segment.q1, t)),
    halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    height: a.height + (b.height - a.height) * t,
    scale: a.scale + (b.scale - a.scale) * t,
  };
}

/** Where pos lies in the segment: null if not between the two gate planes. */
export function locateInGravityPathSegment(segment: GravityPathSegment, pos: Vec3): { t: number; x: number; y: number; inside: boolean; frame: GravityPathFrame } | null {
  const plane = (t: number) => {
    const frame = getGravityPathFrame(segment, t);
    return dot(sub(pos, frame.origin), frame.axes.z);
  };
  const f0 = plane(0);
  const f1 = plane(1);
  let t: number;
  if (f0 === 0) t = 0;
  else if (f1 === 0) t = 1;
  else if (f0 > 0 === f1 > 0) return null;
  else {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < GRAVITY_PATH_BISECT_STEPS; i++) {
      const mid = 0.5 * (lo + hi);
      if (plane(mid) > 0 === f0 > 0) lo = mid;
      else hi = mid;
    }
    t = 0.5 * (lo + hi);
  }
  const frame = getGravityPathFrame(segment, t);
  const d = sub(pos, frame.origin);
  const x = dot(d, frame.axes.x);
  const y = dot(d, frame.axes.y);
  return { t, x, y, inside: Math.abs(x) <= frame.halfWidth && y >= 0 && y <= frame.height, frame };
}

// ---------------------------------------------------------------------------
// Resolution (what the game picks at a position)
// ---------------------------------------------------------------------------

export interface GravityFieldInfo {
  /** Field identity: the AREA index, or the smallest gate index for a path chain. */
  id: number;
  mode: number;
  priority: number;
  flags: number;
  /** AREA indices that make up the field (one, or a whole chain). */
  areas: number[];
}

export interface GravitySample {
  field: GravityFieldInfo;
  up: Vec3;
  scale: number;
}

interface ResolvedZone {
  field: GravityFieldInfo;
  contains: (pos: Vec3) => boolean;
  sample: (pos: Vec3) => { up: Vec3; scale: number };
}

/** The game's zone list: regular fields in AREA order, then path segments in gate order. */
function resolveZones(records: readonly (GravityAreaRecord | undefined)[]): ResolvedZone[] {
  const zones: ResolvedZone[] = [];
  records.forEach((record, index) => {
    if (!record || !isGravityArea(record) || isGravityPathGate(record)) return;
    const frame = getGravityVolumeFrame(record);
    if (!frame) return;
    const mode = getGravityMode(record);
    const volume = getGravityVolume(record);
    const fieldScale = getGravityScale(record.setting1);
    zones.push({
      field: { id: index, mode, priority: record.priority, flags: record.flags & 0xff, areas: [index] },
      contains: (pos) => volumeContains(frame, volume, pos),
      sample: (pos) => ({ up: volumeUp(frame, mode, pos), scale: fieldScale }),
    });
  });
  const frames = getGravityGateFrames(records);
  const chains = getGravityPathChains(records);
  for (const [from] of [...frames].sort(([a], [b]) => a - b)) {
    const to = getGravityNextGate(records, from);
    if (to < 0 || !frames.has(to)) continue;
    const segment = getGravityPathSegment(frames.get(from)!, frames.get(to)!);
    const chain = chains.find((candidate) => candidate.includes(from)) ?? [from];
    const flags = chain.reduce((acc, i) => acc | (records[i]?.flags ?? 0), 0) & 0xff;
    zones.push({
      field: { id: Math.min(...chain), mode: GravityMode.Path, priority: records[from]!.priority, flags, areas: chain },
      contains: (pos) => locateInGravityPathSegment(segment, pos)?.inside ?? false,
      sample: (pos) => {
        const hit = locateInGravityPathSegment(segment, pos);
        const frame = hit?.frame ?? getGravityPathFrame(segment, 0);
        return { up: frame.axes.y, scale: frame.scale };
      },
    });
  }
  return zones;
}

/** The field the game applies at pos (highest priority, ties: lowest zone order), or null. */
export function sampleGravity(records: readonly (GravityAreaRecord | undefined)[], pos: Vec3): GravitySample | null {
  let best: ResolvedZone | null = null;
  for (const zone of resolveZones(records)) {
    if (best && zone.field.priority <= best.field.priority) continue;
    if (zone.contains(pos)) best = zone;
  }
  if (!best) return null;
  const { up, scale: fieldScale } = best.sample(pos);
  return { field: best.field, up, scale: fieldScale };
}

// ---------------------------------------------------------------------------
// Edits: field patches the inspector applies (several AREAs at once for chains)
// ---------------------------------------------------------------------------

export type GravityAreaField = 'type' | 'shape' | 'cameraIndex' | 'setting1' | 'setting2' | 'routeIndex' | 'enemyIndex' | 'flags';

export interface GravityAreaPatch {
  index: number;
  field: GravityAreaField;
  value: number;
}

/** Changing an AREA's type: entering type 11 applies gravity defaults, leaving clears its fields. */
export function planAreaTypeChange(record: GravityAreaRecord, type: number): GravityAreaPatch[] {
  const index = record.index;
  const patches: GravityAreaPatch[] = [{ index, field: 'type', value: type }];
  if (type === GRAVITY_AREA_TYPE && !isGravityArea(record)) {
    const cylinder = record.shape === 1;
    patches.push(
      { index, field: 'shape', value: cylinder ? 1 : 0 },
      { index, field: 'routeIndex', value: GravityMode.Parallel },
      { index, field: 'enemyIndex', value: cylinder ? GravityVolume.Cylinder : GravityVolume.Box },
      { index, field: 'setting1', value: GRAVITY_NORMAL_STRENGTH },
      { index, field: 'setting2', value: GRAVITY_DEFAULT_TRANSITION_FRAMES },
      { index, field: 'cameraIndex', value: 0xff },
      { index, field: 'flags', value: 0 },
    );
  } else if (type !== GRAVITY_AREA_TYPE && isGravityArea(record)) {
    patches.push(
      { index, field: 'routeIndex', value: 0xff },
      { index, field: 'enemyIndex', value: 0xff },
      { index, field: 'flags', value: 0 },
    );
  }
  return patches;
}

/** Changing the mode; entering / leaving path mode swaps enemyIndex between gate link and volume. */
export function planGravityModeChange(record: GravityAreaRecord, mode: number): GravityAreaPatch[] {
  const index = record.index;
  const patches: GravityAreaPatch[] = [{ index, field: 'routeIndex', value: mode }];
  const wasPath = isGravityPathGate(record);
  if (mode === GravityMode.Path && !wasPath) {
    patches.push({ index, field: 'enemyIndex', value: GRAVITY_PATH_END }, { index, field: 'shape', value: 0 });
  } else if (mode !== GravityMode.Path && wasPath) {
    patches.push({ index, field: 'enemyIndex', value: GravityVolume.Box }, { index, field: 'shape', value: 0 });
  }
  return patches;
}

/** Volume of a regular field; the native shape follows so vanilla still loads the AREA. */
export function planGravityVolumeChange(record: GravityAreaRecord, volume: number): GravityAreaPatch[] {
  if (isGravityPathGate(record)) return [];
  return [
    { index: record.index, field: 'enemyIndex', value: volume },
    { index: record.index, field: 'shape', value: volume === GravityVolume.Box ? 0 : 1 },
  ];
}

/** Links a gate to the next one (anything invalid, e.g. itself or a non-gate, ends the chain). */
export function planGravityNextGate(records: readonly (GravityAreaRecord | undefined)[], record: GravityAreaRecord, next: number): GravityAreaPatch[] {
  if (!isGravityPathGate(record)) return [];
  const target = records[next];
  const valid = next !== record.index && !!target && isGravityPathGate(target);
  return [{ index: record.index, field: 'enemyIndex', value: valid ? next : GRAVITY_PATH_END }];
}

/** Sets one flag bit; every gate of a path chain gets the same value (the chain is one field). */
export function planGravityFlagChange(records: readonly (GravityAreaRecord | undefined)[], record: GravityAreaRecord, flag: number, on: boolean): GravityAreaPatch[] {
  const targets = isGravityPathGate(record) ? getGravityChainOf(records, record.index) : [record.index];
  return targets.flatMap((index) => {
    const target = records[index];
    if (!target) return [];
    const value = ((target.flags & ~flag) | (on ? flag : 0)) & 0xffff;
    return value === target.flags ? [] : [{ index, field: 'flags' as const, value }];
  });
}

/** Effective flag of an AREA: for path gates, set if any gate of the chain has it (like the game). */
export function getGravityEffectiveFlag(records: readonly (GravityAreaRecord | undefined)[], record: GravityAreaRecord, flag: number): boolean {
  const targets = isGravityPathGate(record) ? getGravityChainOf(records, record.index) : [record.index];
  return targets.some((index) => ((records[index]?.flags ?? 0) & flag) !== 0);
}

/** Gate links pointing at AREA `removed` end the chain; later AREAs move down by one. */
export function planGravityLinksAfterAreaRemoval(records: readonly (GravityAreaRecord | undefined)[], removed: number): GravityAreaPatch[] {
  const patches: GravityAreaPatch[] = [];
  records.forEach((record, index) => {
    if (!record || !isGravityPathGate(record) || record.enemyIndex === GRAVITY_PATH_END) return;
    if (record.enemyIndex === removed) patches.push({ index, field: 'enemyIndex', value: GRAVITY_PATH_END });
    else if (record.enemyIndex > removed) patches.push({ index, field: 'enemyIndex', value: record.enemyIndex - 1 });
  });
  return patches;
}

/** Gate links follow two AREAs that swapped places. */
export function planGravityLinksAfterAreaSwap(records: readonly (GravityAreaRecord | undefined)[], a: number, b: number): GravityAreaPatch[] {
  const patches: GravityAreaPatch[] = [];
  records.forEach((record, index) => {
    if (!record || !isGravityPathGate(record)) return;
    if (record.enemyIndex === a) patches.push({ index, field: 'enemyIndex', value: b });
    else if (record.enemyIndex === b) patches.push({ index, field: 'enemyIndex', value: a });
  });
  return patches;
}

/**
 * Placement of a new gate added after `index`: one gate spacing further along the chain,
 * halfway to the current next gate at most. The new gate takes over the old link.
 */
export function planGravityChainExtension(records: readonly (GravityAreaRecord | undefined)[], index: number): { position: Vec3; next: number } | null {
  const gate = records[index];
  if (!gate || !isGravityPathGate(gate)) return null;
  const frames = getGravityGateFrames(records);
  const frame = frames.get(index);
  const forward = frame ? frame.axes.z : getAreaAxes(gate.rotation).z;
  const halfWidth = GRAVITY_RADIUS * Math.abs(gate.scale.x);
  const next = getGravityNextGate(records, index);
  let spacing = Math.max(2 * halfWidth, GRAVITY_PATH_MIN_SPACING);
  if (next >= 0) spacing = Math.min(spacing, length(sub(records[next]!.position, gate.position)) / 2);
  return { position: add(gate.position, scale(forward, spacing)), next: next >= 0 ? next : GRAVITY_PATH_END };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface GravityIssue {
  index: number;
  message: string;
}

export function findGravityIssues(records: readonly (GravityAreaRecord | undefined)[]): GravityIssue[] {
  const issues: GravityIssue[] = [];
  const frames = getGravityGateFrames(records);
  records.forEach((record, index) => {
    if (!record || !isGravityArea(record)) return;
    if (record.routeIndex > GravityMode.Path && record.routeIndex !== 0xff) issues.push({ index, message: `Unknown gravity field mode ${record.routeIndex}; the game treats it as parallel.` });
    if (!isGravityPathGate(record)) {
      if (!getGravityVolumeFrame(record)) issues.push({ index, message: 'This gravity field has a zero scale, so the game ignores it.' });
      return;
    }
    if (!frames.has(index)) {
      issues.push({ index, message: 'This gravity gate has a zero width or height, so the game ignores it.' });
      return;
    }
    const link = record.enemyIndex;
    if (link !== GRAVITY_PATH_END && getGravityNextGate(records, index) < 0) {
      issues.push({ index, message: link === index ? 'This gravity gate links to itself; the chain ends here.' : `This gravity gate links to area ${link + 1}, which is not a path gate; the chain ends here.` });
    }
    const next = getGravityNextGate(records, index);
    if (next >= 0 && frames.has(next)) {
      const a = frames.get(index)!;
      const b = frames.get(next)!;
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(a.axes.y, b.axes.y)))) * (180 / Math.PI);
      if (turn > 95) issues.push({ index, message: `The up direction turns ${Math.round(turn)} degrees from this gate to the next one. Add a gate in between (keep it under ~90 degrees per link).` });
    }
  });
  const hasLink = new Set(getGravityPathLinks(records).flat());
  frames.forEach((_frame, index) => {
    if (!hasLink.has(index)) issues.push({ index, message: 'This gravity gate is not linked to any other gate, so it has no volume. Link it with "Next gate".' });
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Viewport overlay geometry (game units; the scene applies its own render scale)
// ---------------------------------------------------------------------------

export type GravityRgba = [number, number, number, number];

export interface GravityOverlayLine {
  a: Vec3;
  b: Vec3;
  color: GravityRgba;
}

export interface GravityOverlayTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  color: GravityRgba;
}

/** A polyline gravity flows along (start -> end); the scene animates arrowheads along it. */
export interface GravityOverlayFlow {
  points: Vec3[];
  color: GravityRgba;
  /** Arrowhead size in game units. */
  arrowSize: number;
  /** Phase offset in [0, 1), so neighbouring streams don't pulse in lockstep. */
  phase: number;
}

export interface GravityOverlayLabel {
  position: Vec3;
  text: string;
  color: GravityRgba;
}

export interface GravityOverlay {
  lines: GravityOverlayLine[];
  triangles: GravityOverlayTriangle[];
  flows: GravityOverlayFlow[];
  labels: GravityOverlayLabel[];
}

export interface GravityOverlayOptions {
  /** AREA indices that are selected / hovered: their whole field is emphasised. */
  selected?: ReadonlySet<number>;
  hovered?: number | null;
}

interface FieldStyle {
  outline: GravityRgba;
  fill: GravityRgba;
  flow: GravityRgba;
  guide: GravityRgba;
  emphasised: boolean;
}

function fieldStyle(mode: number, selected: boolean, hovered: boolean): FieldStyle {
  const [r, g, b] = gravityModeColors[mode] ?? gravityModeColors[GravityMode.Parallel];
  const lift = selected ? 0.18 : hovered ? 0.1 : 0;
  const c = (x: number) => Math.min(1, x + lift);
  const rgb: [number, number, number] = [c(r), c(g), c(b)];
  if (selected) return { outline: [...rgb, 0.95], fill: [...rgb, 0.1], flow: [...rgb, 0.95], guide: [...rgb, 0.3], emphasised: true };
  if (hovered) return { outline: [...rgb, 0.8], fill: [...rgb, 0.07], flow: [...rgb, 0.8], guide: [...rgb, 0.22], emphasised: true };
  return { outline: [...rgb, 0.42], fill: [...rgb, 0.035], flow: [...rgb, 0.55], guide: [...rgb, 0.12], emphasised: false };
}

function fieldLabel(field: Pick<GravityFieldInfo, 'mode' | 'flags'>, strength: number, extra?: string): string {
  const mode = gravityModeOptions.find((option) => option.value === field.mode)?.label ?? 'Parallel';
  const parts = [`Gravity: ${mode}`];
  if (Math.abs(strength - 1) > 1e-3) parts.push(`${Math.round(strength * 100)}%`);
  if (extra) parts.push(extra);
  if (field.flags & GravityFlag.ResetOnExit) parts.push('resets on exit');
  if (field.flags & GravityFlag.CameraWorldUp) parts.push('upright camera');
  return parts.join(' / ');
}

const RING_SEGMENTS = 32;

function ring(out: GravityOverlay, at: (theta: number) => Vec3, color: GravityRgba, segments = RING_SEGMENTS): void {
  let prev = at(0);
  for (let i = 1; i <= segments; i++) {
    const p = at((i / segments) * Math.PI * 2);
    out.lines.push({ a: prev, b: p, color });
    prev = p;
  }
}

function quad(out: GravityOverlay, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: GravityRgba): void {
  out.triangles.push({ a, b, c, color }, { a, b: c, c: d, color });
}

function drawRegularField(out: GravityOverlay, record: GravityAreaRecord, frame: GravityVolumeFrame, style: FieldStyle): void {
  const mode = getGravityMode(record);
  const volume = getGravityVolume(record);
  const { axes, origin, halfX: rx, halfY: ry, halfZ: rz } = frame;
  const H = 2 * ry;
  const P = (x: number, y: number, z: number) => local(origin, axes, x, y, z);

  // Volume outline (+ faint shell)
  if (volume === GravityVolume.Box) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      out.lines.push({ a: P(x0 * rx, 0, z0 * rz), b: P(x1 * rx, 0, z1 * rz), color: style.outline });
      out.lines.push({ a: P(x0 * rx, H, z0 * rz), b: P(x1 * rx, H, z1 * rz), color: style.outline });
      out.lines.push({ a: P(x0 * rx, 0, z0 * rz), b: P(x0 * rx, H, z0 * rz), color: style.outline });
      if (style.emphasised) quad(out, P(x0 * rx, 0, z0 * rz), P(x1 * rx, 0, z1 * rz), P(x1 * rx, H, z1 * rz), P(x0 * rx, H, z0 * rz), style.fill);
    }
    if (style.emphasised) {
      quad(out, P(-rx, 0, -rz), P(rx, 0, -rz), P(rx, 0, rz), P(-rx, 0, rz), style.fill);
      quad(out, P(-rx, H, -rz), P(rx, H, -rz), P(rx, H, rz), P(-rx, H, rz), style.fill);
    }
  } else if (volume === GravityVolume.Cylinder) {
    ring(out, (t) => P(Math.cos(t) * rx, 0, Math.sin(t) * rz), style.outline);
    ring(out, (t) => P(Math.cos(t) * rx, H, Math.sin(t) * rz), style.outline);
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2;
      out.lines.push({ a: P(Math.cos(t) * rx, 0, Math.sin(t) * rz), b: P(Math.cos(t) * rx, H, Math.sin(t) * rz), color: style.outline });
    }
    if (style.emphasised) {
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const t0 = (i / RING_SEGMENTS) * Math.PI * 2;
        const t1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
        quad(out, P(Math.cos(t0) * rx, 0, Math.sin(t0) * rz), P(Math.cos(t1) * rx, 0, Math.sin(t1) * rz), P(Math.cos(t1) * rx, H, Math.sin(t1) * rz), P(Math.cos(t0) * rx, H, Math.sin(t0) * rz), style.fill);
      }
    }
  } else {
    ring(out, (t) => P(Math.cos(t) * rx, ry, Math.sin(t) * rz), style.outline, 48);
    ring(out, (t) => P(Math.cos(t) * rx, ry + Math.sin(t) * ry, 0), style.outline, 48);
    ring(out, (t) => P(0, ry + Math.sin(t) * ry, Math.cos(t) * rz), style.outline, 48);
    if (style.emphasised) {
      const lat = 10;
      const lon = 20;
      const S = (i: number, j: number) => {
        const phi = (i / lat) * Math.PI - Math.PI / 2;
        const theta = (j / lon) * Math.PI * 2;
        return P(Math.cos(phi) * Math.cos(theta) * rx, ry + Math.sin(phi) * ry, Math.cos(phi) * Math.sin(theta) * rz);
      };
      for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) quad(out, S(i, j), S(i, j + 1), S(i + 1, j + 1), S(i + 1, j), style.fill);
    }
  }

  // Gravity flow (arrows point along gravity, i.e. "down")
  const arrowSize = Math.max(250, Math.min(rx, ry, rz) * 0.12);
  const flow = (from: Vec3, to: Vec3, phase: number) => {
    out.flows.push({ points: [from, to], color: style.flow, arrowSize, phase });
    out.lines.push({ a: from, b: to, color: style.guide });
  };
  // Inside test for clipping streams to the volume (sphere / cylinder footprints)
  const insideLocal = (x: number, y: number, z: number) => {
    const lx = x / rx;
    const ly = (y - ry) / ry;
    const lz = z / rz;
    if (volume === GravityVolume.Sphere) return lx * lx + ly * ly + lz * lz <= 1.0001;
    if (volume === GravityVolume.Cylinder) return lx * lx + lz * lz <= 1.0001 && Math.abs(ly) <= 1.0001;
    return Math.abs(lx) <= 1.0001 && Math.abs(ly) <= 1.0001 && Math.abs(lz) <= 1.0001;
  };

  if (mode === GravityMode.Parallel) {
    const grid = [-0.6, 0, 0.6];
    let n = 0;
    for (const gx of grid) {
      for (const gz of grid) {
        if (volume !== GravityVolume.Box && gx * gx + gz * gz > 0.75) continue;
        // Span of the column inside the volume
        const k = volume === GravityVolume.Sphere ? Math.sqrt(Math.max(0, 1 - gx * gx - gz * gz)) : 1;
        if (k < 0.2) continue;
        const top = ry + k * ry * 0.92;
        const bottom = ry - k * ry * 0.92;
        flow(P(gx * rx, top, gz * rz), P(gx * rx, bottom, gz * rz), (n++ * 0.37) % 1);
      }
    }
  } else if (mode === GravityMode.PointAttract || mode === GravityMode.PointRepel) {
    const dirs: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const d = 1 / Math.sqrt(3);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) dirs.push([sx * d, sy * d, sz * d]);
    dirs.forEach(([x, y, z], n) => {
      const outer = P(x * rx * 0.9, ry + y * ry * 0.9, z * rz * 0.9);
      const inner = P(x * rx * 0.2, ry + y * ry * 0.2, z * rz * 0.2);
      if (mode === GravityMode.PointAttract) flow(outer, inner, (n * 0.29) % 1);
      else flow(inner, outer, (n * 0.29) % 1);
    });
  } else {
    const heights = volume === GravityVolume.Sphere ? [0.5, 1, 1.5] : [0.2, 1, 1.8];
    let n = 0;
    for (const h of heights) {
      const y = h * ry;
      const k = volume === GravityVolume.Sphere ? Math.sqrt(Math.max(0, 1 - (h - 1) * (h - 1))) : 1;
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2 + h;
        const cx = Math.cos(t);
        const cz = Math.sin(t);
        if (!insideLocal(cx * rx * 0.9 * k, y, cz * rz * 0.9 * k)) continue;
        const outer = P(cx * rx * 0.9 * k, y, cz * rz * 0.9 * k);
        const inner = P(cx * rx * 0.15 * k, y, cz * rz * 0.15 * k);
        if (mode === GravityMode.AxisAttract) flow(outer, inner, (n++ * 0.31) % 1);
        else flow(inner, outer, (n++ * 0.31) % 1);
      }
    }
    // The axis itself
    out.lines.push({ a: P(0, 0, 0), b: P(0, H, 0), color: style.outline });
  }

  if (mode === GravityMode.PointAttract || mode === GravityMode.PointRepel) {
    const c = frame.center;
    const s = Math.min(rx, ry, rz) * 0.08;
    out.lines.push({ a: add(c, scale(axes.x, -s)), b: add(c, scale(axes.x, s)), color: style.outline });
    out.lines.push({ a: add(c, scale(axes.y, -s)), b: add(c, scale(axes.y, s)), color: style.outline });
    out.lines.push({ a: add(c, scale(axes.z, -s)), b: add(c, scale(axes.z, s)), color: style.outline });
  }

  if (style.emphasised) {
    const strength = getGravityScale(record.setting1);
    out.labels.push({ position: P(0, H, 0), text: fieldLabel({ mode, flags: record.flags }, strength), color: [style.outline[0], style.outline[1], style.outline[2], 1] });
  }
}

const PATH_SAMPLES = 12;

function drawPathChain(
  out: GravityOverlay,
  records: readonly (GravityAreaRecord | undefined)[],
  chain: number[],
  frames: Map<number, GravityGateFrame>,
  style: FieldStyle,
): void {
  const gateCorner = (f: { origin: Vec3; axes: GravityAxes; halfWidth: number; height: number }, cx: number, cy: number) =>
    add(add(f.origin, scale(f.axes.x, cx * f.halfWidth)), scale(f.axes.y, cy * f.height));

  // Gates: rectangle, forward chevron and an up tick
  for (const index of chain) {
    const f = frames.get(index);
    if (!f) continue;
    const c = (x: number, y: number) => gateCorner(f, x, y);
    out.lines.push({ a: c(-1, 0), b: c(1, 0), color: style.outline }, { a: c(1, 0), b: c(1, 1), color: style.outline });
    out.lines.push({ a: c(1, 1), b: c(-1, 1), color: style.outline }, { a: c(-1, 1), b: c(-1, 0), color: style.outline });
    const s = 0.2 * Math.min(f.halfWidth, f.height);
    const mid = add(f.origin, scale(f.axes.y, f.height / 2));
    const tip = add(mid, scale(f.axes.z, s));
    out.lines.push({ a: add(mid, scale(f.axes.x, -s)), b: tip, color: style.outline }, { a: add(mid, scale(f.axes.x, s)), b: tip, color: style.outline });
    if (style.emphasised) quad(out, c(-1, 0), c(1, 0), c(1, 1), c(-1, 1), [style.fill[0], style.fill[1], style.fill[2], style.fill[3] * 1.6]);
  }

  // Segments: corner lofts, floor ribbon, flows from the ceiling to the floor
  let n = 0;
  let labelAt: Vec3 | null = null;
  for (const from of chain) {
    const to = getGravityNextGate(records, from);
    if (to < 0 || !frames.has(from) || !frames.has(to)) continue;
    const segment = getGravityPathSegment(frames.get(from)!, frames.get(to)!);
    const sampled: GravityPathFrame[] = [];
    for (let k = 0; k <= PATH_SAMPLES; k++) sampled.push(getGravityPathFrame(segment, k / PATH_SAMPLES));
    for (const [cx, cy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const) {
      for (let k = 0; k < PATH_SAMPLES; k++) out.lines.push({ a: gateCorner(sampled[k], cx, cy), b: gateCorner(sampled[k + 1], cx, cy), color: style.outline });
    }
    const floorFill: GravityRgba = [style.fill[0], style.fill[1], style.fill[2], style.emphasised ? 0.16 : 0.07];
    for (let k = 0; k < PATH_SAMPLES; k++) {
      const a = sampled[k];
      const b = sampled[k + 1];
      quad(out, gateCorner(a, -1, 0), gateCorner(a, 1, 0), gateCorner(b, 1, 0), gateCorner(b, -1, 0), floorFill);
      if (style.emphasised) {
        quad(out, gateCorner(a, -1, 0), gateCorner(b, -1, 0), gateCorner(b, -1, 1), gateCorner(a, -1, 1), style.fill);
        quad(out, gateCorner(a, 1, 0), gateCorner(b, 1, 0), gateCorner(b, 1, 1), gateCorner(a, 1, 1), style.fill);
        quad(out, gateCorner(a, -1, 1), gateCorner(a, 1, 1), gateCorner(b, 1, 1), gateCorner(b, -1, 1), style.fill);
      }
    }
    // Down arrows across the swept rectangle at a few stations
    for (const t of [0.25, 0.5, 0.75]) {
      const f = getGravityPathFrame(segment, t);
      for (const x of [-0.55, 0.55]) {
        const top = gateCorner(f, x, 0.92);
        const bottom = gateCorner(f, x, 0.08);
        out.flows.push({ points: [top, bottom], color: style.flow, arrowSize: Math.max(250, Math.min(f.halfWidth, f.height) * 0.1), phase: (n++ * 0.37) % 1 });
        out.lines.push({ a: top, b: bottom, color: style.guide });
      }
    }
    // Chain direction along the floor centre line
    const centre: Vec3[] = sampled.map((f) => gateCorner(f, 0, 0.02));
    out.flows.push({ points: centre, color: [style.flow[0], style.flow[1], style.flow[2], style.flow[3] * 0.6], arrowSize: Math.max(250, segment.a.halfWidth * 0.08), phase: (n++ * 0.53) % 1 });
    if (!labelAt) labelAt = gateCorner(sampled[PATH_SAMPLES >> 1], 0, 1);
  }

  if (style.emphasised) {
    const first = frames.get(chain[0]);
    const flags = chain.reduce((acc, i) => acc | (records[i]?.flags ?? 0), 0);
    const strength = first?.scale ?? 1;
    const at = labelAt ?? (first ? gateCorner(first, 0, 1) : null);
    if (at) out.labels.push({ position: at, text: fieldLabel({ mode: GravityMode.Path, flags }, strength, `${chain.length} gate${chain.length === 1 ? '' : 's'}`), color: [style.outline[0], style.outline[1], style.outline[2], 1] });
  }
}

/** Everything the viewport draws for the gravity fields of a track. */
export function buildGravityOverlay(records: readonly (GravityAreaRecord | undefined)[], options: GravityOverlayOptions = {}): GravityOverlay {
  const out: GravityOverlay = { lines: [], triangles: [], flows: [], labels: [] };
  const selected = options.selected ?? new Set<number>();
  const hovered = options.hovered ?? null;

  records.forEach((record, index) => {
    if (!record || !isGravityArea(record) || isGravityPathGate(record)) return;
    const frame = getGravityVolumeFrame(record);
    if (!frame) return;
    drawRegularField(out, record, frame, fieldStyle(getGravityMode(record), selected.has(index), hovered === index));
  });

  const frames = getGravityGateFrames(records);
  for (const chain of getGravityPathChains(records)) {
    const isSelected = chain.some((index) => selected.has(index));
    const isHovered = hovered !== null && chain.includes(hovered);
    drawPathChain(out, records, chain, frames, fieldStyle(GravityMode.Path, isSelected, isHovered && !isSelected));
  }
  return out;
}

/**
 * Points that enclose what an AREA covers, for framing it in the viewport: its volume box, or
 * every gate of the chain for a gravity path gate.
 */
export function getAreaFramePoints(records: readonly (GravityAreaRecord | undefined)[], index: number): Vec3[] {
  const area = records[index];
  if (!area) return [];
  const corners = (record: GravityAreaRecord, depth: boolean): Vec3[] => {
    const axes = getAreaAxes(record.rotation);
    const rx = GRAVITY_RADIUS * Math.abs(record.scale.x);
    const h = GRAVITY_HEIGHT * Math.abs(record.scale.y);
    const rz = depth ? GRAVITY_RADIUS * Math.abs(record.scale.z) : 0;
    const out: Vec3[] = [];
    for (const x of [-rx, rx]) for (const y of [0, h]) for (const z of [-rz, rz]) out.push(local(record.position, axes, x, y, z));
    return out;
  };
  if (isGravityPathGate(area)) {
    return getGravityChainOf(records, index).flatMap((gateIndex) => (records[gateIndex] ? corners(records[gateIndex]!, false) : []));
  }
  return corners(area, true);
}
