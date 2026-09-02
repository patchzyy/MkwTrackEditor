/**
 * Complete, lossless structured model of a Mario Kart Wii `course.kmp`.
 *
 * `writeKmpFile(readKmpFile(bytes))` reproduces `bytes` byte-for-byte for every KMP the
 * game accepts: the header (version, section count, header size, offset-table order),
 * every documented field of all 15 sections, per-record padding/unknown bytes, sections
 * the editor does not understand, and any padding between or after sections.
 *
 * Field names and offsets follow https://wiki.tockdom.com/wiki/KMP_(File_Format) and match
 * hlorenzi's kmp-editor (`src/util/kmpData.js`).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const KMP_MAGIC = 'RKMD';

/** The order Nintendo writes the section offset table in. */
export const KMP_SECTION_ORDER = [
  'KTPT',
  'ENPT',
  'ENPH',
  'ITPT',
  'ITPH',
  'CKPT',
  'CKPH',
  'GOBJ',
  'POTI',
  'AREA',
  'CAME',
  'JGPT',
  'CNPT',
  'MSPT',
  'STGI',
] as const;

export type KmpKnownSection = (typeof KMP_SECTION_ORDER)[number];

/** Byte size of one record, for the fixed-size sections. POTI records are variable-size. */
export const KMP_RECORD_SIZE: Record<KmpKnownSection, number> = {
  KTPT: 0x1c,
  ENPT: 0x14,
  ENPH: 0x10,
  ITPT: 0x14,
  ITPH: 0x10,
  CKPT: 0x14,
  CKPH: 0x10,
  GOBJ: 0x3c,
  POTI: 0x04,
  AREA: 0x30,
  CAME: 0x48,
  JGPT: 0x1c,
  CNPT: 0x1c,
  MSPT: 0x1c,
  STGI: 0x0c,
};

/** Sentinel used by every 8-bit index field in the KMP. */
export const KMP_NULL_INDEX_8 = 0xff;
/** Sentinel used by every 16-bit index field in the KMP (GOBJ route index). */
export const KMP_NULL_INDEX_16 = 0xffff;

// ---------------------------------------------------------------------------
// Per-section records
// ---------------------------------------------------------------------------

/** KTPT — a starting grid position. */
export interface KmpStartPoint {
  position: Vec3;
  /** Euler angles in degrees (X, Y, Z). */
  rotation: Vec3;
  /** -1 for a normal race start; 0..11 pins this point to one player slot in battle. */
  playerIndex: number;
  /** Unused 2 bytes at 0x1A. */
  padding: number;
}

/** ENPT — one enemy (CPU) route point. */
export interface KmpEnemyPoint {
  position: Vec3;
  /** "Deviation"/drift radius in which CPUs may wander around the point. */
  range: number;
  /** Driving behaviour flags (0x0000 normal, 0x0001 hug the point, 0x0002 avoid falls, …). */
  setting1: number;
  /** Item/action hint (drift, use mushroom, wheelie, …). */
  setting2: number;
  /** Extra behaviour byte, most commonly 0. */
  setting3: number;
}

/** ITPT — one item (red/blue shell) route point. */
export interface KmpItemPoint {
  position: Vec3;
  /** Bulb radius the shell is allowed to deviate inside. */
  range: number;
  /** Shell behaviour flags. */
  setting1: number;
  /** Bullet Bill / shell "don't follow" flags. */
  setting2: number;
}

/** ENPH / ITPH / CKPH — a group of consecutive points plus its graph links. */
export interface KmpPathGroup {
  /** Index of the group's first point in the matching point section. */
  start: number;
  /** Number of points in the group. */
  length: number;
  /** Up to 6 previous group indices; 0xFF marks an unused slot. */
  prev: number[];
  /** Up to 6 next group indices; 0xFF marks an unused slot. */
  next: number[];
  /** Unused 2 bytes at 0x0E. Some CT tools store a group id here. */
  unknown: number;
}

/** CKPT — one checkpoint, defined by a line segment on the XZ plane. */
export interface KmpCheckpoint {
  /** "Left" end of the checkpoint line, looking along the driving direction. */
  x1: number;
  z1: number;
  /** "Right" end of the checkpoint line. */
  x2: number;
  z2: number;
  /** Index into JGPT of the respawn point used when a driver falls after this checkpoint. */
  respawnIndex: number;
  /** 0 = lap counter, 1..254 = key checkpoint number, 0xFF = ordinary checkpoint. */
  type: number;
  /** Previous checkpoint index, 0xFF at the start of a group. */
  prev: number;
  /** Next checkpoint index, 0xFF at the end of a group. */
  next: number;
}

/** GOBJ — a placed track object. */
export interface KmpObject {
  /** ObjFlow object id. */
  objectId: number;
  /**
   * Unused in the retail game; Wiimm's "extended presence flags" hack stores its
   * definition/reference bits here.
   */
  extendedPresence: number;
  position: Vec3;
  /** Euler angles in degrees. */
  rotation: Vec3;
  scale: Vec3;
  /** POTI route index, or 0xFFFF when the object has no route. */
  routeIndex: number;
  /** The eight per-object parameter words. */
  settings: number[];
  /**
   * Which modes the object exists in. Bit 0 = single player, bit 1 = 2P, bit 2 = 3-4P,
   * bit 3 = online/battle, bits 4-5 = time trial variants.
   */
  presenceFlags: number;
}

/** One point of a POTI route. */
export interface KmpRoutePoint {
  position: Vec3;
  /** Per-point parameter 1 (usually the speed the object travels at). */
  setting1: number;
  /** Per-point parameter 2 (usually a pause duration in frames). */
  setting2: number;
}

/** POTI — one object/camera route. */
export interface KmpRoute {
  /** 0 = sharp corners, 1 = smooth (Catmull-Rom style) motion. */
  smooth: number;
  /** 0 = cyclic loop, 1 = travel back and forth along the route. */
  forwardBackward: number;
  points: KmpRoutePoint[];
}

/** AREA — a trigger volume. */
export interface KmpArea {
  /** 0 = box, 1 = cylinder. */
  shape: number;
  /** Area type (0 = camera, 1 = enemy fall, 2 = mapping to a route, …). */
  type: number;
  /** CAME index for type 0 areas, 0xFF otherwise. */
  cameraIndex: number;
  /** Higher priority wins when areas overlap. */
  priority: number;
  position: Vec3;
  rotation: Vec3;
  /** Half-extents multiplier; the base box is 10000 units, the base cylinder r=10000 h=10000. */
  scale: Vec3;
  setting1: number;
  setting2: number;
  /** POTI index for moving-road areas, 0xFF when unused. */
  routeIndex: number;
  /** ENPT index for enemy-related area types, 0xFF when unused. */
  enemyPointIndex: number;
  /** Unused 2 bytes at 0x2E. */
  padding: number;
}

/** CAME — one camera. */
export interface KmpCamera {
  /** Camera type (0 goal, 1 fixed-search, 4 route-following, 5 follow-path, …). */
  type: number;
  /** Next camera in the opening chain, 0xFF to end the chain. */
  nextIndex: number;
  /** Camera shake; unused by the retail game. */
  shake: number;
  /** POTI index the camera position follows, 0xFF when unused. */
  routeIndex: number;
  /** Speed the camera moves along its route (1/100 units per frame). */
  pointVelocity: number;
  /** Speed the field of view interpolates from zoomStart to zoomEnd. */
  zoomVelocity: number;
  /** Speed the look-at point moves from viewStart to viewEnd. */
  viewVelocity: number;
  /** Opening-chain start flag. */
  start: number;
  /** "Movie"/route-mode flag. */
  movie: number;
  position: Vec3;
  rotation: Vec3;
  /** Field of view in degrees at the beginning of the shot. */
  zoomStart: number;
  /** Field of view in degrees at the end of the shot. */
  zoomEnd: number;
  /** Where the camera looks at the beginning of the shot. */
  viewStart: Vec3;
  /** Where the camera looks at the end of the shot. */
  viewEnd: Vec3;
  /** Shot duration in 1/60 s units. */
  time: number;
}

/** JGPT — a respawn point. */
export interface KmpRespawnPoint {
  position: Vec3;
  rotation: Vec3;
  /** Respawn id; normally equal to the record index. */
  id: number;
  /** Signed "range" value at 0x1A. Vanilla tracks use -1. */
  range: number;
}

/** CNPT — a cannon end point. */
export interface KmpCannonPoint {
  position: Vec3;
  rotation: Vec3;
  /** Cannon id, referenced by the object's setting. */
  id: number;
  /** Shoot effect / cannon flight type (0 straight, 1 curved, 2 curved+slow). */
  shootEffect: number;
}

/** MSPT — a battle-mode finish/"mission" point. */
export interface KmpBattleFinishPoint {
  position: Vec3;
  rotation: Vec3;
  id: number;
  /** Unused 2 bytes at 0x1A. */
  unknown: number;
}

/** STGI — global stage settings. There is always exactly one record. */
export interface KmpStageInfo {
  /** Laps required to finish. Only 1..9 work in the retail game. */
  lapCount: number;
  /** 0 = starting grid on the left, 1 = on the right. */
  polePosition: number;
  /** 0 = normal driver spacing on the grid, 1 = narrow. */
  driverDistance: number;
  /** 0 = lens flare enabled, 1 = disabled. */
  lensFlareFlash: number;
  /** Unused byte at 0x04. */
  unknown1: number;
  /** Lens flare tint, RGBA. */
  flareColor: number[];
  /** Unused byte at 0x09. */
  unknown2: number;
  /**
   * Global speed multiplier, stored as only the top two bytes of a big-endian float
   * (0 means "unset", which the game treats as 1.0).
   */
  speedModifier: number;
}

/** A section the editor does not model; carried through untouched. */
export interface KmpUnknownSection {
  name: string;
  count: number;
  headerValue: number;
  payload: Uint8Array;
}

export interface KmpFile {
  /** Version word at 0x0C. Retail tracks use 0x000009D8. */
  version: number;
  /** Header size (0x4C for the standard 15-section header). */
  headerSize: number;
  /** Section names in offset-table slot order. */
  sectionOrder: string[];
  /** Section names in ascending file-offset order. */
  sectionLayout: string[];

  startPoints: KmpStartPoint[];
  enemyPoints: KmpEnemyPoint[];
  enemyGroups: KmpPathGroup[];
  itemPoints: KmpItemPoint[];
  itemGroups: KmpPathGroup[];
  checkpoints: KmpCheckpoint[];
  checkpointGroups: KmpPathGroup[];
  objects: KmpObject[];
  routes: KmpRoute[];
  areas: KmpArea[];
  cameras: KmpCamera[];
  respawnPoints: KmpRespawnPoint[];
  cannonPoints: KmpCannonPoint[];
  battleFinishPoints: KmpBattleFinishPoint[];
  stage: KmpStageInfo[];

  /** CAME section header: the first camera of the opening pan. */
  firstOpeningCamera: number;
  /** CAME section header: the first camera of the character-selection pan. */
  firstSelectionCamera: number;

  unknownSections: KmpUnknownSection[];

  /** Round-trip bookkeeping; callers normally ignore this. */
  raw: KmpRawLayout;

  warnings: string[];
}

/** Bytes that carry no meaning but must survive a save to keep files byte-identical. */
export interface KmpRawLayout {
  /** Header bytes after the offset table, up to `headerSize`. */
  headerPadding: Uint8Array;
  /** The 2-byte "additional value" of each section, keyed by section name. */
  headerValues: Record<string, number>;
  /** Payload bytes of a section that follow its last complete record. */
  sectionTrailers: Record<string, Uint8Array>;
  /** Padding found before each section (keyed by section name) in file order. */
  sectionPadding: Record<string, Uint8Array>;
  /** Bytes after the last section. */
  fileTrailer: Uint8Array;
  /** True when the source declared a file length that matched its real length. */
  fileLengthWasCorrect: boolean;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

class Cursor {
  offset: number;

  constructor(readonly view: DataView, start = 0) {
    this.offset = start;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  f32(): number {
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  vec3(): Vec3 {
    return { x: this.f32(), y: this.f32(), z: this.f32() };
  }

  bytes(count: number): number[] {
    return Array.from({ length: count }, () => this.u8());
  }

  u16s(count: number): number[] {
    return Array.from({ length: count }, () => this.u16());
  }

  /** Reads the truncated big-endian float STGI uses for its speed modifier. */
  f32Msb2(): number {
    const high = this.u16();
    const buffer = new DataView(new ArrayBuffer(4));
    buffer.setUint16(0, high, false);
    return buffer.getFloat32(0, false);
  }
}

class Emitter {
  private buffer = new Uint8Array(1024);
  private view = new DataView(this.buffer.buffer);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number): void {
    this.ensure(1);
    this.view.setUint8(this.length, value & 0xff);
    this.length += 1;
  }

  u16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, value & 0xffff, false);
    this.length += 2;
  }

  i16(value: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, clampInt(value, -0x8000, 0x7fff), false);
    this.length += 2;
  }

  u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, value >>> 0, false);
    this.length += 4;
  }

  f32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, value, false);
    this.length += 4;
  }

  vec3(value: Vec3): void {
    this.f32(value.x);
    this.f32(value.y);
    this.f32(value.z);
  }

  f32Msb2(value: number): void {
    const source = new DataView(new ArrayBuffer(4));
    source.setFloat32(0, value, false);
    this.u16(source.getUint16(0, false));
  }

  ascii(value: string): void {
    for (let i = 0; i < value.length; i++) this.u8(value.charCodeAt(i));
  }

  bytes(value: ArrayLike<number>): void {
    this.ensure(value.length);
    this.buffer.set(value instanceof Uint8Array ? value : Uint8Array.from(value as number[]), this.length);
    this.length += value.length;
  }

  fixedBytes(value: number[], count: number, fill: number): void {
    for (let i = 0; i < count; i++) this.u8(i < value.length ? value[i] : fill);
  }

  patchU32(at: number, value: number): void {
    this.view.setUint32(at, value >>> 0, false);
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function asciiAt(data: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(data[offset + i] ?? 0);
  return out;
}

interface RawSection {
  name: string;
  slot: number;
  offset: number;
  count: number;
  headerValue: number;
  payload: Uint8Array;
}

export function readKmpFile(data: Uint8Array): KmpFile {
  if (data.length < 0x10 || asciiAt(data, 0, 4) !== KMP_MAGIC) throw new Error('Not a Mario Kart Wii KMP file');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const warnings: string[] = [];

  const declaredLength = view.getUint32(4, false);
  const sectionCount = view.getUint16(8, false);
  const headerSize = view.getUint16(0x0a, false);
  const version = view.getUint32(0x0c, false);
  const offsetTableEnd = 0x10 + sectionCount * 4;
  if (offsetTableEnd > data.length) throw new Error('KMP header claims more sections than the file contains');

  const slots: Array<{ slot: number; offset: number }> = [];
  for (let i = 0; i < sectionCount; i++) {
    const absolute = headerSize + view.getUint32(0x10 + i * 4, false);
    if (absolute + 8 > data.length) {
      warnings.push(`Section slot ${i} points outside the file and was dropped.`);
      continue;
    }
    slots.push({ slot: i, offset: absolute });
  }

  const byOffset = [...slots].sort((a, b) => a.offset - b.offset);
  const rawSections: RawSection[] = [];
  const sectionPadding: Record<string, Uint8Array> = {};
  let cursor = Math.min(headerSize, data.length);
  for (let i = 0; i < byOffset.length; i++) {
    const { slot, offset } = byOffset[i];
    const name = asciiAt(data, offset, 4);
    const count = view.getUint16(offset + 4, false);
    const headerValue = view.getUint16(offset + 6, false);
    const payloadStart = offset + 8;
    const payloadEnd = i + 1 < byOffset.length ? byOffset[i + 1].offset : data.length;
    sectionPadding[name] = data.slice(Math.min(cursor, offset), offset);
    cursor = Math.max(payloadStart, payloadEnd);
    rawSections.push({ name, slot, offset, count, headerValue, payload: data.slice(payloadStart, Math.max(payloadStart, payloadEnd)) });
  }

  const sectionOrder: string[] = new Array(sectionCount).fill('');
  for (const section of rawSections) sectionOrder[section.slot] = section.name;
  const headerValues: Record<string, number> = {};
  const sectionTrailers: Record<string, Uint8Array> = {};
  for (const section of rawSections) headerValues[section.name] = section.headerValue;

  const find = (name: string) => rawSections.find((section) => section.name === name);

  const decodeFixed = <T,>(name: KmpKnownSection, decode: (cursor: Cursor) => T): T[] => {
    const section = find(name);
    if (!section) return [];
    const size = KMP_RECORD_SIZE[name];
    const available = Math.floor(section.payload.length / size);
    if (section.count > available) warnings.push(`${name} declares ${section.count} entries but only ${available} fit in the file.`);
    const usable = Math.min(section.count, available);
    const payloadView = new DataView(section.payload.buffer, section.payload.byteOffset, section.payload.byteLength);
    const out: T[] = [];
    for (let i = 0; i < usable; i++) out.push(decode(new Cursor(payloadView, i * size)));
    sectionTrailers[name] = section.payload.slice(usable * size);
    return out;
  };

  const startPoints = decodeFixed('KTPT', (c) => ({
    position: c.vec3(),
    rotation: c.vec3(),
    playerIndex: c.i16(),
    padding: c.u16(),
  }));
  const enemyPoints = decodeFixed('ENPT', (c) => ({
    position: c.vec3(),
    range: c.f32(),
    setting1: c.u16(),
    setting2: c.u8(),
    setting3: c.u8(),
  }));
  const enemyGroups = decodeFixed('ENPH', decodePathGroup);
  const itemPoints = decodeFixed('ITPT', (c) => ({
    position: c.vec3(),
    range: c.f32(),
    setting1: c.u16(),
    setting2: c.u16(),
  }));
  const itemGroups = decodeFixed('ITPH', decodePathGroup);
  const checkpoints = decodeFixed('CKPT', (c) => ({
    x1: c.f32(),
    z1: c.f32(),
    x2: c.f32(),
    z2: c.f32(),
    respawnIndex: c.u8(),
    type: c.u8(),
    prev: c.u8(),
    next: c.u8(),
  }));
  const checkpointGroups = decodeFixed('CKPH', decodePathGroup);
  const objects = decodeFixed('GOBJ', (c) => ({
    objectId: c.u16(),
    extendedPresence: c.u16(),
    position: c.vec3(),
    rotation: c.vec3(),
    scale: c.vec3(),
    routeIndex: c.u16(),
    settings: c.u16s(8),
    presenceFlags: c.u16(),
  }));
  const areas = decodeFixed('AREA', (c) => ({
    shape: c.u8(),
    type: c.u8(),
    cameraIndex: c.u8(),
    priority: c.u8(),
    position: c.vec3(),
    rotation: c.vec3(),
    scale: c.vec3(),
    setting1: c.u16(),
    setting2: c.u16(),
    routeIndex: c.u8(),
    enemyPointIndex: c.u8(),
    padding: c.u16(),
  }));
  const cameras = decodeFixed('CAME', (c) => ({
    type: c.u8(),
    nextIndex: c.u8(),
    shake: c.u8(),
    routeIndex: c.u8(),
    pointVelocity: c.u16(),
    zoomVelocity: c.u16(),
    viewVelocity: c.u16(),
    start: c.u8(),
    movie: c.u8(),
    position: c.vec3(),
    rotation: c.vec3(),
    zoomStart: c.f32(),
    zoomEnd: c.f32(),
    viewStart: c.vec3(),
    viewEnd: c.vec3(),
    time: c.f32(),
  }));
  const respawnPoints = decodeFixed('JGPT', (c) => ({
    position: c.vec3(),
    rotation: c.vec3(),
    id: c.u16(),
    range: c.i16(),
  }));
  const cannonPoints = decodeFixed('CNPT', (c) => ({
    position: c.vec3(),
    rotation: c.vec3(),
    id: c.u16(),
    shootEffect: c.i16(),
  }));
  const battleFinishPoints = decodeFixed('MSPT', (c) => ({
    position: c.vec3(),
    rotation: c.vec3(),
    id: c.u16(),
    unknown: c.u16(),
  }));
  const stage = decodeFixed('STGI', (c) => ({
    lapCount: c.u8(),
    polePosition: c.u8(),
    driverDistance: c.u8(),
    lensFlareFlash: c.u8(),
    unknown1: c.u8(),
    flareColor: c.bytes(4),
    unknown2: c.u8(),
    speedModifier: c.f32Msb2(),
  }));

  const routes = decodeRoutes(find('POTI'), sectionTrailers, warnings);

  const cameSection = find('CAME');
  const firstOpeningCamera = cameSection ? (cameSection.headerValue >> 8) & 0xff : 0;
  const firstSelectionCamera = cameSection ? cameSection.headerValue & 0xff : 0;

  const known = new Set<string>(KMP_SECTION_ORDER);
  const unknownSections: KmpUnknownSection[] = rawSections
    .filter((section) => !known.has(section.name))
    .map((section) => ({ name: section.name, count: section.count, headerValue: section.headerValue, payload: section.payload }));
  for (const section of unknownSections) warnings.push(`Section ${section.name} is not understood by the editor and will be saved unchanged.`);

  const lastSection = rawSections.at(-1);
  const fileTrailer = lastSection ? new Uint8Array(0) : data.slice(Math.min(headerSize, data.length));

  return {
    version,
    headerSize,
    sectionOrder,
    sectionLayout: rawSections.map((section) => section.name),
    startPoints,
    enemyPoints,
    enemyGroups,
    itemPoints,
    itemGroups,
    checkpoints,
    checkpointGroups,
    objects,
    routes,
    areas,
    cameras,
    respawnPoints,
    cannonPoints,
    battleFinishPoints,
    stage,
    firstOpeningCamera,
    firstSelectionCamera,
    unknownSections,
    raw: {
      headerPadding: data.slice(Math.min(offsetTableEnd, data.length), Math.min(headerSize, data.length)),
      headerValues,
      sectionTrailers,
      sectionPadding,
      fileTrailer,
      fileLengthWasCorrect: declaredLength === data.length,
    },
    warnings,
  };
}

function decodePathGroup(c: Cursor): KmpPathGroup {
  return {
    start: c.u8(),
    length: c.u8(),
    prev: c.bytes(6),
    next: c.bytes(6),
    unknown: c.u16(),
  };
}

function decodeRoutes(section: RawSection | undefined, trailers: Record<string, Uint8Array>, warnings: string[]): KmpRoute[] {
  if (!section) return [];
  const view = new DataView(section.payload.buffer, section.payload.byteOffset, section.payload.byteLength);
  const routes: KmpRoute[] = [];
  const cursor = new Cursor(view, 0);
  for (let i = 0; i < section.count; i++) {
    if (cursor.offset + 4 > section.payload.length) {
      warnings.push(`Route list is truncated after ${i} of ${section.count} routes.`);
      break;
    }
    const pointCount = cursor.u16();
    const smooth = cursor.u8();
    const forwardBackward = cursor.u8();
    const points: KmpRoutePoint[] = [];
    for (let p = 0; p < pointCount; p++) {
      if (cursor.offset + 0x10 > section.payload.length) {
        warnings.push(`Route ${i} is truncated after ${p} of ${pointCount} points.`);
        break;
      }
      points.push({ position: cursor.vec3(), setting1: cursor.u16(), setting2: cursor.u16() });
    }
    routes.push({ smooth, forwardBackward, points });
  }
  trailers.POTI = section.payload.slice(cursor.offset);
  return routes;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function writeKmpFile(file: KmpFile): Uint8Array {
  const payloads = new Map<string, { count: number; headerValue: number; payload: Uint8Array }>();
  const trailer = (name: string) => file.raw.sectionTrailers[name] ?? new Uint8Array(0);
  const headerValue = (name: string, fallback = 0) => file.raw.headerValues[name] ?? fallback;

  const emitFixed = <T,>(name: KmpKnownSection, records: T[], encode: (out: Emitter, record: T) => void, value = headerValue(name)) => {
    if (!file.sectionLayout.includes(name)) return;
    const out = new Emitter();
    for (const record of records) encode(out, record);
    out.bytes(trailer(name));
    payloads.set(name, { count: records.length, headerValue: value, payload: out.toUint8Array() });
  };

  emitFixed('KTPT', file.startPoints, (o, r) => {
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.i16(r.playerIndex);
    o.u16(r.padding);
  });
  emitFixed('ENPT', file.enemyPoints, (o, r) => {
    o.vec3(r.position);
    o.f32(r.range);
    o.u16(r.setting1);
    o.u8(r.setting2);
    o.u8(r.setting3);
  });
  emitFixed('ENPH', file.enemyGroups, encodePathGroup);
  emitFixed('ITPT', file.itemPoints, (o, r) => {
    o.vec3(r.position);
    o.f32(r.range);
    o.u16(r.setting1);
    o.u16(r.setting2);
  });
  emitFixed('ITPH', file.itemGroups, encodePathGroup);
  emitFixed('CKPT', file.checkpoints, (o, r) => {
    o.f32(r.x1);
    o.f32(r.z1);
    o.f32(r.x2);
    o.f32(r.z2);
    o.u8(r.respawnIndex);
    o.u8(r.type);
    o.u8(r.prev);
    o.u8(r.next);
  });
  emitFixed('CKPH', file.checkpointGroups, encodePathGroup);
  emitFixed('GOBJ', file.objects, (o, r) => {
    o.u16(r.objectId);
    o.u16(r.extendedPresence);
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.vec3(r.scale);
    o.u16(r.routeIndex);
    for (let i = 0; i < 8; i++) o.u16(r.settings[i] ?? 0);
    o.u16(r.presenceFlags);
  });
  emitFixed('AREA', file.areas, (o, r) => {
    o.u8(r.shape);
    o.u8(r.type);
    o.u8(r.cameraIndex);
    o.u8(r.priority);
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.vec3(r.scale);
    o.u16(r.setting1);
    o.u16(r.setting2);
    o.u8(r.routeIndex);
    o.u8(r.enemyPointIndex);
    o.u16(r.padding);
  });
  emitFixed(
    'CAME',
    file.cameras,
    (o, r) => {
      o.u8(r.type);
      o.u8(r.nextIndex);
      o.u8(r.shake);
      o.u8(r.routeIndex);
      o.u16(r.pointVelocity);
      o.u16(r.zoomVelocity);
      o.u16(r.viewVelocity);
      o.u8(r.start);
      o.u8(r.movie);
      o.vec3(r.position);
      o.vec3(r.rotation);
      o.f32(r.zoomStart);
      o.f32(r.zoomEnd);
      o.vec3(r.viewStart);
      o.vec3(r.viewEnd);
      o.f32(r.time);
    },
    ((file.firstOpeningCamera & 0xff) << 8) | (file.firstSelectionCamera & 0xff),
  );
  emitFixed('JGPT', file.respawnPoints, (o, r) => {
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.u16(r.id);
    o.i16(r.range);
  });
  emitFixed('CNPT', file.cannonPoints, (o, r) => {
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.u16(r.id);
    o.i16(r.shootEffect);
  });
  emitFixed('MSPT', file.battleFinishPoints, (o, r) => {
    o.vec3(r.position);
    o.vec3(r.rotation);
    o.u16(r.id);
    o.u16(r.unknown);
  });
  emitFixed('STGI', file.stage, (o, r) => {
    o.u8(r.lapCount);
    o.u8(r.polePosition);
    o.u8(r.driverDistance);
    o.u8(r.lensFlareFlash);
    o.u8(r.unknown1);
    o.fixedBytes(r.flareColor, 4, 0);
    o.u8(r.unknown2);
    o.f32Msb2(r.speedModifier);
  });

  if (file.sectionLayout.includes('POTI')) {
    const out = new Emitter();
    let totalPoints = 0;
    for (const route of file.routes) {
      out.u16(route.points.length);
      out.u8(route.smooth);
      out.u8(route.forwardBackward);
      for (const point of route.points) {
        out.vec3(point.position);
        out.u16(point.setting1);
        out.u16(point.setting2);
      }
      totalPoints += route.points.length;
    }
    out.bytes(trailer('POTI'));
    payloads.set('POTI', { count: file.routes.length, headerValue: totalPoints & 0xffff, payload: out.toUint8Array() });
  }

  for (const section of file.unknownSections) {
    payloads.set(section.name, { count: section.count, headerValue: section.headerValue, payload: section.payload });
  }

  const layout = file.sectionLayout.filter((name) => payloads.has(name));
  const order = file.sectionOrder.length > 0 ? file.sectionOrder : layout;

  // Lay the sections out first so the offset table can be filled in.
  const offsets = new Map<string, number>();
  let position = file.headerSize;
  for (const name of layout) {
    const padding = file.raw.sectionPadding[name];
    if (padding && padding.length > 0) position += padding.length;
    offsets.set(name, position);
    position += 8 + payloads.get(name)!.payload.length;
  }
  const totalLength = position + file.raw.fileTrailer.length;

  const out = new Emitter();
  out.ascii(KMP_MAGIC);
  out.u32(totalLength);
  out.u16(order.length);
  out.u16(file.headerSize);
  out.u32(file.version);
  for (const name of order) out.u32(Math.max(0, (offsets.get(name) ?? file.headerSize) - file.headerSize));
  out.bytes(file.raw.headerPadding);
  while (out.length < file.headerSize) out.u8(0);

  for (const name of layout) {
    const padding = file.raw.sectionPadding[name];
    if (padding && padding.length > 0) out.bytes(padding);
    const section = payloads.get(name)!;
    out.ascii(name.padEnd(4, '\0').slice(0, 4));
    out.u16(section.count);
    out.u16(section.headerValue);
    out.bytes(section.payload);
  }
  out.bytes(file.raw.fileTrailer);

  return out.toUint8Array();
}

function encodePathGroup(out: Emitter, group: KmpPathGroup): void {
  out.u8(group.start);
  out.u8(group.length);
  out.fixedBytes(group.prev, 6, KMP_NULL_INDEX_8);
  out.fixedBytes(group.next, 6, KMP_NULL_INDEX_8);
  out.u16(group.unknown);
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/** Creates an empty but structurally valid KMP with all 15 standard sections. */
export function createEmptyKmpFile(): KmpFile {
  const headerSize = 0x10 + KMP_SECTION_ORDER.length * 4;
  return {
    version: 0x000009d8,
    headerSize,
    sectionOrder: [...KMP_SECTION_ORDER],
    sectionLayout: [...KMP_SECTION_ORDER],
    startPoints: [],
    enemyPoints: [],
    enemyGroups: [],
    itemPoints: [],
    itemGroups: [],
    checkpoints: [],
    checkpointGroups: [],
    objects: [],
    routes: [],
    areas: [],
    cameras: [],
    respawnPoints: [],
    cannonPoints: [],
    battleFinishPoints: [],
    stage: [createStageInfo()],
    firstOpeningCamera: 0,
    firstSelectionCamera: 0,
    unknownSections: [],
    raw: {
      headerPadding: new Uint8Array(0),
      headerValues: {},
      sectionTrailers: {},
      sectionPadding: {},
      fileTrailer: new Uint8Array(0),
      fileLengthWasCorrect: true,
    },
    warnings: [],
  };
}

export function createStageInfo(): KmpStageInfo {
  return {
    lapCount: 3,
    polePosition: 0,
    driverDistance: 0,
    lensFlareFlash: 0,
    unknown1: 0,
    flareColor: [0xff, 0xff, 0xff, 0x4b],
    unknown2: 0,
    speedModifier: 0,
  };
}

export function createPathGroup(start = 0, length = 0): KmpPathGroup {
  return { start, length, prev: [], next: [], unknown: 0 };
}

/** Deep copy, so editing helpers can stay pure without sharing sub-objects. */
export function cloneKmpFile(file: KmpFile): KmpFile {
  return {
    ...file,
    sectionOrder: [...file.sectionOrder],
    sectionLayout: [...file.sectionLayout],
    startPoints: file.startPoints.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation } })),
    enemyPoints: file.enemyPoints.map((r) => ({ ...r, position: { ...r.position } })),
    enemyGroups: file.enemyGroups.map(clonePathGroup),
    itemPoints: file.itemPoints.map((r) => ({ ...r, position: { ...r.position } })),
    itemGroups: file.itemGroups.map(clonePathGroup),
    checkpoints: file.checkpoints.map((r) => ({ ...r })),
    checkpointGroups: file.checkpointGroups.map(clonePathGroup),
    objects: file.objects.map((r) => ({
      ...r,
      position: { ...r.position },
      rotation: { ...r.rotation },
      scale: { ...r.scale },
      settings: [...r.settings],
    })),
    routes: file.routes.map((route) => ({ ...route, points: route.points.map((p) => ({ ...p, position: { ...p.position } })) })),
    areas: file.areas.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation }, scale: { ...r.scale } })),
    cameras: file.cameras.map((r) => ({
      ...r,
      position: { ...r.position },
      rotation: { ...r.rotation },
      viewStart: { ...r.viewStart },
      viewEnd: { ...r.viewEnd },
    })),
    respawnPoints: file.respawnPoints.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation } })),
    cannonPoints: file.cannonPoints.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation } })),
    battleFinishPoints: file.battleFinishPoints.map((r) => ({ ...r, position: { ...r.position }, rotation: { ...r.rotation } })),
    stage: file.stage.map((r) => ({ ...r, flareColor: [...r.flareColor] })),
    unknownSections: file.unknownSections.map((s) => ({ ...s, payload: s.payload.slice() })),
    raw: {
      headerPadding: file.raw.headerPadding.slice(),
      headerValues: { ...file.raw.headerValues },
      sectionTrailers: Object.fromEntries(Object.entries(file.raw.sectionTrailers).map(([k, v]) => [k, v.slice()])),
      sectionPadding: Object.fromEntries(Object.entries(file.raw.sectionPadding).map(([k, v]) => [k, v.slice()])),
      fileTrailer: file.raw.fileTrailer.slice(),
      fileLengthWasCorrect: file.raw.fileLengthWasCorrect,
    },
    warnings: [...file.warnings],
  };
}

function clonePathGroup(group: KmpPathGroup): KmpPathGroup {
  return { ...group, prev: [...group.prev], next: [...group.next] };
}
