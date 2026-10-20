/**
 * A tiny `CreateKit` for tests that never touches the real asset kit: every slot has a surface with
 * an id, a KCL flag and a texture size; `file()` returns null (no swatches).
 */
import type { CreateKit, CreateKitCatalog, KitSurface, KitTheme, SurfaceCategory, SurfaceSlot, CompileWriters } from '../types';

const SLOTS: Array<{ slot: SurfaceSlot; category: SurfaceCategory; flag: number; size: [number, number]; translucent?: boolean }> = [
  { slot: 'road', category: 'road', flag: 0x0000, size: [1200, 1200] },
  { slot: 'roadAlt', category: 'road', flag: 0x0020, size: [1000, 1000] },
  { slot: 'curb', category: 'curb', flag: 0x0000, size: [400, 400] },
  { slot: 'shoulder', category: 'offroad', flag: 0x0002, size: [1000, 1000] },
  { slot: 'ground', category: 'ground', flag: 0x0003, size: [2000, 2000] },
  { slot: 'groundAlt', category: 'ground', flag: 0x0004, size: [2000, 2000] },
  { slot: 'wall', category: 'wall', flag: 0x000c, size: [1500, 1500] },
  { slot: 'barrier', category: 'wall', flag: 0x006c, size: [800, 400] },
  { slot: 'fence', category: 'wall', flag: 0x000c, size: [800, 600], translucent: true },
  { slot: 'cliff', category: 'wall', flag: 0x000c, size: [2000, 2000] },
  { slot: 'underside', category: 'underside', flag: 0x000c, size: [1500, 1500] },
  { slot: 'sand', category: 'offroad', flag: 0x0001, size: [1500, 1500] },
  { slot: 'mud', category: 'offroad', flag: 0x0004, size: [1500, 1500] },
  { slot: 'ice', category: 'ice', flag: 0x0005, size: [1500, 1500] },
  { slot: 'water', category: 'water', flag: 0x0010, size: [2000, 2000], translucent: true },
  { slot: 'lava', category: 'lava', flag: 0x0010, size: [2000, 2000] },
  { slot: 'boost', category: 'boost', flag: 0x0006, size: [1000, 1000] },
  { slot: 'startLine', category: 'decal', flag: 0x0000, size: [400, 400] },
];

export function createSyntheticKit(options: { themes?: number; terrain?: boolean; scenery?: boolean; /** Per-theme `KitTheme.baseHeight` (omitted = undefined). */ baseHeights?: number[] } = {}): CreateKit {
  const themeCount = options.themes ?? 2;
  const surfaces: KitSurface[] = [];
  const themes: KitTheme[] = [];
  for (let t = 0; t < themeCount; t++) {
    const id = t === 0 ? 'test' : `test${t + 1}`;
    const slots = {} as Record<SurfaceSlot, string>;
    for (const s of SLOTS) {
      const sid = `${id}.${s.slot}`;
      slots[s.slot] = sid;
      surfaces.push({
        id: sid,
        label: `${id} ${s.slot}`,
        category: s.category,
        swatch: `swatches/${sid}.brres`,
        modelName: 'swatch',
        materialName: s.slot,
        textureWorldSize: [s.size[0], s.size[1]],
        kclFlag: s.flag,
        translucent: !!s.translucent,
        sourceTrack: 'synthetic',
        thumbnail: `thumbs/${sid}.png`,
        usesVertexColor: true,
      });
    }
    themes.push({
      id,
      label: `Test world ${t + 1}`,
      description: 'A synthetic world for tests.',
      donorTrack: 'beginner_course',
      slots,
      files: { 'posteffect/posteffect.blight': `themes/${id}/posteffect.blight` },
      preview: `themes/${id}/preview.png`,
      accent: ['#223344', '#556677'],
      defaultRoadStyle: 'circuit',
      terrain: options.terrain ?? true,
      ...(options.baseHeights?.[t] !== undefined ? { baseHeight: options.baseHeights[t] } : {}),
    });
  }
  const catalog: CreateKitCatalog = {
    version: 1,
    generatedAt: 'test',
    surfaces,
    themes,
    minimap: { swatch: 'swatches/minimap.brres', materialName: 'minimap' },
    scenery: options.scenery
      ? [
          { objectId: 303, label: 'Round tree', themeIds: ['test', 'test2'], scale: 1, spacing: 1800 },
          { objectId: 307, label: 'Leafy tree', themeIds: ['test'], scale: 1, spacing: 1800 },
          { objectId: 306, label: 'Flower', themeIds: ['test'], scale: 1, spacing: 500 },
          { objectId: 112, label: 'Wooden crate', themeIds: ['test'], scale: 1, spacing: 700 },
        ]
      : [],
  };
  const files = new Map<string, Uint8Array>();
  files.set('themes/test/posteffect.blight', new Uint8Array([1, 2, 3, 4]));
  const kit: CreateKit = {
    catalog,
    file: (path) => files.get(path) ?? null,
    surface: (id) => surfaces.find((s) => s.id === id) ?? null,
    theme: (id) => themes.find((t) => t.id === id) ?? null,
    resolveSurface(ref, themeId) {
      const theme = themes.find((t) => t.id === themeId) ?? themes[0];
      if ('surfaceId' in ref) return surfaces.find((s) => s.id === ref.surfaceId) ?? surfaces.find((s) => s.id === theme.slots.road) ?? surfaces[0];
      return surfaces.find((s) => s.id === theme.slots[ref.slot]) ?? surfaces[0];
    },
  };
  return kit;
}

/** Writers that produce small deterministic byte arrays, so compile tests do not need the real ones. */
export function createStubWriters(): CompileWriters {
  const encode = (text: string) => new TextEncoder().encode(text);
  return {
    buildModelBrres: (input) => encode(`brres:${input.modelName}:${input.meshes.map((m) => `${m.name}/${m.indices.length}`).join(',')}`),
    buildKcl: (collision) => encode(`kcl:${collision.flags.length}`),
    buildMinimapBrres: (input) => encode(`map:${input.meshes.length}`),
  };
}
