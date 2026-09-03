/**
 * Minimal BRRES container walking for TEX0 sub-files.
 *
 * The vendored noclip parser (vendor/noclip.website/src/rres/brres.ts) reads the whole archive,
 * which is far too much machinery for "find the pixel bytes and overwrite them in place". This
 * module re-implements just the header/ResDic/TEX0 walk it does, so texture editing stays
 * synchronous and dependency-free. Everything in BRRES is big-endian.
 */

const BRES_MAGIC = 'bres';
const ROOT_MAGIC = 'root';
const TEX0_MAGIC = 'TEX0';
const TEXTURES_GROUP = 'Textures(NW4R)';

/** ResDic entries are 0x10 bytes and the first one is an unused root/sentinel entry. */
const RES_DIC_ENTRY_SIZE = 0x10;

/** TEX0 header field offsets, relative to the start of the sub-file. */
const TEX0_FILE_SIZE = 0x04;
const TEX0_DATA_OFFSET = 0x10;
const TEX0_NAME_OFFSET = 0x14;
const TEX0_WIDTH = 0x1c;
const TEX0_HEIGHT = 0x1e;
const TEX0_FORMAT = 0x20;
const TEX0_MIP_COUNT = 0x24;
const TEX0_MIN_LOD = 0x28;
const TEX0_MAX_LOD = 0x2c;
const TEX0_HEADER_SIZE = 0x30;

export interface Tex0Location {
  name: string;
  /** Absolute byte offset of the TEX0 sub-file inside the BRRES buffer. */
  fileOffset: number;
  /** Absolute byte offset of the pixel data. */
  dataOffset: number;
  /** Bytes available for pixel data (to the end of the TEX0 sub-file). */
  dataSize: number;
  width: number;
  height: number;
  /** GX TexFormat numeric value. */
  format: number;
  mipCount: number;
  minLOD: number;
  maxLOD: number;
}

export interface Tex0PatchResult {
  data: Uint8Array;
}

interface ResDicEntry {
  name: string;
  offset: number;
}

function viewOf(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function readMagic(buffer: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > buffer.byteLength) return '';
  return String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
}

function readCString(buffer: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= buffer.byteLength) return '';
  let end = offset;
  while (end < buffer.byteLength && buffer[end] !== 0) end++;
  return String.fromCharCode(...buffer.subarray(offset, end));
}

/**
 * ResDic: u32 size, u32 count, then count+1 entries of 0x10 bytes. Name and data offsets inside
 * each entry are relative to the start of the dictionary, not the file.
 */
function parseResDic(buffer: Uint8Array, view: DataView, tableOffset: number): ResDicEntry[] {
  if (tableOffset <= 0 || tableOffset + 0x08 > buffer.byteLength) return [];
  const count = view.getUint32(tableOffset + 0x04);
  const end = tableOffset + 0x08 + (count + 1) * RES_DIC_ENTRY_SIZE;
  if (count < 0 || end > buffer.byteLength) return [];

  const entries: ResDicEntry[] = [];
  // Skip the root entry at index 0; it is a search-tree sentinel with no payload.
  let entryOffset = tableOffset + 0x08 + RES_DIC_ENTRY_SIZE;
  for (let i = 0; i < count; i++) {
    const name = readCString(buffer, tableOffset + view.getUint32(entryOffset + 0x08));
    const offset = tableOffset + view.getUint32(entryOffset + 0x0c);
    entries.push({ name, offset });
    entryOffset += RES_DIC_ENTRY_SIZE;
  }
  return entries;
}

interface RawTex0 extends Tex0Location {
  /** Sub-file length from the header, or 0 when it is missing/implausible. */
  declaredEnd: number;
}

function parseTex0(buffer: Uint8Array, view: DataView, fileOffset: number, dicName: string): RawTex0 | null {
  if (fileOffset < 0 || fileOffset + TEX0_HEADER_SIZE > buffer.byteLength) return null;
  if (readMagic(buffer, fileOffset) !== TEX0_MAGIC) return null;

  const fileSize = view.getUint32(fileOffset + TEX0_FILE_SIZE);
  const dataOffset = fileOffset + view.getUint32(fileOffset + TEX0_DATA_OFFSET);
  const nameOffset = fileOffset + view.getUint32(fileOffset + TEX0_NAME_OFFSET);
  if (dataOffset < fileOffset || dataOffset > buffer.byteLength) return null;

  const headerName = readCString(buffer, nameOffset);
  const width = view.getUint16(fileOffset + TEX0_WIDTH);
  const height = view.getUint16(fileOffset + TEX0_HEIGHT);
  const format = view.getUint32(fileOffset + TEX0_FORMAT);
  const mipCountRaw = view.getUint32(fileOffset + TEX0_MIP_COUNT);
  const minLOD = view.getFloat32(fileOffset + TEX0_MIN_LOD);
  const maxLOD = view.getFloat32(fileOffset + TEX0_MAX_LOD);

  const declaredEnd = fileOffset + fileSize;
  return {
    name: headerName.length > 0 ? headerName : dicName,
    fileOffset,
    dataOffset,
    dataSize: 0,
    width,
    height,
    format,
    // Mirrors noclip's parseTEX0: maxLOD is authoritative when it is lower than the raw count.
    mipCount: Math.max(1, Math.ceil(Math.min(mipCountRaw, maxLOD + 1))),
    minLOD,
    maxLOD,
    declaredEnd: fileSize > 0 && declaredEnd > dataOffset && declaredEnd <= buffer.byteLength ? declaredEnd : 0,
  };
}

/** Every TEX0 in a .brres, in `Textures(NW4R)` order. Returns [] if the buffer is not a BRRES. */
export function listBrresTextures(brres: Uint8Array): Tex0Location[] {
  if (brres.byteLength < 0x10 || readMagic(brres, 0x00) !== BRES_MAGIC) return [];
  const view = viewOf(brres);
  // 0xFEFF is big-endian; noclip refuses little-endian archives and so do we.
  if (view.getUint16(0x04) !== 0xfeff) return [];

  const rootOffset = view.getUint16(0x0c);
  if (readMagic(brres, rootOffset) !== ROOT_MAGIC) return [];

  const rootDic = parseResDic(brres, view, rootOffset + 0x08);
  const textures = rootDic.find((entry) => entry.name === TEXTURES_GROUP);
  if (!textures) return [];

  const raw: RawTex0[] = [];
  for (const entry of parseResDic(brres, view, textures.offset)) {
    const tex0 = parseTex0(brres, view, entry.offset, entry.name);
    if (tex0) raw.push(tex0);
  }

  // When a header's declared length is unusable, the slot runs to whatever comes next in the
  // file: the following TEX0 (in file order, which need not be dictionary order) or the end.
  const byOffset = [...raw].sort((a, b) => a.fileOffset - b.fileOffset);
  const nextOffset = new Map<number, number>();
  for (let i = 0; i < byOffset.length; i++) {
    nextOffset.set(byOffset[i].fileOffset, i + 1 < byOffset.length ? byOffset[i + 1].fileOffset : brres.byteLength);
  }

  return raw.map((tex0) => {
    const end = tex0.declaredEnd > 0 ? tex0.declaredEnd : (nextOffset.get(tex0.fileOffset) ?? brres.byteLength);
    return {
      name: tex0.name,
      fileOffset: tex0.fileOffset,
      dataOffset: tex0.dataOffset,
      dataSize: Math.max(0, end - tex0.dataOffset),
      width: tex0.width,
      height: tex0.height,
      format: tex0.format,
      mipCount: tex0.mipCount,
      minLOD: tex0.minLOD,
      maxLOD: tex0.maxLOD,
    };
  });
}

export function findBrresTexture(brres: Uint8Array, name: string): Tex0Location | null {
  return listBrresTextures(brres).find((tex0) => tex0.name === name) ?? null;
}

/**
 * Writes `pixelData` over the named TEX0's pixel data, keeping the BRRES byte-for-byte the same
 * size. Also rewrites the header's width/height/format/mipCount/maxLOD so the new values stick.
 *
 * Staying the same size is the whole point: every other offset in the archive (and in the U8 file
 * that contains it) is absolute, so growing a sub-file would mean rebuilding the entire container.
 */
export function patchBrresTexture(
  brres: Uint8Array,
  name: string,
  options: { pixelData: Uint8Array; width: number; height: number; format: number; mipCount: number },
): Uint8Array {
  const target = findBrresTexture(brres, name);
  if (!target) throw new Error(`BRRES has no texture named "${name}"`);
  if (options.pixelData.byteLength > target.dataSize) {
    throw new Error(`Texture "${name}" needs ${options.pixelData.byteLength} bytes but only ${target.dataSize} are available`);
  }

  const mipCount = Math.max(1, Math.floor(options.mipCount));
  const data = brres.slice();
  data.set(options.pixelData, target.dataOffset);

  const view = viewOf(data);
  view.setUint16(target.fileOffset + TEX0_WIDTH, options.width);
  view.setUint16(target.fileOffset + TEX0_HEIGHT, options.height);
  view.setUint32(target.fileOffset + TEX0_FORMAT, options.format);
  view.setUint32(target.fileOffset + TEX0_MIP_COUNT, mipCount);
  view.setFloat32(target.fileOffset + TEX0_MAX_LOD, mipCount - 1);
  return data;
}
