import { BinReader } from './binary';

export type KmpSectionName =
  | 'KTPT'
  | 'ENPT'
  | 'ENPH'
  | 'ITPT'
  | 'ITPH'
  | 'CKPT'
  | 'CKPH'
  | 'GOBJ'
  | 'POTI'
  | 'AREA'
  | 'CAME'
  | 'JGPT'
  | 'CNPT'
  | 'MSPT'
  | 'STGI'
  | string;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface KmpEntity {
  id: string;
  section: KmpSectionName;
  index: number;
  checkpoint?: { left: Vec3; right: Vec3; respawnIndex: number; type: number; prev: number; next: number };
  pointDeviation?: number;
  pointSettings?: number[];
  area?: {
    shape: number;
    type: number;
    cameraIndex: number;
    priority: number;
    setting1: number;
    setting2: number;
    routeIndex: number;
    enemyIndex: number;
  };
  camera?: {
    type: number;
    nextCam: number;
    shake: number;
    routeIndex: number;
    vCam: number;
    vZoom: number;
    vView: number;
    start: number;
    movie: number;
    zoomStart: number;
    zoomEnd: number;
    time: number;
  };
  cameraView?: {
    start: Vec3;
    end: Vec3;
  };
  respawn?: {
    id: number;
    soundData: number;
  };
  cannon?: {
    id: number;
    effect: number;
  };
  battleFinish?: {
    id: number;
  };
  stage?: {
    lapCount: number;
    polePosition: number;
    driverDistance: number;
    lensFlareFlash: number;
    unknown1: number;
    flareColor: number[];
    unknown2: number;
    speedMod: number;
  };
  objectId?: number;
  objectSettings?: number[];
  presenceFlags?: number;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  routeIndex?: number;
  routePoint?: { routeIndex: number; pointIndex: number };
  poti?: {
    routeSetting1: number;
    routeSetting2: number;
    pointSetting1: number;
    pointSetting2: number;
  };
  rawOffset: number;
  recordSize: number;
}

export interface KmpPathGroup {
  section: 'ENPH' | 'ITPH' | 'CKPH';
  index: number;
  startIndex: number;
  pointCount: number;
  prevGroups: number[];
  nextGroups: number[];
}

export interface KmpPathGraph {
  pointSection: 'ENPT' | 'ITPT' | 'CKPT';
  groupSection: 'ENPH' | 'ITPH' | 'CKPH';
  groups: KmpPathGroup[];
  edges: Array<{ from: number; to: number; kind: 'sequence' | 'group' }>;
}

export interface KmpRoutePoint {
  position: Vec3;
  setting1: number;
  setting2: number;
  rawOffset: number;
  routeIndex: number;
  pointIndex: number;
}

export interface KmpRoute {
  index: number;
  rawOffset: number;
  setting1: number;
  setting2: number;
  points: KmpRoutePoint[];
}

export interface KmpSection {
  name: KmpSectionName;
  count: number;
  headerData: number;
  offset: number;
  data: Uint8Array;
  entries: KmpEntity[];
}

export interface KmpDocument {
  original: Uint8Array;
  sections: KmpSection[];
  entities: KmpEntity[];
  pathGraphs: KmpPathGraph[];
  routes: KmpRoute[];
  warnings: string[];
}

export type AppendableKmpPointSection = 'KTPT' | 'ENPT' | 'ITPT' | 'JGPT' | 'CNPT' | 'MSPT';
export type AppendableKmpSection = AppendableKmpPointSection | 'CKPT' | 'POTI' | 'AREA' | 'CAME';

const SECTION_RECORD_SIZE: Record<string, number> = {
  KTPT: 0x1c,
  ENPT: 0x14,
  ENPH: 0x10,
  ITPT: 0x14,
  ITPH: 0x10,
  CKPT: 0x14,
  CKPH: 0x10,
  GOBJ: 0x3c,
  AREA: 0x30,
  CAME: 0x48,
  JGPT: 0x1c,
  CNPT: 0x1c,
  MSPT: 0x1c,
  STGI: 0x0c,
};

const POSITION_OFFSETS: Record<string, number> = {
  KTPT: 0x00,
  ENPT: 0x00,
  ITPT: 0x00,
  GOBJ: 0x04,
  AREA: 0x04,
  CAME: 0x0c,
  JGPT: 0x00,
  CNPT: 0x00,
  MSPT: 0x00,
};

const ROTATION_OFFSETS: Record<string, number> = {
  KTPT: 0x0c,
  GOBJ: 0x10,
  AREA: 0x10,
  CAME: 0x18,
  JGPT: 0x0c,
  CNPT: 0x0c,
  MSPT: 0x0c,
};

const SCALE_OFFSETS: Record<string, number> = {
  GOBJ: 0x1c,
  AREA: 0x1c,
};

export function parseKmp(data: Uint8Array): KmpDocument {
  const buffer = data.slice().buffer;
  const reader = new BinReader(buffer);
  const warnings: string[] = [];
  if (reader.ascii(0, 4) !== 'RKMD') throw new Error('Not a Mario Kart Wii KMP file');

  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsets: number[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const relative = reader.u32(offsetsStart + i * 4);
    const absolute = headerSize + relative;
    if (absolute >= headerSize && absolute < data.length) offsets.push(absolute);
  }
  offsets.sort((a, b) => a - b);

  const sections: KmpSection[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    const nextOffset = offsets[i + 1] ?? data.length;
    if (offset + 8 > data.length) continue;
    const name = reader.ascii(offset, 4);
    const count = reader.u16(offset + 4);
    const headerData = reader.u16(offset + 6);
    const payloadStart = offset + 8;
    const payloadEnd = Math.max(payloadStart, Math.min(nextOffset, data.length));
    const payload = new Uint8Array(buffer.slice(payloadStart, payloadEnd));
    const recordSize = inferRecordSize(name, count, payload.length);
    const entries = parseSectionEntries(reader, name, offset, payloadStart, payload.length, count, recordSize, warnings);
    sections.push({ name, count, headerData, offset, data: payload, entries });
  }

  const routes = parseRoutes(reader, sections, warnings);
  const entities = [...sections.flatMap((section) => section.entries), ...routePointEntities(routes)];
  return {
    original: data,
    sections,
    entities,
    pathGraphs: parsePathGraphs(reader, sections, entities, warnings),
    routes,
    warnings,
  };
}

function inferRecordSize(section: string, count: number, payloadLength: number): number {
  const known = SECTION_RECORD_SIZE[section];
  if (known) return known;
  if (count > 0 && payloadLength % count === 0) return payloadLength / count;
  return payloadLength;
}

function parseSectionEntries(
  reader: BinReader,
  section: string,
  sectionOffset: number,
  payloadStart: number,
  payloadLength: number,
  count: number,
  recordSize: number,
  warnings: string[],
): KmpEntity[] {
  const entries: KmpEntity[] = [];
  if (section === 'CKPT') return parseCheckpointEntries(reader, payloadStart, payloadLength, count, recordSize);
  if (section === 'STGI') return parseStageEntries(reader, payloadStart, payloadLength, count, recordSize);

  const positionOffset = POSITION_OFFSETS[section];
  if (positionOffset === undefined || recordSize < positionOffset + 12) return entries;

  for (let index = 0; index < count; index++) {
    const rawOffset = payloadStart + index * recordSize;
    if (rawOffset + recordSize > payloadStart + payloadLength || rawOffset + positionOffset + 12 > reader.buffer.byteLength) break;
    const entity: KmpEntity = {
      id: `${section}-${index}`,
      section,
      index,
      rawOffset,
      recordSize,
      position: readVec3(reader, rawOffset + positionOffset),
    };

    const rotationOffset = ROTATION_OFFSETS[section];
    if (rotationOffset !== undefined && recordSize >= rotationOffset + 12) entity.rotation = readVec3(reader, rawOffset + rotationOffset);
    const scaleOffset = SCALE_OFFSETS[section];
    if (scaleOffset !== undefined && recordSize >= scaleOffset + 12) entity.scale = readVec3(reader, rawOffset + scaleOffset);
    if (section === 'ENPT' && recordSize >= 0x14) {
      entity.pointDeviation = reader.f32(rawOffset + 0x0c);
      entity.pointSettings = [reader.u16(rawOffset + 0x10), reader.u8(rawOffset + 0x12), reader.u8(rawOffset + 0x13)];
    }
    if (section === 'ITPT' && recordSize >= 0x14) {
      entity.pointDeviation = reader.f32(rawOffset + 0x0c);
      entity.pointSettings = [reader.u16(rawOffset + 0x10), reader.u16(rawOffset + 0x12)];
    }
    if (section === 'AREA' && recordSize >= 0x2e) {
      entity.area = {
        shape: reader.u8(rawOffset),
        type: reader.u8(rawOffset + 0x01),
        cameraIndex: reader.u8(rawOffset + 0x02),
        priority: reader.u8(rawOffset + 0x03),
        setting1: reader.u16(rawOffset + 0x28),
        setting2: reader.u16(rawOffset + 0x2a),
        routeIndex: reader.u8(rawOffset + 0x2c),
        enemyIndex: reader.u8(rawOffset + 0x2d),
      };
    }
    if (section === 'CAME' && recordSize >= 0x48) {
      entity.camera = {
        type: reader.u8(rawOffset),
        nextCam: reader.u8(rawOffset + 0x01),
        shake: reader.u8(rawOffset + 0x02),
        routeIndex: reader.u8(rawOffset + 0x03),
        vCam: reader.u16(rawOffset + 0x04),
        vZoom: reader.u16(rawOffset + 0x06),
        vView: reader.u16(rawOffset + 0x08),
        start: reader.u8(rawOffset + 0x0a),
        movie: reader.u8(rawOffset + 0x0b),
        zoomStart: reader.f32(rawOffset + 0x24),
        zoomEnd: reader.f32(rawOffset + 0x28),
        time: reader.f32(rawOffset + 0x44),
      };
      entity.cameraView = {
        start: readVec3(reader, rawOffset + 0x2c),
        end: readVec3(reader, rawOffset + 0x38),
      };
    }
    if (section === 'JGPT' && recordSize >= 0x1c) {
      entity.respawn = {
        id: reader.u16(rawOffset + 0x18),
        soundData: reader.u16(rawOffset + 0x1a),
      };
    }
    if (section === 'CNPT' && recordSize >= 0x1c) {
      entity.cannon = {
        id: reader.u16(rawOffset + 0x18),
        effect: reader.u16(rawOffset + 0x1a),
      };
    }
    if (section === 'MSPT' && recordSize >= 0x1a) {
      entity.battleFinish = {
        id: reader.u16(rawOffset + 0x18),
      };
    }
    if (section === 'GOBJ') {
      entity.objectId = reader.u16(rawOffset);
      entity.routeIndex = reader.u16(rawOffset + 0x28);
      entity.objectSettings = Array.from({ length: 8 }, (_, settingIndex) => reader.u16(rawOffset + 0x2a + settingIndex * 2));
      entity.presenceFlags = reader.u16(rawOffset + 0x3a);
    }
    entries.push(entity);
  }

  if (count > 0 && entries.length === 0) warnings.push(`${section} at 0x${sectionOffset.toString(16)} could not be decoded into editable records.`);
  return entries;
}

function parseCheckpointEntries(reader: BinReader, payloadStart: number, payloadLength: number, count: number, recordSize: number): KmpEntity[] {
  const entries: KmpEntity[] = [];
  for (let index = 0; index < count; index++) {
    const rawOffset = payloadStart + index * recordSize;
    if (rawOffset + recordSize > payloadStart + payloadLength || rawOffset + 0x14 > reader.buffer.byteLength) break;
    const x1 = reader.f32(rawOffset);
    const z1 = reader.f32(rawOffset + 4);
    const x2 = reader.f32(rawOffset + 8);
    const z2 = reader.f32(rawOffset + 12);
    entries.push({
      id: `CKPT-${index}`,
      section: 'CKPT',
      index,
      rawOffset,
      recordSize,
      checkpoint: {
        left: { x: x1, y: 0, z: z1 },
        right: { x: x2, y: 0, z: z2 },
        respawnIndex: reader.u8(rawOffset + 0x10),
        type: reader.u8(rawOffset + 0x11),
        prev: reader.u8(rawOffset + 0x12),
        next: reader.u8(rawOffset + 0x13),
      },
      position: { x: (x1 + x2) / 2, y: 0, z: (z1 + z2) / 2 },
    });
  }
  return entries;
}

function parseStageEntries(reader: BinReader, payloadStart: number, payloadLength: number, count: number, recordSize: number): KmpEntity[] {
  const entries: KmpEntity[] = [];
  for (let index = 0; index < count; index++) {
    const rawOffset = payloadStart + index * recordSize;
    if (rawOffset + recordSize > payloadStart + payloadLength || rawOffset + 0x0c > reader.buffer.byteLength) break;
    entries.push({
      id: `STGI-${index}`,
      section: 'STGI',
      index,
      rawOffset,
      recordSize,
      position: { x: 0, y: 0, z: 0 },
      stage: {
        lapCount: reader.u8(rawOffset),
        polePosition: reader.u8(rawOffset + 0x01),
        driverDistance: reader.u8(rawOffset + 0x02),
        lensFlareFlash: reader.u8(rawOffset + 0x03),
        unknown1: reader.u8(rawOffset + 0x04),
        flareColor: [reader.u8(rawOffset + 0x05), reader.u8(rawOffset + 0x06), reader.u8(rawOffset + 0x07), reader.u8(rawOffset + 0x08)],
        unknown2: reader.u8(rawOffset + 0x09),
        speedMod: readFloat32Msb2(reader, rawOffset + 0x0a),
      },
    });
  }
  return entries;
}

function readVec3(reader: BinReader, offset: number): Vec3 {
  return {
    x: reader.f32(offset),
    y: reader.f32(offset + 4),
    z: reader.f32(offset + 8),
  };
}

function readFloat32Msb2(reader: BinReader, offset: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint8(0, reader.u8(offset));
  view.setUint8(1, reader.u8(offset + 1));
  view.setUint8(2, 0);
  view.setUint8(3, 0);
  return view.getFloat32(0, false);
}

function writeFloat32Msb2(view: DataView, offset: number, value: number) {
  const buffer = new ArrayBuffer(4);
  const source = new DataView(buffer);
  source.setFloat32(0, value, false);
  view.setUint8(offset, source.getUint8(0));
  view.setUint8(offset + 1, source.getUint8(1));
}

export function patchKmpEntityPosition(document: KmpDocument, entity: KmpEntity, position: Vec3): Uint8Array {
  const out = new Uint8Array(document.original);
  if (entity.section === 'POTI') {
    const view = new DataView(out.buffer);
    view.setFloat32(entity.rawOffset, position.x, false);
    view.setFloat32(entity.rawOffset + 4, position.y, false);
    view.setFloat32(entity.rawOffset + 8, position.z, false);
    return out;
  }

  if (entity.section === 'CKPT') {
    const view = new DataView(out.buffer);
    const x1 = view.getFloat32(entity.rawOffset, false);
    const z1 = view.getFloat32(entity.rawOffset + 4, false);
    const x2 = view.getFloat32(entity.rawOffset + 8, false);
    const z2 = view.getFloat32(entity.rawOffset + 12, false);
    const dx = position.x - entity.position.x;
    const dz = position.z - entity.position.z;
    view.setFloat32(entity.rawOffset, x1 + dx, false);
    view.setFloat32(entity.rawOffset + 4, z1 + dz, false);
    view.setFloat32(entity.rawOffset + 8, x2 + dx, false);
    view.setFloat32(entity.rawOffset + 12, z2 + dz, false);
    return out;
  }

  const section = document.sections.find((candidate) => candidate.name === entity.section);
  const positionOffset = POSITION_OFFSETS[entity.section];
  if (!section || positionOffset === undefined) return out;

  const view = new DataView(out.buffer);
  const base = entity.rawOffset + positionOffset;
  view.setFloat32(base, position.x, false);
  view.setFloat32(base + 4, position.y, false);
  view.setFloat32(base + 8, position.z, false);
  return out;
}

export function patchKmpEntityRotation(document: KmpDocument, entity: KmpEntity, rotation: Vec3): Uint8Array {
  const rotationOffset = ROTATION_OFFSETS[entity.section];
  if (rotationOffset === undefined || entity.recordSize < rotationOffset + 12) return document.original;
  return patchKmpVec3(document, entity, rotationOffset, rotation);
}

export function patchKmpCheckpointEndpoint(document: KmpDocument, entity: KmpEntity, side: 'left' | 'right', position: Vec3): Uint8Array {
  if (entity.section !== 'CKPT' || entity.recordSize < 0x10) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  const offset = side === 'left' ? 0x00 : 0x08;
  view.setFloat32(entity.rawOffset + offset, position.x, false);
  view.setFloat32(entity.rawOffset + offset + 4, position.z, false);
  return out;
}

export type KmpCheckpointField = Exclude<keyof NonNullable<KmpEntity['checkpoint']>, 'left' | 'right'>;

const CHECKPOINT_FIELD_OFFSETS: Record<KmpCheckpointField, number> = {
  respawnIndex: 0x10,
  type: 0x11,
  prev: 0x12,
  next: 0x13,
};

export function patchKmpCheckpointField(document: KmpDocument, entity: KmpEntity, field: KmpCheckpointField, value: number): Uint8Array {
  if (entity.section !== 'CKPT' || entity.recordSize < 0x14) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  view.setUint8(entity.rawOffset + CHECKPOINT_FIELD_OFFSETS[field], value & 0xff);
  return out;
}

export function patchKmpPointSetting(document: KmpDocument, entity: KmpEntity, settingIndex: number, value: number): Uint8Array {
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  if (entity.section === 'ENPT') {
    if (settingIndex === 0 && entity.recordSize >= 0x12) view.setUint16(entity.rawOffset + 0x10, value & 0xffff, false);
    else if (settingIndex === 1 && entity.recordSize >= 0x13) view.setUint8(entity.rawOffset + 0x12, value & 0xff);
    else if (settingIndex === 2 && entity.recordSize >= 0x14) view.setUint8(entity.rawOffset + 0x13, value & 0xff);
    return out;
  }
  if (entity.section === 'ITPT') {
    if (settingIndex === 0 && entity.recordSize >= 0x12) view.setUint16(entity.rawOffset + 0x10, value & 0xffff, false);
    else if (settingIndex === 1 && entity.recordSize >= 0x14) view.setUint16(entity.rawOffset + 0x12, value & 0xffff, false);
    return out;
  }
  return document.original;
}

export function patchKmpPointDeviation(document: KmpDocument, entity: KmpEntity, value: number): Uint8Array {
  if ((entity.section !== 'ENPT' && entity.section !== 'ITPT') || entity.recordSize < 0x10) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setFloat32(entity.rawOffset + 0x0c, value, false);
  return out;
}

export function patchKmpPotiRouteSetting(document: KmpDocument, entity: KmpEntity, settingIndex: number, value: number): Uint8Array {
  if (entity.section !== 'POTI' || !entity.routePoint || settingIndex < 0 || settingIndex > 1) return document.original;
  const route = document.routes[entity.routePoint.routeIndex];
  if (!route) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint8(route.rawOffset + 0x02 + settingIndex, value & 0xff);
  return out;
}

export function patchKmpPotiPointSetting(document: KmpDocument, entity: KmpEntity, settingIndex: number, value: number): Uint8Array {
  if (entity.section !== 'POTI' || settingIndex < 0 || settingIndex > 1 || entity.recordSize < 0x10) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset + 0x0c + settingIndex * 2, value & 0xffff, false);
  return out;
}

export type KmpAreaField = keyof NonNullable<KmpEntity['area']>;

export function patchKmpAreaField(document: KmpDocument, entity: KmpEntity, field: KmpAreaField, value: number): Uint8Array {
  if (entity.section !== 'AREA' || entity.recordSize < 0x2e) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  const base = entity.rawOffset;
  switch (field) {
    case 'shape':
      view.setUint8(base, value & 0xff);
      break;
    case 'type':
      view.setUint8(base + 0x01, value & 0xff);
      break;
    case 'cameraIndex':
      view.setUint8(base + 0x02, value & 0xff);
      break;
    case 'priority':
      view.setUint8(base + 0x03, value & 0xff);
      break;
    case 'setting1':
      view.setUint16(base + 0x28, value & 0xffff, false);
      break;
    case 'setting2':
      view.setUint16(base + 0x2a, value & 0xffff, false);
      break;
    case 'routeIndex':
      view.setUint8(base + 0x2c, value & 0xff);
      break;
    case 'enemyIndex':
      view.setUint8(base + 0x2d, value & 0xff);
      break;
  }
  return out;
}

export type KmpCameraField = keyof NonNullable<KmpEntity['camera']>;
export type KmpCameraHeaderField = 'firstIntroCam' | 'firstSelectionCam';

export function getKmpCameraHeader(document: KmpDocument): { firstIntroCam: number; firstSelectionCam: number } {
  const section = document.sections.find((candidate) => candidate.name === 'CAME');
  return {
    firstIntroCam: section ? (section.headerData >> 8) & 0xff : 0,
    firstSelectionCam: section ? section.headerData & 0xff : 0,
  };
}

export function patchKmpCameraHeaderField(document: KmpDocument, field: KmpCameraHeaderField, value: number): Uint8Array {
  const section = document.sections.find((candidate) => candidate.name === 'CAME');
  if (!section) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  view.setUint8(section.offset + (field === 'firstIntroCam' ? 6 : 7), value & 0xff);
  return out;
}

export function patchKmpCameraField(document: KmpDocument, entity: KmpEntity, field: KmpCameraField, value: number): Uint8Array {
  if (entity.section !== 'CAME' || entity.recordSize < 0x48) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  const base = entity.rawOffset;
  switch (field) {
    case 'type':
      view.setUint8(base, value & 0xff);
      break;
    case 'nextCam':
      view.setUint8(base + 0x01, value & 0xff);
      break;
    case 'shake':
      view.setUint8(base + 0x02, value & 0xff);
      break;
    case 'routeIndex':
      view.setUint8(base + 0x03, value & 0xff);
      break;
    case 'vCam':
      view.setUint16(base + 0x04, value & 0xffff, false);
      break;
    case 'vZoom':
      view.setUint16(base + 0x06, value & 0xffff, false);
      break;
    case 'vView':
      view.setUint16(base + 0x08, value & 0xffff, false);
      break;
    case 'start':
      view.setUint8(base + 0x0a, value & 0xff);
      break;
    case 'movie':
      view.setUint8(base + 0x0b, value & 0xff);
      break;
    case 'zoomStart':
      view.setFloat32(base + 0x24, value, false);
      break;
    case 'zoomEnd':
      view.setFloat32(base + 0x28, value, false);
      break;
    case 'time':
      view.setFloat32(base + 0x44, value, false);
      break;
  }
  return out;
}

export function patchKmpCameraViewPosition(document: KmpDocument, entity: KmpEntity, side: 'start' | 'end', position: Vec3): Uint8Array {
  if (entity.section !== 'CAME' || entity.recordSize < 0x44) return document.original;
  return patchKmpVec3(document, entity, side === 'start' ? 0x2c : 0x38, position);
}

export type KmpRespawnField = keyof NonNullable<KmpEntity['respawn']>;

export function patchKmpRespawnField(document: KmpDocument, entity: KmpEntity, field: KmpRespawnField, value: number): Uint8Array {
  if (entity.section !== 'JGPT' || entity.recordSize < 0x1c) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  view.setUint16(entity.rawOffset + (field === 'id' ? 0x18 : 0x1a), value & 0xffff, false);
  return out;
}

export type KmpCannonField = keyof NonNullable<KmpEntity['cannon']>;

export function patchKmpCannonField(document: KmpDocument, entity: KmpEntity, field: KmpCannonField, value: number): Uint8Array {
  if (entity.section !== 'CNPT' || entity.recordSize < 0x1c) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  view.setUint16(entity.rawOffset + (field === 'id' ? 0x18 : 0x1a), value & 0xffff, false);
  return out;
}

export type KmpBattleFinishField = keyof NonNullable<KmpEntity['battleFinish']>;

export function patchKmpBattleFinishField(document: KmpDocument, entity: KmpEntity, field: KmpBattleFinishField, value: number): Uint8Array {
  if (entity.section !== 'MSPT' || field !== 'id' || entity.recordSize < 0x1a) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset + 0x18, value & 0xffff, false);
  return out;
}

export type KmpStageField = Exclude<keyof NonNullable<KmpEntity['stage']>, 'flareColor'>;

export function patchKmpStageField(document: KmpDocument, entity: KmpEntity, field: KmpStageField, value: number): Uint8Array {
  if (entity.section !== 'STGI' || entity.recordSize < 0x0c) return document.original;
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  const base = entity.rawOffset;
  switch (field) {
    case 'lapCount':
      view.setUint8(base, value & 0xff);
      break;
    case 'polePosition':
      view.setUint8(base + 0x01, value & 0xff);
      break;
    case 'driverDistance':
      view.setUint8(base + 0x02, value & 0xff);
      break;
    case 'lensFlareFlash':
      view.setUint8(base + 0x03, value & 0xff);
      break;
    case 'unknown1':
      view.setUint8(base + 0x04, value & 0xff);
      break;
    case 'unknown2':
      view.setUint8(base + 0x09, value & 0xff);
      break;
    case 'speedMod':
      writeFloat32Msb2(view, base + 0x0a, value);
      break;
  }
  return out;
}

export function patchKmpStageFlareColor(document: KmpDocument, entity: KmpEntity, channelIndex: number, value: number): Uint8Array {
  if (entity.section !== 'STGI' || entity.recordSize < 0x09 || channelIndex < 0 || channelIndex >= 4) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint8(entity.rawOffset + 0x05 + channelIndex, value & 0xff);
  return out;
}

export function patchKmpEntityScale(document: KmpDocument, entity: KmpEntity, scale: Vec3): Uint8Array {
  const scaleOffset = SCALE_OFFSETS[entity.section];
  if (scaleOffset === undefined || entity.recordSize < scaleOffset + 12) return document.original;
  return patchKmpVec3(document, entity, scaleOffset, scale);
}

export function patchKmpEntityRouteIndex(document: KmpDocument, entity: KmpEntity, routeIndex: number): Uint8Array {
  if (entity.section !== 'GOBJ' || entity.recordSize < 0x2a) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset + 0x28, routeIndex & 0xffff, false);
  return out;
}

export function patchKmpGobjObjectId(document: KmpDocument, entity: KmpEntity, objectId: number): Uint8Array {
  if (entity.section !== 'GOBJ' || entity.recordSize < 0x02) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset, objectId & 0xffff, false);
  return out;
}

export function patchKmpGobjSetting(document: KmpDocument, entity: KmpEntity, settingIndex: number, value: number): Uint8Array {
  if (entity.section !== 'GOBJ' || settingIndex < 0 || settingIndex >= 8 || entity.recordSize < 0x3a) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset + 0x2a + settingIndex * 2, value & 0xffff, false);
  return out;
}

export function patchKmpGobjPresenceFlags(document: KmpDocument, entity: KmpEntity, value: number): Uint8Array {
  if (entity.section !== 'GOBJ' || entity.recordSize < 0x3c) return document.original;
  const out = new Uint8Array(document.original);
  new DataView(out.buffer).setUint16(entity.rawOffset + 0x3a, value & 0xffff, false);
  return out;
}

export function patchKmpPathGroupLinks(document: KmpDocument, groupSectionName: 'ENPH' | 'ITPH' | 'CKPH', groupIndex: number, side: 'prev' | 'next', links: number[]): Uint8Array {
  const groupSection = document.sections.find((section) => section.name === groupSectionName);
  if (!groupSection) throw new Error(`Cannot edit ${groupSectionName}: section is missing.`);
  if (groupIndex < 0 || groupIndex >= groupSection.count) throw new Error(`Cannot edit ${groupSectionName}: group ${groupIndex} is missing.`);
  const normalized = normalizeGroupLinks(links, groupSection.count);
  const out = new Uint8Array(document.original);
  const base = groupSection.offset + 8 + groupIndex * 0x10 + (side === 'prev' ? 2 : 8);
  out.fill(0xff, base, base + 6);
  for (let i = 0; i < normalized.length; i++) out[base + i] = normalized[i];
  return out;
}

export function deleteKmpEntity(document: KmpDocument, entity: KmpEntity): Uint8Array {
  if (entity.section === 'STGI') throw new Error('Cannot delete STGI track settings.');
  if (entity.routePoint) return deleteKmpPotiPoint(document, entity.routePoint.routeIndex, entity.routePoint.pointIndex);
  if (entity.section === 'ENPT') return deleteKmpPathPoint(document, entity, 'ENPT', 'ENPH');
  if (entity.section === 'ITPT') return deleteKmpPathPoint(document, entity, 'ITPT', 'ITPH');
  if (entity.section === 'CKPT') return deleteKmpPathPoint(document, entity, 'CKPT', 'CKPH');
  return deleteKmpFixedRecord(document, entity.section, entity.index);
}

export function moveKmpEntity(document: KmpDocument, entity: KmpEntity, direction: -1 | 1): Uint8Array {
  if (entity.section === 'STGI') throw new Error('Cannot reorder STGI track settings.');
  if (entity.routePoint) return moveKmpPotiPoint(document, entity.routePoint.routeIndex, entity.routePoint.pointIndex, direction);
  return moveKmpFixedRecord(document, entity.section, entity.index, direction);
}

export function splitKmpPathGroup(document: KmpDocument, pointSectionName: 'ENPT' | 'ITPT' | 'CKPT', groupIndex: number, localPointIndex: number): Uint8Array {
  const graph = document.pathGraphs.find((candidate) => candidate.pointSection === pointSectionName);
  if (!graph) throw new Error(`Cannot split ${pointSectionName}: path graph is missing.`);
  const group = graph.groups[groupIndex];
  if (!group) throw new Error(`Cannot split ${pointSectionName}: group ${groupIndex} is missing.`);
  if (localPointIndex < 0 || localPointIndex >= group.pointCount - 1) throw new Error(`Cannot split ${pointSectionName}: choose a point before the end of the group.`);
  if (graph.groups.length >= 0xffff) throw new Error(`Cannot split ${pointSectionName}: maximum group count reached.`);

  const insertIndex = groupIndex + 1;
  const remap = (index: number) => (index >= insertIndex ? index + 1 : index);
  const newGroup: KmpPathGroup = {
    section: graph.groupSection,
    index: insertIndex,
    startIndex: group.startIndex + localPointIndex + 1,
    pointCount: group.pointCount - localPointIndex - 1,
    prevGroups: [groupIndex],
    nextGroups: group.nextGroups.map(remap),
  };
  const groups = graph.groups.map((candidate) => ({ ...candidate, prevGroups: [...candidate.prevGroups], nextGroups: [...candidate.nextGroups] }));
  groups[groupIndex] = { ...groups[groupIndex], pointCount: localPointIndex + 1, nextGroups: [insertIndex] };
  groups.splice(insertIndex, 0, newGroup);
  const remappedOldNextGroups = group.nextGroups.map(remap);
  for (const candidate of groups) {
    candidate.index = groups.indexOf(candidate);
    if (candidate.index !== groupIndex && candidate.index !== insertIndex) {
      candidate.prevGroups = candidate.prevGroups.map((link) => (link === groupIndex && remappedOldNextGroups.includes(candidate.index) ? insertIndex : remap(link)));
      candidate.nextGroups = candidate.nextGroups.map(remap);
    }
  }
  return replaceKmpSectionPayload(document, graph.groupSection, buildPathGroupPayload(groups), groups.length);
}

export function mergeKmpPathGroupWithNext(document: KmpDocument, pointSectionName: 'ENPT' | 'ITPT' | 'CKPT', groupIndex: number): Uint8Array {
  const graph = document.pathGraphs.find((candidate) => candidate.pointSection === pointSectionName);
  if (!graph) throw new Error(`Cannot merge ${pointSectionName}: path graph is missing.`);
  const group = graph.groups[groupIndex];
  if (!group) throw new Error(`Cannot merge ${pointSectionName}: group ${groupIndex} is missing.`);
  if (group.nextGroups.length !== 1) throw new Error(`Cannot merge ${pointSectionName}: group must have exactly one next group.`);
  const nextIndex = group.nextGroups[0];
  const nextGroup = graph.groups[nextIndex];
  if (!nextGroup) throw new Error(`Cannot merge ${pointSectionName}: next group ${nextIndex} is missing.`);
  if (group.startIndex + group.pointCount !== nextGroup.startIndex) throw new Error(`Cannot merge ${pointSectionName}: next group is not contiguous.`);

  const groups = graph.groups.map((candidate) => ({ ...candidate, prevGroups: [...candidate.prevGroups], nextGroups: [...candidate.nextGroups] }));
  groups[groupIndex] = { ...groups[groupIndex], pointCount: group.pointCount + nextGroup.pointCount, nextGroups: [...nextGroup.nextGroups] };
  groups.splice(nextIndex, 1);
  const remap = (index: number) => (index > nextIndex ? index - 1 : index);
  for (const candidate of groups) {
    candidate.index = groups.indexOf(candidate);
    candidate.prevGroups = candidate.prevGroups.map((link) => (link === nextIndex ? groupIndex : remap(link))).filter((link, index, links) => link !== candidate.index && links.indexOf(link) === index);
    candidate.nextGroups = candidate.nextGroups.map((link) => (link === nextIndex ? groupIndex : remap(link))).filter((link, index, links) => link !== candidate.index && links.indexOf(link) === index);
  }
  return replaceKmpSectionPayload(document, graph.groupSection, buildPathGroupPayload(groups), groups.length);
}

export function appendKmpGobj(document: KmpDocument, objectId: number, position: Vec3): Uint8Array {
  return appendKmpRecord(document, 'GOBJ', createGobjRecord(objectId, position));
}

export function appendKmpArea(document: KmpDocument, position: Vec3): Uint8Array {
  return appendKmpRecord(document, 'AREA', createAreaRecord(position));
}

export function appendKmpCamera(document: KmpDocument, position: Vec3): Uint8Array {
  return appendKmpRecord(document, 'CAME', createCameraRecord(position));
}

export function appendKmpPoint(document: KmpDocument, sectionName: AppendableKmpPointSection, position: Vec3): Uint8Array {
  const recordSize = SECTION_RECORD_SIZE[sectionName];
  const positionOffset = POSITION_OFFSETS[sectionName];
  if (!recordSize || positionOffset === undefined) throw new Error(`Cannot add ${sectionName}: unsupported point section.`);
  const record = new Uint8Array(recordSize);
  const view = new DataView(record.buffer);
  view.setFloat32(positionOffset, position.x, false);
  view.setFloat32(positionOffset + 4, position.y, false);
  view.setFloat32(positionOffset + 8, position.z, false);
  if (sectionName === 'ENPT' || sectionName === 'ITPT') view.setFloat32(0x0c, 10, false);
  const appended = appendKmpRecord(document, sectionName, record);
  if (sectionName === 'ENPT') return connectAppendedPathPoint(appended, 'ENPT', 'ENPH');
  if (sectionName === 'ITPT') return connectAppendedPathPoint(appended, 'ITPT', 'ITPH');
  return appended;
}

export function appendKmpCheckpoint(document: KmpDocument, position: Vec3, width = 1200): Uint8Array {
  const record = new Uint8Array(SECTION_RECORD_SIZE.CKPT);
  const view = new DataView(record.buffer);
  const halfWidth = width / 2;
  view.setFloat32(0x00, position.x - halfWidth, false);
  view.setFloat32(0x04, position.z, false);
  view.setFloat32(0x08, position.x + halfWidth, false);
  view.setFloat32(0x0c, position.z, false);
  view.setUint8(0x10, 0xff);
  view.setUint8(0x11, 0xff);
  view.setUint8(0x12, 0);
  view.setUint8(0x13, 0);
  return connectAppendedPathPoint(appendKmpRecord(document, 'CKPT', record), 'CKPT', 'CKPH');
}

export function appendKmpPotiRoute(document: KmpDocument, position: Vec3): Uint8Array {
  const record = new Uint8Array(0x14);
  const view = new DataView(record.buffer);
  view.setUint16(0x00, 1, false);
  view.setUint8(0x02, 0);
  view.setUint8(0x03, 0);
  view.setFloat32(0x04, position.x, false);
  view.setFloat32(0x08, position.y, false);
  view.setFloat32(0x0c, position.z, false);
  view.setUint16(0x10, 0, false);
  view.setUint16(0x12, 0, false);
  return appendKmpVariableRecord(document, 'POTI', record);
}

export function appendKmpPotiPoint(document: KmpDocument, routeIndex: number, afterPointIndex: number, position: Vec3): Uint8Array {
  const route = document.routes[routeIndex];
  const section = document.sections.find((candidate) => candidate.name === 'POTI');
  if (!route || !section) throw new Error(`Cannot add POTI node: route ${routeIndex} is missing.`);
  if (route.points.length >= 0xffff) throw new Error(`Cannot add POTI node: route ${routeIndex} already has the maximum number of nodes.`);
  const clampedAfter = Math.max(-1, Math.min(afterPointIndex, route.points.length - 1));
  const insertOffset = route.rawOffset + 4 + (clampedAfter + 1) * 0x10;
  const record = createPotiPointRecord(position);
  const out = insertBytesAfterSectionRecord(document, 'POTI', section.offset, insertOffset, record);
  new DataView(out.buffer).setUint16(route.rawOffset, route.points.length + 1, false);
  return out;
}

function appendKmpRecord(document: KmpDocument, sectionName: string, record: Uint8Array): Uint8Array {
  const reader = new BinReader(document.original.slice().buffer);
  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsetSlots = Array.from({ length: sectionCount }, (_, i) => offsetsStart + i * 4);
  const offsets = offsetSlots.map((slot) => headerSize + reader.u32(slot));
  const sectionIndex = offsets.findIndex((offset) => reader.ascii(offset, 4) === sectionName);
  if (sectionIndex < 0) throw new Error(`Cannot add ${sectionName}: section is missing.`);

  const sectionOffset = offsets[sectionIndex];
  const currentCount = reader.u16(sectionOffset + 4);
  const insertOffset = sectionOffset + 8 + currentCount * record.length;
  const out = new Uint8Array(document.original.length + record.length);
  out.set(document.original.slice(0, insertOffset), 0);
  out.set(record, insertOffset);
  out.set(document.original.slice(insertOffset), insertOffset + record.length);

  const view = new DataView(out.buffer);
  view.setUint32(4, out.length, false);
  view.setUint16(sectionOffset + 4, currentCount + 1, false);
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > sectionOffset) view.setUint32(offsetSlots[i], offsets[i] + record.length - headerSize, false);
  }
  return out;
}

function connectAppendedPathPoint(data: Uint8Array, pointSectionName: 'ENPT' | 'ITPT' | 'CKPT', groupSectionName: 'ENPH' | 'ITPH' | 'CKPH'): Uint8Array {
  const document = parseKmp(data);
  const groupSection = document.sections.find((section) => section.name === groupSectionName);
  const pointSection = document.sections.find((section) => section.name === pointSectionName);
  if (!groupSection || !pointSection) return data;
  if (groupSection.count === 0) return createFirstPathGroup(document, pointSectionName, groupSectionName);
  const graph = document.pathGraphs.find((candidate) => candidate.pointSection === pointSectionName);
  const lastGroup = graph?.groups.at(-1);
  if (!lastGroup || lastGroup.pointCount >= 0xff) return data;
  if (lastGroup.startIndex + lastGroup.pointCount !== pointSection.count - 1) return data;
  const out = new Uint8Array(data);
  new DataView(out.buffer).setUint8(groupSection.offset + 8 + lastGroup.index * 0x10 + 1, lastGroup.pointCount + 1);
  return out;
}

function createFirstPathGroup(document: KmpDocument, pointSectionName: 'ENPT' | 'ITPT' | 'CKPT', groupSectionName: 'ENPH' | 'ITPH' | 'CKPH'): Uint8Array {
  const pointSection = document.sections.find((section) => section.name === pointSectionName);
  const groupSection = document.sections.find((section) => section.name === groupSectionName);
  if (!pointSection || !groupSection || pointSection.count === 0 || pointSection.count > 0xff) return document.original;
  const record = new Uint8Array(SECTION_RECORD_SIZE[groupSectionName]);
  record.fill(0xff);
  record[0] = pointSection.count - 1;
  record[1] = 1;
  return appendKmpRecord(document, groupSectionName, record);
}

function appendKmpVariableRecord(document: KmpDocument, sectionName: string, record: Uint8Array): Uint8Array {
  const reader = new BinReader(document.original.slice().buffer);
  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsetSlots = Array.from({ length: sectionCount }, (_, i) => offsetsStart + i * 4);
  const offsets = offsetSlots.map((slot) => headerSize + reader.u32(slot));
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const sectionIndex = offsets.findIndex((offset) => reader.ascii(offset, 4) === sectionName);
  if (sectionIndex < 0) throw new Error(`Cannot add ${sectionName}: section is missing.`);

  const sectionOffset = offsets[sectionIndex];
  const currentCount = reader.u16(sectionOffset + 4);
  const sortedIndex = sortedOffsets.indexOf(sectionOffset);
  const insertOffset = sortedOffsets[sortedIndex + 1] ?? document.original.length;
  const out = new Uint8Array(document.original.length + record.length);
  out.set(document.original.slice(0, insertOffset), 0);
  out.set(record, insertOffset);
  out.set(document.original.slice(insertOffset), insertOffset + record.length);

  const view = new DataView(out.buffer);
  view.setUint32(4, out.length, false);
  view.setUint16(sectionOffset + 4, currentCount + 1, false);
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > sectionOffset) view.setUint32(offsetSlots[i], offsets[i] + record.length - headerSize, false);
  }
  return out;
}

function insertBytesAfterSectionRecord(document: KmpDocument, sectionName: string, sectionOffset: number, insertOffset: number, record: Uint8Array): Uint8Array {
  const reader = new BinReader(document.original.slice().buffer);
  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsetSlots = Array.from({ length: sectionCount }, (_, i) => offsetsStart + i * 4);
  const offsets = offsetSlots.map((slot) => headerSize + reader.u32(slot));
  if (!offsets.some((offset) => offset === sectionOffset && reader.ascii(offset, 4) === sectionName)) throw new Error(`Cannot edit ${sectionName}: section is missing.`);
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const sortedIndex = sortedOffsets.indexOf(sectionOffset);
  const sectionEnd = sortedOffsets[sortedIndex + 1] ?? document.original.length;
  if (insertOffset < sectionOffset + 8 || insertOffset > sectionEnd) throw new Error(`Cannot edit ${sectionName}: insert position is outside the section.`);

  const out = new Uint8Array(document.original.length + record.length);
  out.set(document.original.slice(0, insertOffset), 0);
  out.set(record, insertOffset);
  out.set(document.original.slice(insertOffset), insertOffset + record.length);

  const view = new DataView(out.buffer);
  view.setUint32(4, out.length, false);
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > sectionOffset) view.setUint32(offsetSlots[i], offsets[i] + record.length - headerSize, false);
  }
  return out;
}

function deleteKmpFixedRecord(document: KmpDocument, sectionName: string, index: number): Uint8Array {
  const section = document.sections.find((candidate) => candidate.name === sectionName);
  const recordSize = SECTION_RECORD_SIZE[sectionName] || (section && section.count > 0 && section.data.length % section.count === 0 ? section.data.length / section.count : 0);
  if (!section || !recordSize) throw new Error(`Cannot delete ${sectionName}: section is missing or unsupported.`);
  if (index < 0 || index >= section.count) throw new Error(`Cannot delete ${sectionName}: record ${index} is missing.`);
  const deleteOffset = section.offset + 8 + index * recordSize;
  return removeBytesFromSection(document, sectionName, section.offset, deleteOffset, recordSize, true);
}

function moveKmpFixedRecord(document: KmpDocument, sectionName: string, index: number, direction: -1 | 1): Uint8Array {
  const section = document.sections.find((candidate) => candidate.name === sectionName);
  const recordSize = SECTION_RECORD_SIZE[sectionName] || (section && section.count > 0 && section.data.length % section.count === 0 ? section.data.length / section.count : 0);
  if (!section || !recordSize) throw new Error(`Cannot reorder ${sectionName}: section is missing or unsupported.`);
  const swapIndex = index + direction;
  if (index < 0 || index >= section.count || swapIndex < 0 || swapIndex >= section.count) return document.original;
  const a = section.offset + 8 + index * recordSize;
  const b = section.offset + 8 + swapIndex * recordSize;
  return swapByteRanges(document.original, a, b, recordSize);
}

function deleteKmpPathPoint(document: KmpDocument, entity: KmpEntity, pointSectionName: 'ENPT' | 'ITPT' | 'CKPT', groupSectionName: 'ENPH' | 'ITPH' | 'CKPH'): Uint8Array {
  const graph = document.pathGraphs.find((candidate) => candidate.pointSection === pointSectionName);
  const withoutPoint = parseKmp(deleteKmpFixedRecord(document, pointSectionName, entity.index));
  if (!graph) return withoutPoint.original;

  const keptGroups = graph.groups
    .map((group) => {
      const startIndex = entity.index < group.startIndex ? group.startIndex - 1 : group.startIndex;
      const pointCount = entity.index >= group.startIndex && entity.index < group.startIndex + group.pointCount ? group.pointCount - 1 : group.pointCount;
      return { ...group, startIndex, pointCount };
    })
    .filter((group) => group.pointCount > 0 && group.startIndex >= 0 && group.startIndex + group.pointCount <= (withoutPoint.sections.find((section) => section.name === pointSectionName)?.count ?? 0));
  const remap = new Map<number, number>();
  keptGroups.forEach((group, index) => remap.set(group.index, index));
  const payload = new Uint8Array(keptGroups.length * 0x10);
  for (let i = 0; i < keptGroups.length; i++) {
    const group = keptGroups[i];
    payload[i * 0x10] = group.startIndex;
    payload[i * 0x10 + 1] = group.pointCount;
    writeGroupLinks(payload, i * 0x10 + 2, group.prevGroups.map((link) => remap.get(link)).filter((link): link is number => link !== undefined), keptGroups.length);
    writeGroupLinks(payload, i * 0x10 + 8, group.nextGroups.map((link) => remap.get(link)).filter((link): link is number => link !== undefined), keptGroups.length);
  }
  return replaceKmpSectionPayload(withoutPoint, groupSectionName, payload, keptGroups.length);
}

function moveKmpPotiPoint(document: KmpDocument, routeIndex: number, pointIndex: number, direction: -1 | 1): Uint8Array {
  const route = document.routes[routeIndex];
  if (!route) throw new Error(`Cannot reorder POTI node: route ${routeIndex} is missing.`);
  const swapIndex = pointIndex + direction;
  if (pointIndex < 0 || pointIndex >= route.points.length || swapIndex < 0 || swapIndex >= route.points.length) return document.original;
  return swapByteRanges(document.original, route.points[pointIndex].rawOffset, route.points[swapIndex].rawOffset, 0x10);
}

function deleteKmpPotiPoint(document: KmpDocument, routeIndex: number, pointIndex: number): Uint8Array {
  const route = document.routes[routeIndex];
  const section = document.sections.find((candidate) => candidate.name === 'POTI');
  if (!route || !section) throw new Error(`Cannot delete POTI node: route ${routeIndex} is missing.`);
  if (pointIndex < 0 || pointIndex >= route.points.length) throw new Error(`Cannot delete POTI node: node ${pointIndex} is missing.`);
  if (route.points.length <= 1) return removeBytesFromSection(document, 'POTI', section.offset, route.rawOffset, 4 + route.points.length * 0x10, true);
  const point = route.points[pointIndex];
  const out = removeBytesFromSection(document, 'POTI', section.offset, point.rawOffset, 0x10, false);
  new DataView(out.buffer).setUint16(route.rawOffset, route.points.length - 1, false);
  return out;
}

function removeBytesFromSection(document: KmpDocument, sectionName: string, sectionOffset: number, deleteOffset: number, byteLength: number, decrementCount: boolean): Uint8Array {
  const reader = new BinReader(document.original.slice().buffer);
  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsetSlots = Array.from({ length: sectionCount }, (_, i) => offsetsStart + i * 4);
  const offsets = offsetSlots.map((slot) => headerSize + reader.u32(slot));
  if (!offsets.some((offset) => offset === sectionOffset && reader.ascii(offset, 4) === sectionName)) throw new Error(`Cannot edit ${sectionName}: section is missing.`);
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const sortedIndex = sortedOffsets.indexOf(sectionOffset);
  const sectionEnd = sortedOffsets[sortedIndex + 1] ?? document.original.length;
  if (byteLength < 0 || deleteOffset < sectionOffset + 8 || deleteOffset + byteLength > sectionEnd) throw new Error(`Cannot edit ${sectionName}: delete range is outside the section.`);

  const out = new Uint8Array(document.original.length - byteLength);
  out.set(document.original.slice(0, deleteOffset), 0);
  out.set(document.original.slice(deleteOffset + byteLength), deleteOffset);

  const view = new DataView(out.buffer);
  view.setUint32(4, out.length, false);
  if (decrementCount) view.setUint16(sectionOffset + 4, Math.max(0, reader.u16(sectionOffset + 4) - 1), false);
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > sectionOffset) view.setUint32(offsetSlots[i], offsets[i] - byteLength - headerSize, false);
  }
  return out;
}

function replaceKmpSectionPayload(document: KmpDocument, sectionName: string, payload: Uint8Array, count: number): Uint8Array {
  const section = document.sections.find((candidate) => candidate.name === sectionName);
  if (!section) throw new Error(`Cannot replace ${sectionName}: section is missing.`);
  const reader = new BinReader(document.original.slice().buffer);
  const sectionCount = reader.u16(0x08);
  const headerSize = reader.u16(0x0a);
  const offsetsStart = 0x10;
  const offsetSlots = Array.from({ length: sectionCount }, (_, i) => offsetsStart + i * 4);
  const offsets = offsetSlots.map((slot) => headerSize + reader.u32(slot));
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  const sortedIndex = sortedOffsets.indexOf(section.offset);
  const payloadStart = section.offset + 8;
  const payloadEnd = sortedOffsets[sortedIndex + 1] ?? document.original.length;
  const delta = payload.length - (payloadEnd - payloadStart);

  const out = new Uint8Array(document.original.length + delta);
  out.set(document.original.slice(0, payloadStart), 0);
  out.set(payload, payloadStart);
  out.set(document.original.slice(payloadEnd), payloadStart + payload.length);

  const view = new DataView(out.buffer);
  view.setUint32(4, out.length, false);
  view.setUint16(section.offset + 4, count, false);
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] > section.offset) view.setUint32(offsetSlots[i], offsets[i] + delta - headerSize, false);
  }
  return out;
}

function swapByteRanges(data: Uint8Array, a: number, b: number, byteLength: number): Uint8Array {
  const out = new Uint8Array(data);
  const first = out.slice(a, a + byteLength);
  out.copyWithin(a, b, b + byteLength);
  out.set(first, b);
  return out;
}

function patchKmpVec3(document: KmpDocument, entity: KmpEntity, relativeOffset: number, value: Vec3): Uint8Array {
  const out = new Uint8Array(document.original);
  const view = new DataView(out.buffer);
  const base = entity.rawOffset + relativeOffset;
  view.setFloat32(base, value.x, false);
  view.setFloat32(base + 4, value.y, false);
  view.setFloat32(base + 8, value.z, false);
  return out;
}

function parsePathGraphs(reader: BinReader, sections: KmpSection[], entities: KmpEntity[], warnings: string[]): KmpPathGraph[] {
  return [
    parsePathGraph(reader, sections, entities, 'ENPT', 'ENPH', warnings),
    parsePathGraph(reader, sections, entities, 'ITPT', 'ITPH', warnings),
    parsePathGraph(reader, sections, entities, 'CKPT', 'CKPH', warnings),
  ].filter((graph): graph is KmpPathGraph => graph !== null);
}

function parsePathGraph(
  reader: BinReader,
  sections: KmpSection[],
  entities: KmpEntity[],
  pointSection: KmpPathGraph['pointSection'],
  groupSection: KmpPathGraph['groupSection'],
  warnings: string[],
): KmpPathGraph | null {
  const pointCount = entities.filter((entity) => entity.section === pointSection).length;
  const section = sections.find((candidate) => candidate.name === groupSection);
  if (!section || section.count === 0) return null;

  const groups: KmpPathGroup[] = [];
  const edges: KmpPathGraph['edges'] = [];
  for (let index = 0; index < section.count; index++) {
    const offset = section.offset + 8 + index * 0x10;
    if (offset + 0x10 > reader.buffer.byteLength) break;
    const group: KmpPathGroup = {
      section: groupSection,
      index,
      startIndex: reader.u8(offset),
      pointCount: reader.u8(offset + 1),
      prevGroups: readGroupLinks(reader, offset + 2, section.count),
      nextGroups: readGroupLinks(reader, offset + 8, section.count),
    };
    groups.push(group);

    const endExclusive = group.startIndex + group.pointCount;
    if (group.startIndex >= pointCount || endExclusive > pointCount) {
      warnings.push(`${groupSection} group ${index} references points outside ${pointSection}.`);
      continue;
    }
    for (let point = group.startIndex; point < endExclusive - 1; point++) edges.push({ from: point, to: point + 1, kind: 'sequence' });
  }

  for (const group of groups) {
    const lastPoint = group.startIndex + group.pointCount - 1;
    for (const nextGroupIndex of group.nextGroups) {
      const nextGroup = groups[nextGroupIndex];
      if (!nextGroup) continue;
      edges.push({ from: lastPoint, to: nextGroup.startIndex, kind: 'group' });
    }
  }

  return { pointSection, groupSection, groups, edges };
}

function readGroupLinks(reader: BinReader, offset: number, groupCount: number): number[] {
  const links: number[] = [];
  for (let i = 0; i < 6; i++) {
    const value = reader.u8(offset + i);
    if (value !== 0xff && value < groupCount) links.push(value);
  }
  return links;
}

function normalizeGroupLinks(links: number[], groupCount: number): number[] {
  const out: number[] = [];
  for (const link of links) {
    const value = Math.trunc(link);
    if (!Number.isFinite(value) || value < 0 || value >= groupCount || out.includes(value)) continue;
    out.push(value);
    if (out.length >= 6) break;
  }
  return out;
}

function writeGroupLinks(dst: Uint8Array, offset: number, links: number[], groupCount: number): void {
  dst.fill(0xff, offset, offset + 6);
  const normalized = normalizeGroupLinks(links, groupCount);
  for (let i = 0; i < normalized.length; i++) dst[offset + i] = normalized[i];
}

function buildPathGroupPayload(groups: KmpPathGroup[]): Uint8Array {
  const payload = new Uint8Array(groups.length * 0x10);
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    payload[i * 0x10] = group.startIndex & 0xff;
    payload[i * 0x10 + 1] = group.pointCount & 0xff;
    writeGroupLinks(payload, i * 0x10 + 2, group.prevGroups, groups.length);
    writeGroupLinks(payload, i * 0x10 + 8, group.nextGroups, groups.length);
  }
  return payload;
}

function parseRoutes(reader: BinReader, sections: KmpSection[], warnings: string[]): KmpRoute[] {
  const section = sections.find((candidate) => candidate.name === 'POTI');
  if (!section) return [];
  const routes: KmpRoute[] = [];
  let offset = section.offset + 8;
  for (let index = 0; index < section.count; index++) {
    if (offset + 4 > reader.buffer.byteLength) break;
    const rawOffset = offset;
    const pointCount = reader.u16(offset);
    const setting1 = reader.u8(offset + 2);
    const setting2 = reader.u8(offset + 3);
    offset += 4;
    const points: KmpRoutePoint[] = [];
    for (let point = 0; point < pointCount; point++) {
      if (offset + 0x10 > reader.buffer.byteLength) {
        warnings.push(`POTI route ${index} is truncated.`);
        break;
      }
      points.push({
        position: readVec3(reader, offset),
        setting1: reader.u16(offset + 0x0c),
        setting2: reader.u16(offset + 0x0e),
        rawOffset: offset,
        routeIndex: index,
        pointIndex: point,
      });
      offset += 0x10;
    }
    routes.push({ index, rawOffset, setting1, setting2, points });
  }
  return routes;
}

function routePointEntities(routes: KmpRoute[]): KmpEntity[] {
  let globalIndex = 0;
  return routes.flatMap((route) =>
    route.points.map((point) => ({
      id: `POTI-${route.index}-${point.pointIndex}`,
      section: 'POTI',
      index: globalIndex++,
      position: point.position,
      routePoint: { routeIndex: route.index, pointIndex: point.pointIndex },
      poti: {
        routeSetting1: route.setting1,
        routeSetting2: route.setting2,
        pointSetting1: point.setting1,
        pointSetting2: point.setting2,
      },
      rawOffset: point.rawOffset,
      recordSize: 0x10,
    })),
  );
}

function createGobjRecord(objectId: number, position: Vec3): Uint8Array {
  const out = new Uint8Array(SECTION_RECORD_SIZE.GOBJ);
  const view = new DataView(out.buffer);
  view.setUint16(0x00, objectId & 0xffff, false);
  view.setUint16(0x02, 0, false);
  view.setFloat32(0x04, position.x, false);
  view.setFloat32(0x08, position.y, false);
  view.setFloat32(0x0c, position.z, false);
  view.setFloat32(0x10, 0, false);
  view.setFloat32(0x14, 0, false);
  view.setFloat32(0x18, 0, false);
  view.setFloat32(0x1c, 1, false);
  view.setFloat32(0x20, 1, false);
  view.setFloat32(0x24, 1, false);
  view.setUint16(0x28, 0xffff, false);
  for (let i = 0; i < 8; i++) view.setUint16(0x2a + i * 2, 0, false);
  view.setUint16(0x3a, 0x003f, false);
  return out;
}

function createAreaRecord(position: Vec3): Uint8Array {
  const out = new Uint8Array(SECTION_RECORD_SIZE.AREA);
  const view = new DataView(out.buffer);
  view.setUint8(0x00, 0);
  view.setUint8(0x01, 0);
  view.setUint8(0x02, 0xff);
  view.setUint8(0x03, 0);
  view.setFloat32(0x04, position.x, false);
  view.setFloat32(0x08, position.y, false);
  view.setFloat32(0x0c, position.z, false);
  view.setFloat32(0x10, 0, false);
  view.setFloat32(0x14, 0, false);
  view.setFloat32(0x18, 0, false);
  view.setFloat32(0x1c, 1, false);
  view.setFloat32(0x20, 1, false);
  view.setFloat32(0x24, 1, false);
  view.setUint16(0x28, 0, false);
  view.setUint16(0x2a, 0, false);
  view.setUint8(0x2c, 0xff);
  view.setUint8(0x2d, 0xff);
  view.setUint16(0x2e, 0, false);
  return out;
}

function createCameraRecord(position: Vec3): Uint8Array {
  const out = new Uint8Array(SECTION_RECORD_SIZE.CAME);
  const view = new DataView(out.buffer);
  view.setUint8(0x00, 0);
  view.setUint8(0x01, 0);
  view.setUint8(0x02, 0);
  view.setUint8(0x03, 0xff);
  view.setUint16(0x04, 0, false);
  view.setUint16(0x06, 0, false);
  view.setUint16(0x08, 0, false);
  view.setUint8(0x0a, 0);
  view.setUint8(0x0b, 0);
  view.setFloat32(0x0c, position.x, false);
  view.setFloat32(0x10, position.y, false);
  view.setFloat32(0x14, position.z, false);
  view.setFloat32(0x18, 0, false);
  view.setFloat32(0x1c, 0, false);
  view.setFloat32(0x20, 0, false);
  view.setFloat32(0x24, 0, false);
  view.setFloat32(0x28, 0, false);
  view.setFloat32(0x2c, 0, false);
  view.setFloat32(0x30, 0, false);
  view.setFloat32(0x34, 0, false);
  view.setFloat32(0x38, 0, false);
  view.setFloat32(0x3c, 0, false);
  view.setFloat32(0x40, 0, false);
  view.setFloat32(0x44, 0, false);
  return out;
}

function createPotiPointRecord(position: Vec3): Uint8Array {
  const out = new Uint8Array(0x10);
  const view = new DataView(out.buffer);
  view.setFloat32(0x00, position.x, false);
  view.setFloat32(0x04, position.y, false);
  view.setFloat32(0x08, position.z, false);
  view.setUint16(0x0c, 0, false);
  view.setUint16(0x0e, 0, false);
  return out;
}
