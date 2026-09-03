// Reads the look of a track out of its BRRES archives: models, materials, textures and
// animations. React-free so it can be unit tested; the panels under `src/ui/visual/` render it.
import { listBrresTextures } from '../../lib/tex0Brres';
import type { TrackDocument } from '../../lib/track';

export type VisualArchiveRole = 'course' | 'skybox' | 'minimap' | 'object';
export type VisualAnimationKind = 'srt0' | 'pat0' | 'clr0' | 'chr0' | 'vis0' | 'scn0';

export interface VisualMaterialInfo {
  index: number;
  name: string;
  /** Draw layer: translucent materials are sorted after the opaque ones. */
  translucent: boolean;
  blendModeLabel: string;
  cullModeLabel: string;
  tevStageCount: number;
  texGenCount: number;
  indirectStageCount: number;
  alphaTestLabel: string;
  depthWrite: boolean;
  /** TEX0 names the material samples, in sampler order. */
  textures: string[];
  lightSetIndex: number;
  fogIndex: number;
}

export interface VisualModelInfo {
  name: string;
  materialCount: number;
  shapeCount: number;
  nodeCount: number;
  /** Distinct TEX0 names used by the model's materials. */
  textureCount: number;
  triangleCount: number;
  materials: VisualMaterialInfo[];
}

export interface VisualTextureInfo {
  name: string;
  width: number;
  height: number;
  /** GX TexFormat numeric value. */
  format: number;
  formatLabel: string;
  mipCount: number;
  byteLength: number;
  /** Absolute offset of the pixel data inside the archive's BRRES bytes. */
  dataOffset: number;
  /** Bytes reserved for the pixel data; a replacement has to fit inside this. */
  dataCapacity: number;
  /** Materials (per model) that sample this texture. */
  usedBy: string[];
}

export interface VisualAnimationInfo {
  kind: VisualAnimationKind;
  name: string;
  /** Length in frames (60 fps). */
  duration: number;
  loopMode: number;
  loops: boolean;
}

export interface VisualArchiveInfo {
  /** Archive path inside the `.szs`, e.g. `course_model.brres`. */
  path: string;
  label: string;
  role: VisualArchiveRole;
  byteLength: number;
  models: VisualModelInfo[];
  textures: VisualTextureInfo[];
  animations: VisualAnimationInfo[];
  /** Set when the archive could not be parsed; the entry is still listed. */
  error?: string;
}

// GX cull modes name what is *removed*; the labels say what the author will see.
const GX_CULL_MODE_LABELS: Record<number, string> = { 0: 'Both sides', 1: 'Back only (front culled)', 2: 'Front only (back culled)', 3: 'Nothing drawn' };
const GX_BLEND_MODE_LABELS: Record<number, string> = { 0: 'None', 1: 'Blend', 2: 'Logic', 3: 'Subtract' };
const GX_COMPARE_LABELS: Record<number, string> = {
  0: 'never', 1: 'less', 2: 'equal', 3: 'less or equal', 4: 'greater', 5: 'not equal', 6: 'greater or equal', 7: 'always',
};
const GX_LOOP_MODE_ONCE = 0;

/** Names the archive the way an author thinks about it rather than by file name. */
export function describeVisualArchive(path: string): { label: string; role: VisualArchiveRole } {
  const base = path.split('/').pop() ?? path;
  const lower = base.toLowerCase();
  if (lower === 'course_model.brres') return { label: 'Track model', role: 'course' };
  if (lower === 'vrcorn_model.brres') return { label: 'Skybox', role: 'skybox' };
  if (lower === 'map_model.brres') return { label: 'Minimap', role: 'minimap' };
  return { label: base.replace(/\.brres$/i, ''), role: 'object' };
}

/** Every `.brres` in the track, in a stable "most interesting first" order. */
export function listVisualArchivePaths(track: TrackDocument | null): string[] {
  if (!track) return [];
  const paths = track.archiveEntries
    .filter((entry) => entry.type === 'file' && entry.path.toLowerCase().endsWith('.brres'))
    .map((entry) => entry.path);
  const rank = (path: string) => {
    const role = describeVisualArchive(path).role;
    return role === 'course' ? 0 : role === 'skybox' ? 1 : role === 'minimap' ? 2 : 3;
  };
  return paths.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The renderer keys its loaded archives by their U8 path with the `./` prefix the noclip U8 reader
 * uses (`./course_model.brres`); the track document stores them without it.
 */
export function toSceneArchivePath(path: string): string {
  return path.startsWith('./') ? path : `./${path}`;
}

export function findArchiveBytes(track: TrackDocument | null, path: string): Uint8Array | null {
  if (!track) return null;
  const entry = track.archiveEntries.find(
    (candidate) => candidate.type === 'file' && candidate.path.toLowerCase() === path.toLowerCase(),
  );
  return entry?.data ?? null;
}

/**
 * Parses one BRRES into the Visual-mode view model. Uses the vendored noclip parser (dynamically
 * imported, like the rest of the app) so the numbers shown always match what the viewport renders.
 */
export async function readVisualArchive(path: string, bytes: Uint8Array): Promise<VisualArchiveInfo> {
  const { label, role } = describeVisualArchive(path);
  const base: VisualArchiveInfo = { path, label, role, byteLength: bytes.byteLength, models: [], textures: [], animations: [] };

  const [{ default: ArrayBufferSlice }, BRRES, GXTexture] = await Promise.all([
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/rres/brres.js'),
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../../vendor/noclip.website/src/gx/gx_texture.js'),
  ]);

  let rres: any;
  try {
    const copy = bytes.slice();
    rres = BRRES.parse(new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength));
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }

  const textureUsage = new Map<string, string[]>();
  const models: VisualModelInfo[] = (rres.mdl0 ?? []).map((mdl0: any) => {
    const materials: VisualMaterialInfo[] = (mdl0.materials ?? []).map((material: any, index: number) =>
      readMaterial(material, index, mdl0.name, textureUsage),
    );
    const textureNames = new Set<string>();
    for (const material of materials) for (const name of material.textures) textureNames.add(name);
    return {
      name: mdl0.name,
      materialCount: materials.length,
      shapeCount: mdl0.shapes?.length ?? 0,
      nodeCount: mdl0.nodes?.length ?? 0,
      textureCount: textureNames.size,
      triangleCount: countTriangles(mdl0),
      materials,
    };
  });

  // TEX0 metadata comes from the parser, but the byte offsets come from our own container walk
  // because the parser does not keep them and texture replacement needs to patch in place.
  const locations = new Map(listBrresTextures(bytes).map((location) => [location.name, location]));
  const textures: VisualTextureInfo[] = (rres.tex0 ?? []).map((tex0: any) => {
    const location = locations.get(tex0.name);
    return {
      name: tex0.name,
      width: tex0.width,
      height: tex0.height,
      format: tex0.format,
      formatLabel: safeFormatName(GXTexture, tex0.format),
      mipCount: Math.max(1, tex0.mipCount ?? 1),
      byteLength: location?.dataSize ?? 0,
      dataOffset: location?.dataOffset ?? -1,
      dataCapacity: location?.dataSize ?? 0,
      usedBy: textureUsage.get(tex0.name) ?? [],
    };
  });

  const animations: VisualAnimationInfo[] = [];
  const pushAnimations = (kind: VisualAnimationKind, list: any[] | undefined) => {
    for (const animation of list ?? [])
      animations.push({
        kind,
        name: animation.name,
        duration: animation.duration ?? 0,
        loopMode: animation.loopMode ?? 0,
        loops: (animation.loopMode ?? 0) !== GX_LOOP_MODE_ONCE,
      });
  };
  pushAnimations('srt0', rres.srt0);
  pushAnimations('pat0', rres.pat0);
  pushAnimations('clr0', rres.clr0);
  pushAnimations('chr0', rres.chr0);
  pushAnimations('vis0', rres.vis0);
  pushAnimations('scn0', rres.scn0);

  return { ...base, models, textures, animations };
}

function readMaterial(material: any, index: number, modelName: string, textureUsage: Map<string, string[]>): VisualMaterialInfo {
  const gxMaterial = material.gxMaterial ?? {};
  const ropInfo = gxMaterial.ropInfo ?? {};
  const alphaTest = gxMaterial.alphaTest ?? {};
  const textures: string[] = (material.samplers ?? [])
    .filter((sampler: any) => sampler && typeof sampler.name === 'string')
    .map((sampler: any) => sampler.name as string);
  for (const name of textures) {
    const users = textureUsage.get(name) ?? [];
    users.push(`${modelName}/${material.name}`);
    textureUsage.set(name, users);
  }
  return {
    index,
    name: material.name,
    translucent: !!material.translucent,
    blendModeLabel: describeBlend(ropInfo),
    cullModeLabel: GX_CULL_MODE_LABELS[gxMaterial.cullMode] ?? `Cull ${gxMaterial.cullMode}`,
    tevStageCount: gxMaterial.tevStages?.length ?? 0,
    texGenCount: gxMaterial.texGens?.length ?? 0,
    indirectStageCount: gxMaterial.indTexStages?.length ?? 0,
    alphaTestLabel: describeAlphaTest(alphaTest),
    depthWrite: ropInfo.depthWrite !== false,
    textures,
    lightSetIndex: material.lightSetIdx ?? -1,
    fogIndex: material.fogIdx ?? -1,
  };
}

function describeBlend(ropInfo: any): string {
  const mode = ropInfo?.blendMode;
  if (mode === undefined) return 'Unknown';
  if (mode === 0) return 'Opaque';
  return GX_BLEND_MODE_LABELS[mode] ?? `Blend ${mode}`;
}

function describeAlphaTest(alphaTest: any): string {
  const op0: number | undefined = alphaTest?.compareA;
  const op1: number | undefined = alphaTest?.compareB;
  if (op0 === undefined) return 'Off';
  const always = 7;
  if (op0 === always && (op1 === undefined || op1 === always)) return 'Off';
  const left = `${GX_COMPARE_LABELS[op0] ?? op0} ${Math.round((alphaTest.referenceA ?? 0) * 255)}`;
  if (op1 === undefined || op1 === always) return left;
  return `${left} / ${GX_COMPARE_LABELS[op1] ?? op1} ${Math.round((alphaTest.referenceB ?? 0) * 255)}`;
}

function countTriangles(mdl0: any): number {
  let total = 0;
  for (const shape of mdl0.shapes ?? []) {
    const indexCount = shape.loadedVertexData?.totalIndexCount ?? 0;
    total += Math.floor(indexCount / 3);
  }
  return total;
}

function safeFormatName(GXTexture: any, format: number): string {
  try {
    return GXTexture.getFormatName(format, null);
  } catch {
    return `Format ${format}`;
  }
}

/** Total texture memory the archive's TEX0s occupy, for the panel header. */
export function sumTextureBytes(archive: VisualArchiveInfo): number {
  return archive.textures.reduce((total, texture) => total + texture.byteLength, 0);
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ANIMATION_KIND_LABELS: Record<VisualAnimationKind, string> = {
  srt0: 'Texture movement',
  pat0: 'Texture swap',
  clr0: 'Colour',
  chr0: 'Bone',
  vis0: 'Visibility',
  scn0: 'Scene lighting',
};

export function animationKindLabel(kind: VisualAnimationKind): string {
  return ANIMATION_KIND_LABELS[kind];
}

/** What the Visual panel currently has focused; drives the inspector. */
export type VisualSelection =
  | { kind: 'material'; modelName: string; materialIndex: number }
  | { kind: 'texture'; textureName: string }
  | { kind: 'animation'; animationKind: VisualAnimationKind; name: string }
  | { kind: 'postEffects' }
  | null;

/** One animation row as shown in the panel: parsed metadata plus the renderer's playback state. */
export interface VisualAnimationRow extends VisualAnimationInfo {
  /** True when the renderer is currently playing this animation. */
  enabled: boolean;
  /** False when the renderer cannot play this kind (SCN0) or has not loaded the archive. */
  togglable: boolean;
}

/**
 * Merges the archive's parsed animation list with the renderer's live state. The parse is the
 * source of truth for which animations exist (it also covers archives the renderer never loads,
 * like `map_model.brres`); the renderer supplies whether each one is bound and playing.
 */
export function buildAnimationRows(
  parsed: VisualAnimationInfo[],
  live: Array<{ kind: string; name: string; enabled: boolean; supported: boolean }>,
): VisualAnimationRow[] {
  const liveByKey = new Map(live.map((entry) => [`${entry.kind}|${entry.name}`, entry]));
  return parsed.map((animation) => {
    const match = liveByKey.get(`${animation.kind}|${animation.name}`);
    return {
      ...animation,
      enabled: match?.enabled ?? false,
      togglable: match !== undefined && match.supported,
    };
  });
}

/** Longest animation in the archive, in frames — the range the scrubber covers. */
export function maxAnimationFrames(animations: VisualAnimationInfo[]): number {
  return animations.reduce((longest, animation) => Math.max(longest, Math.ceil(animation.duration)), 0);
}
