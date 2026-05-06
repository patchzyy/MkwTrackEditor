export type RgbaColor = [number, number, number, number];
export type RgbColor = [number, number, number];

export interface PostEffectFogEntry {
  index: number;
  fogType: number;
  startZ: number;
  endZ: number;
  color: RgbColor;
  alpha: number;
  fadeSpeed: number;
}

export interface PostEffectBloomFile {
  thresholdAmount: number;
  thresholdColor: RgbaColor;
  compositeColor: RgbaColor;
  blurFlags: number;
  blur0Radius: number;
  blur0Intensity: number;
  blur1Radius: number;
  blur1Intensity: number;
  compositeBlendMode: number;
  blur1NumPasses: number;
  bokehColorScale0: number;
  bokehColorScale1: number;
}

export interface PostEffectDofFile {
  flags: number;
  blurAlpha: readonly [number, number];
  drawMode: number;
  blurDrawAmount: number;
  depthCurveType: number;
  focusCenter: number;
  focusRange: number;
  blurRadius: number;
  indTexTransSScroll: number;
  indTexTransTScroll: number;
  indTexIndScaleS: number;
  indTexIndScaleT: number;
  indTexScaleS: number;
  indTexScaleT: number;
}

export interface PostEffectBlightObject {
  spotFunction: number;
  distAttnFunction: number;
  coordinateSystem: number;
  lightType: number;
  ambientLightIndex: number;
  flags: number;
  origin: [number, number, number];
  destination: [number, number, number];
  intensity: number;
  color: RgbaColor;
  specColor: RgbaColor;
  spotCutoff: number;
  refDist: number;
  refBrightness: number;
  linkedLightIndex: number;
}

export interface PostEffectBlightFile {
  ambientBlackColor: RgbaColor;
  ambientLights: RgbaColor[];
  lightObjects: PostEffectBlightObject[];
}

const BFG_ENTRY_SIZE = 0x1c;
const BFG_ENTRY_COUNT = 4;
const BFG_FILE_SIZE = BFG_ENTRY_SIZE * BFG_ENTRY_COUNT;
const BBLM_FILE_SIZE = 0xa4;
const BDOF_FILE_SIZE = 0x50;
const BLIGHT_FILE_SIZE = 0x5a8;
const BLIGHT_LIGHT_COUNT = 16;
const BLIGHT_AMBIENT_COUNT = 16;
const BLIGHT_LIGHT_SIZE = 0x50;
const BLIGHT_AMBIENT_SIZE = 0x08;

export function parseBfgFogEntries(data: Uint8Array): PostEffectFogEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: PostEffectFogEntry[] = [];
  const count = Math.min(BFG_ENTRY_COUNT, Math.floor(data.byteLength / BFG_ENTRY_SIZE));
  for (let index = 0; index < count; index++) {
    const base = index * BFG_ENTRY_SIZE;
    out.push({
      index,
      fogType: view.getInt32(base, false),
      startZ: view.getFloat32(base + 0x04, false),
      endZ: view.getFloat32(base + 0x08, false),
      color: [view.getUint8(base + 0x0c), view.getUint8(base + 0x0d), view.getUint8(base + 0x0e)],
      alpha: view.getUint8(base + 0x0f),
      fadeSpeed: view.getFloat32(base + 0x14, false),
    });
  }
  return out;
}

export function writeBfgFogEntries(source: Uint8Array, entries: PostEffectFogEntry[]): Uint8Array {
  const next = ensureLength(source, BFG_FILE_SIZE);
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  for (let index = 0; index < BFG_ENTRY_COUNT; index++) {
    const entry = entries[index];
    if (!entry) continue;
    const base = index * BFG_ENTRY_SIZE;
    view.setInt32(base, entry.fogType, false);
    view.setFloat32(base + 0x04, entry.startZ, false);
    view.setFloat32(base + 0x08, entry.endZ, false);
    view.setUint8(base + 0x0c, clampByte(entry.color[0]));
    view.setUint8(base + 0x0d, clampByte(entry.color[1]));
    view.setUint8(base + 0x0e, clampByte(entry.color[2]));
    view.setUint8(base + 0x0f, clampByte(entry.alpha));
    view.setFloat32(base + 0x14, entry.fadeSpeed, false);
  }
  return next;
}

export function createDefaultBfg(): Uint8Array {
  return writeBfgFogEntries(new Uint8Array(BFG_FILE_SIZE), Array.from({ length: BFG_ENTRY_COUNT }, (_, index) => ({
    index,
    fogType: 0,
    startZ: 0,
    endZ: 0,
    color: [255, 255, 255],
    alpha: 0,
    fadeSpeed: 0,
  })));
}

export function parseBblm(data: Uint8Array): PostEffectBloomFile | null {
  if (data.byteLength < BBLM_FILE_SIZE || readAscii(data, 0x00, 0x04) !== 'PBLM') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    thresholdAmount: view.getFloat32(0x10, false),
    thresholdColor: readRgba(view, 0x14),
    compositeColor: readRgba(view, 0x18),
    blurFlags: view.getUint16(0x1c, false),
    blur0Radius: view.getFloat32(0x20, false),
    blur0Intensity: view.getFloat32(0x24, false),
    blur1Radius: view.getFloat32(0x40, false),
    blur1Intensity: view.getFloat32(0x44, false),
    compositeBlendMode: view.getUint8(0x80),
    blur1NumPasses: view.getUint8(0x81),
    bokehColorScale0: view.getFloat32(0x9c, false),
    bokehColorScale1: view.getFloat32(0xa0, false),
  };
}

export function writeBblm(source: Uint8Array, file: PostEffectBloomFile): Uint8Array {
  const next = ensureLength(source, BBLM_FILE_SIZE);
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  writeAscii(next, 0x00, 'PBLM');
  view.setUint32(0x04, BBLM_FILE_SIZE, false);
  view.setUint8(0x08, 1);
  view.setFloat32(0x10, file.thresholdAmount, false);
  writeRgba(view, 0x14, file.thresholdColor);
  writeRgba(view, 0x18, file.compositeColor);
  view.setUint16(0x1c, clampUint16(file.blurFlags), false);
  view.setFloat32(0x20, file.blur0Radius, false);
  view.setFloat32(0x24, file.blur0Intensity, false);
  view.setFloat32(0x40, file.blur1Radius, false);
  view.setFloat32(0x44, file.blur1Intensity, false);
  view.setUint8(0x80, clampByte(file.compositeBlendMode));
  view.setUint8(0x81, clampByte(file.blur1NumPasses));
  view.setFloat32(0x9c, file.bokehColorScale0, false);
  view.setFloat32(0xa0, file.bokehColorScale1, false);
  return next;
}

export function createDefaultBblm(): Uint8Array {
  return writeBblm(new Uint8Array(BBLM_FILE_SIZE), {
    thresholdAmount: 0.5,
    thresholdColor: [255, 255, 255, 255],
    compositeColor: [255, 255, 255, 255],
    blurFlags: 0,
    blur0Radius: 0,
    blur0Intensity: 0,
    blur1Radius: 0,
    blur1Intensity: 0,
    compositeBlendMode: 0,
    blur1NumPasses: 1,
    bokehColorScale0: 1,
    bokehColorScale1: 1,
  });
}

export function parseBdof(data: Uint8Array): PostEffectDofFile | null {
  if (data.byteLength < BDOF_FILE_SIZE || readAscii(data, 0x00, 0x04) !== 'PDOF') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    flags: view.getUint16(0x10, false),
    blurAlpha: [view.getUint8(0x12), view.getUint8(0x13)] as const,
    drawMode: view.getUint8(0x14),
    blurDrawAmount: view.getUint8(0x15),
    depthCurveType: view.getUint8(0x16),
    focusCenter: view.getFloat32(0x18, false),
    focusRange: view.getFloat32(0x1c, false),
    blurRadius: view.getFloat32(0x24, false),
    indTexTransSScroll: view.getFloat32(0x28, false),
    indTexTransTScroll: view.getFloat32(0x2c, false),
    indTexIndScaleS: view.getFloat32(0x30, false),
    indTexIndScaleT: view.getFloat32(0x34, false),
    indTexScaleS: view.getFloat32(0x38, false),
    indTexScaleT: view.getFloat32(0x3c, false),
  };
}

export function writeBdof(source: Uint8Array, file: PostEffectDofFile): Uint8Array {
  const next = ensureLength(source, BDOF_FILE_SIZE);
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  writeAscii(next, 0x00, 'PDOF');
  view.setUint32(0x04, BDOF_FILE_SIZE, false);
  view.setUint8(0x08, 0);
  view.setUint16(0x10, clampUint16(file.flags), false);
  view.setUint8(0x12, clampByte(file.blurAlpha[0]));
  view.setUint8(0x13, clampByte(file.blurAlpha[1]));
  view.setUint8(0x14, clampByte(file.drawMode));
  view.setUint8(0x15, clampByte(file.blurDrawAmount));
  view.setUint8(0x16, clampByte(file.depthCurveType));
  view.setFloat32(0x18, file.focusCenter, false);
  view.setFloat32(0x1c, file.focusRange, false);
  view.setFloat32(0x24, file.blurRadius, false);
  view.setFloat32(0x28, file.indTexTransSScroll, false);
  view.setFloat32(0x2c, file.indTexTransTScroll, false);
  view.setFloat32(0x30, file.indTexIndScaleS, false);
  view.setFloat32(0x34, file.indTexIndScaleT, false);
  view.setFloat32(0x38, file.indTexScaleS, false);
  view.setFloat32(0x3c, file.indTexScaleT, false);
  return next;
}

export function createDefaultBdof(): Uint8Array {
  return writeBdof(new Uint8Array(BDOF_FILE_SIZE), {
    flags: 0,
    blurAlpha: [0, 255],
    drawMode: 0,
    blurDrawAmount: 0,
    depthCurveType: 0,
    focusCenter: 0,
    focusRange: 0,
    blurRadius: 0,
    indTexTransSScroll: 0,
    indTexTransTScroll: 0,
    indTexIndScaleS: 0,
    indTexIndScaleT: 0,
    indTexScaleS: 1,
    indTexScaleT: 1,
  });
}

export function parseBlight(data: Uint8Array): PostEffectBlightFile | null {
  if (data.byteLength < BLIGHT_FILE_SIZE || readAscii(data, 0x00, 0x04) !== 'LGHT') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lightCount = Math.min(BLIGHT_LIGHT_COUNT, view.getUint16(0x10, false));
  const ambientCount = Math.min(BLIGHT_AMBIENT_COUNT, view.getUint16(0x12, false));
  const lightObjects: PostEffectBlightObject[] = [];
  for (let index = 0; index < lightCount; index++) {
    const base = 0x28 + index * BLIGHT_LIGHT_SIZE;
    lightObjects.push({
      spotFunction: view.getUint8(base + 0x10),
      distAttnFunction: view.getUint8(base + 0x11),
      coordinateSystem: view.getUint8(base + 0x12),
      lightType: view.getUint8(base + 0x13),
      ambientLightIndex: view.getUint16(base + 0x14, false),
      flags: view.getUint16(base + 0x16, false),
      origin: [view.getFloat32(base + 0x18, false), view.getFloat32(base + 0x1c, false), view.getFloat32(base + 0x20, false)],
      destination: [view.getFloat32(base + 0x24, false), view.getFloat32(base + 0x28, false), view.getFloat32(base + 0x2c, false)],
      intensity: view.getFloat32(base + 0x30, false),
      color: readRgba(view, base + 0x34),
      specColor: readRgba(view, base + 0x38),
      spotCutoff: view.getFloat32(base + 0x3c, false),
      refDist: view.getFloat32(base + 0x40, false),
      refBrightness: view.getFloat32(base + 0x44, false),
      linkedLightIndex: view.getUint16(base + 0x4c, false),
    });
  }
  const ambientLights: RgbaColor[] = [];
  const ambientBase = 0x28 + BLIGHT_LIGHT_COUNT * BLIGHT_LIGHT_SIZE;
  for (let index = 0; index < ambientCount; index++) {
    ambientLights.push(readRgba(view, ambientBase + index * BLIGHT_AMBIENT_SIZE));
  }
  return {
    ambientBlackColor: readRgba(view, 0x14),
    ambientLights,
    lightObjects,
  };
}

export function writeBlight(source: Uint8Array, file: PostEffectBlightFile): Uint8Array {
  const next = ensureLength(source, BLIGHT_FILE_SIZE);
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  writeAscii(next, 0x00, 'LGHT');
  view.setUint32(0x04, BLIGHT_FILE_SIZE, false);
  view.setUint8(0x08, 0x02);
  view.setUint32(0x0c, 0, false);
  view.setUint16(0x10, BLIGHT_LIGHT_COUNT, false);
  view.setUint16(0x12, BLIGHT_AMBIENT_COUNT, false);
  writeRgba(view, 0x14, file.ambientBlackColor);
  for (let index = 0; index < BLIGHT_LIGHT_COUNT; index++) {
    const base = 0x28 + index * BLIGHT_LIGHT_SIZE;
    const light = file.lightObjects[index] ?? defaultBlightObject(index);
    writeAscii(next, base + 0x00, 'LOBJ');
    view.setUint32(base + 0x04, BLIGHT_LIGHT_SIZE, false);
    view.setUint8(base + 0x08, 0x02);
    view.setUint32(base + 0x0c, 0, false);
    view.setUint8(base + 0x10, clampByte(light.spotFunction));
    view.setUint8(base + 0x11, clampByte(light.distAttnFunction));
    view.setUint8(base + 0x12, clampByte(light.coordinateSystem));
    view.setUint8(base + 0x13, clampByte(light.lightType));
    view.setUint16(base + 0x14, clampUint16(light.ambientLightIndex), false);
    view.setUint16(base + 0x16, clampUint16(light.flags), false);
    view.setFloat32(base + 0x18, light.origin[0], false);
    view.setFloat32(base + 0x1c, light.origin[1], false);
    view.setFloat32(base + 0x20, light.origin[2], false);
    view.setFloat32(base + 0x24, light.destination[0], false);
    view.setFloat32(base + 0x28, light.destination[1], false);
    view.setFloat32(base + 0x2c, light.destination[2], false);
    view.setFloat32(base + 0x30, light.intensity, false);
    writeRgba(view, base + 0x34, light.color);
    writeRgba(view, base + 0x38, light.specColor);
    view.setFloat32(base + 0x3c, light.spotCutoff, false);
    view.setFloat32(base + 0x40, light.refDist, false);
    view.setFloat32(base + 0x44, light.refBrightness, false);
    view.setUint32(base + 0x48, 0, false);
    view.setUint16(base + 0x4c, clampUint16(light.linkedLightIndex), false);
    view.setUint16(base + 0x4e, 0, false);
  }
  const ambientBase = 0x28 + BLIGHT_LIGHT_COUNT * BLIGHT_LIGHT_SIZE;
  for (let index = 0; index < BLIGHT_AMBIENT_COUNT; index++) {
    writeRgba(view, ambientBase + index * BLIGHT_AMBIENT_SIZE, file.ambientLights[index] ?? [0x64, 0x64, 0x64, 0xff]);
    view.setUint32(ambientBase + index * BLIGHT_AMBIENT_SIZE + 0x04, 0, false);
  }
  return next;
}

export function createDefaultBlight(): Uint8Array {
  return writeBlight(new Uint8Array(BLIGHT_FILE_SIZE), {
    ambientBlackColor: [0, 0, 0, 0xff],
    ambientLights: Array.from({ length: BLIGHT_AMBIENT_COUNT }, () => [0x64, 0x64, 0x64, 0xff] as RgbaColor),
    lightObjects: Array.from({ length: BLIGHT_LIGHT_COUNT }, (_, index) => defaultBlightObject(index)),
  });
}

function defaultBlightObject(index: number): PostEffectBlightObject {
  return {
    spotFunction: 0,
    distAttnFunction: 0,
    coordinateSystem: 1,
    lightType: 1,
    ambientLightIndex: index,
    flags: 0x0641,
    origin: [0, 0, 0],
    destination: [0, 0, -1],
    intensity: 1,
    color: [255, 255, 255, 255],
    specColor: [0, 0, 0, 255],
    spotCutoff: 45,
    refDist: 1000,
    refBrightness: 1,
    linkedLightIndex: 0,
  };
}

function ensureLength(source: Uint8Array, minLength: number): Uint8Array {
  if (source.byteLength >= minLength) return new Uint8Array(source);
  const next = new Uint8Array(minLength);
  next.set(source);
  return next;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(0xff, Math.round(value)));
}

function clampUint16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length));
}

function writeAscii(data: Uint8Array, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) data[offset + i] = value.charCodeAt(i);
}

function readRgba(view: DataView, offset: number): RgbaColor {
  return [view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)];
}

function writeRgba(view: DataView, offset: number, value: RgbaColor) {
  view.setUint8(offset, clampByte(value[0]));
  view.setUint8(offset + 1, clampByte(value[1]));
  view.setUint8(offset + 2, clampByte(value[2]));
  view.setUint8(offset + 3, clampByte(value[3]));
}
