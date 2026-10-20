import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listArchiveMaterials } from '../../gxMaterial/archive';
import { describeKclFlag } from '../../kcl';
import { parseNoclipBrresSummary } from '../../noclipBrres';
import { parseCommonResourceArchive } from '../../objflow';
import { parseBfgFogEntries } from '../../posteffects';
import { readBrresRaw } from '../../brres/brresRaw';
import type { KitSurface, SurfaceSlot } from '../types';
import { createKitFromArchive } from './loadKit';

const KIT_PATH = resolve(__dirname, '../../../../public/data/MarioKartWii/Create/create-kit.szs');
const COMMON_PATH = resolve(__dirname, '../../../../public/data/MarioKartWii/Race/Common.szs');

const SLOTS: SurfaceSlot[] = [
  'road', 'roadAlt', 'curb', 'shoulder', 'ground', 'groundAlt', 'wall', 'barrier', 'fence', 'cliff',
  'underside', 'sand', 'mud', 'ice', 'water', 'lava', 'boost', 'startLine',
];

const kitBytes = new Uint8Array(readFileSync(KIT_PATH));
const kit = createKitFromArchive(kitBytes);
const { catalog } = kit;

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('create kit archive', () => {
  it('has the documented shape and stays lean', () => {
    expect(catalog.version).toBe(1);
    expect(catalog.themes.length).toBeGreaterThanOrEqual(8);
    expect(catalog.surfaces.length).toBeGreaterThan(40);
    expect(kitBytes.length).toBeLessThan(12 * 1024 * 1024);
    expect(new Set(catalog.surfaces.map((s) => s.id)).size).toBe(catalog.surfaces.length);
    expect(new Set(catalog.themes.map((t) => t.id)).size).toBe(catalog.themes.length);
  });

  it('rejects archives that are not a kit', () => {
    expect(() => createKitFromArchive(new Uint8Array(64))).toThrow();
  });

  it('hands out stable file arrays so downstream caches can key on them', () => {
    const swatch = catalog.surfaces[0].swatch;
    expect(kit.file(swatch)).toBe(kit.file(swatch));
    expect(kit.file(`./${swatch}`)).toBe(kit.file(swatch));
    expect(kit.file('nope/missing.brres')).toBeNull();
  });
});

describe('themes', () => {
  for (const theme of catalog.themes) {
    describe(theme.id, () => {
      it('fills every surface slot with a real surface', () => {
        for (const slot of SLOTS) {
          const id = theme.slots[slot];
          expect(id, `${theme.id}.${slot}`).toBeTruthy();
          expect(kit.surface(id), `${theme.id}.${slot} -> ${id}`).not.toBeNull();
        }
        expect(Object.keys(theme.slots).sort()).toEqual([...SLOTS].sort());
      });

      it('ships sky, post effects and a preview card', () => {
        expect(theme.files['vrcorn_model.brres']).toBeTruthy();
        expect(Object.keys(theme.files).some((path) => path.startsWith('posteffect/'))).toBe(true);
        for (const kitPath of Object.values(theme.files)) expect(kit.file(kitPath), kitPath).not.toBeNull();
        const preview = kit.file(theme.preview);
        expect(preview).not.toBeNull();
        expect(pngSize(preview!)).toEqual({ width: 320, height: 180 });
        expect(theme.accent).toHaveLength(2);
        expect(theme.description.length).toBeGreaterThan(10);
      });

      it('has a sky model the BRRES reader accepts and linear (or no) fog', () => {
        const sky = kit.file(theme.files['vrcorn_model.brres'])!;
        expect(readBrresRaw(sky).groups.length).toBeGreaterThan(0);
        const bfgPath = Object.keys(theme.files).find((path) => path.endsWith('.bfg'));
        if (!bfgPath) return;
        for (const entry of parseBfgFogEntries(kit.file(theme.files[bfgPath])!)) {
          expect([0, 1], `fog preset ${entry.index} type`).toContain(entry.fogType);
        }
      });

      it('resolves slot references through the theme', () => {
        for (const slot of SLOTS) expect(kit.resolveSurface({ slot }, theme.id).id).toBe(theme.slots[slot]);
      });
    });
  }
});

describe('surfaces', () => {
  it('reference files that exist and have sane measurements', () => {
    for (const surface of catalog.surfaces) {
      expect(kit.file(surface.swatch), surface.id).not.toBeNull();
      const thumb = kit.file(surface.thumbnail);
      expect(thumb, surface.id).not.toBeNull();
      expect(pngSize(thumb!), surface.id).toEqual({ width: 64, height: 64 });
      expect(surface.textureWorldSize[0]).toBeGreaterThan(0);
      expect(surface.textureWorldSize[1]).toBeGreaterThan(0);
      expect(surface.kclFlag).toBeGreaterThanOrEqual(0);
      expect(surface.kclFlag).toBeLessThanOrEqual(0xffff);
      expect(surface.label.length).toBeGreaterThan(2);
    }
  });

  it('every swatch parses and holds the material it names', async () => {
    const bySwatch = new Map<string, KitSurface[]>();
    for (const surface of catalog.surfaces) bySwatch.set(surface.swatch, [...(bySwatch.get(surface.swatch) ?? []), surface]);
    expect(bySwatch.size).toBeGreaterThan(5);
    for (const [path, surfaces] of bySwatch) {
      const bytes = kit.file(path)!;
      const summary = await parseNoclipBrresSummary(bytes, { thumbnail: false });
      expect(summary.error, path).toBeUndefined();
      const listing = listArchiveMaterials(path, bytes);
      for (const surface of surfaces) {
        expect(summary.models.map((model) => model.name), `${surface.id} model`).toContain(surface.modelName);
        const model = listing.models.find((entry) => entry.modelName === surface.modelName);
        const material = model?.materials.find((entry) => entry.materialName === surface.materialName);
        expect(material, `${surface.id} -> ${surface.materialName} in ${path}`).toBeDefined();
        expect(material!.translucent, `${surface.id} translucent`).toBe(surface.translucent);
        // every texture the material samples is in the swatch
        const textures = new Set(listing.textures.map((texture) => texture.name));
        for (const texture of material!.textures) if (texture) expect(textures.has(texture), `${surface.id} texture ${texture}`).toBe(true);
      }
    }
  });

  it('has a minimap material swatch', async () => {
    const bytes = kit.file(catalog.minimap.swatch)!;
    expect(bytes).not.toBeNull();
    const listing = listArchiveMaterials('minimap', bytes);
    expect(listing.models.flatMap((model) => model.materials.map((material) => material.materialName))).toContain(catalog.minimap.materialName);
  });

  it('carries collision flags that match the role of every theme slot', () => {
    const wallSlots: SurfaceSlot[] = ['wall', 'barrier', 'fence', 'cliff', 'underside'];
    const roadSlots: SurfaceSlot[] = ['road', 'roadAlt', 'curb', 'startLine'];
    const groundSlots: SurfaceSlot[] = ['shoulder', 'ground', 'groundAlt', 'sand', 'mud', 'ice'];
    for (const theme of catalog.themes) {
      for (const slot of SLOTS) {
        const surface = kit.surface(theme.slots[slot])!;
        const info = describeKclFlag(surface.kclFlag);
        const where = `${theme.id}.${slot} (${surface.id}, ${info.typeName})`;
        if (roadSlots.includes(slot)) {
          expect(info.drivable, where).toBe(true);
          expect([0x00, 0x17], where).toContain(info.basicType);
        } else if (groundSlots.includes(slot)) {
          expect(info.drivable, where).toBe(true);
        } else if (wallSlots.includes(slot)) {
          expect(info.wall, where).toBe(true);
        } else if (slot === 'water' || slot === 'lava') {
          expect([0x0a, 0x10], where).toContain(info.basicType);
        } else if (slot === 'boost') {
          expect(info.basicType, where).toBe(0x06);
        }
      }
    }
  });

  it('mud is heavy off-road and ice is slippery', () => {
    for (const theme of catalog.themes) {
      expect(describeKclFlag(kit.surface(theme.slots.mud)!.kclFlag).basicType).toBe(0x04);
      expect(describeKclFlag(kit.surface(theme.slots.ice)!.kclFlag).basicType).toBe(0x05);
    }
  });
});

describe('surface resolution', () => {
  const first = catalog.themes[0];
  it('falls back to the first theme for unknown themes', () => {
    expect(kit.resolveSurface({ slot: 'road' }, 'no-such-theme').id).toBe(first.slots.road);
  });

  it('keeps an explicit surface id in every theme', () => {
    const id = catalog.surfaces[3].id;
    for (const theme of catalog.themes) expect(kit.resolveSurface({ surfaceId: id }, theme.id).id).toBe(id);
  });

  it('falls back to the theme road for an unknown surface id', () => {
    const theme = catalog.themes[1];
    expect(kit.resolveSurface({ surfaceId: 'gone.forever' }, theme.id).id).toBe(theme.slots.road);
  });

  it('re-skins slot references when the theme changes', () => {
    const roads = new Set(catalog.themes.map((theme) => kit.resolveSurface({ slot: 'road' }, theme.id).id));
    expect(roads.size).toBeGreaterThan(4);
  });
});

describe('scenery', () => {
  const common = parseCommonResourceArchive(new Uint8Array(readFileSync(COMMON_PATH)));

  it('only offers objects ObjFlow knows', () => {
    for (const entry of catalog.scenery) {
      expect(common.objFlow.byId.has(entry.objectId), `0x${entry.objectId.toString(16)} ${entry.label}`).toBe(true);
      expect(entry.scale).toBeGreaterThan(0);
      expect(entry.spacing).toBeGreaterThan(100);
      expect(entry.themeIds.length).toBeGreaterThan(0);
      for (const themeId of entry.themeIds) expect(kit.theme(themeId), themeId).not.toBeNull();
    }
  });

  it('gives every theme a decent palette without duplicate ids', () => {
    expect(new Set(catalog.scenery.map((entry) => entry.objectId)).size).toBe(catalog.scenery.length);
    for (const theme of catalog.themes) {
      const count = catalog.scenery.filter((entry) => entry.themeIds.includes(theme.id)).length;
      expect(count, theme.id).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('theme default corrections', () => {
  it('give snow a road that contrasts with its ground, and castle a ground that is not the orange cobble', () => {
    const slots = (id: string) => catalog.themes.find((t) => t.id === id)!.slots;
    expect(slots('snow').road).toBe('asphalt.grey');
    expect(slots('snow').ground).toBe('snow.fresh');
    expect(slots('castle').ground).toBe('mud.swamp');
    expect(slots('castle').roadAlt).toBe('road.castle');
    // Every slot of every world still points at a real surface.
    for (const theme of catalog.themes) for (const surfaceId of Object.values(theme.slots)) expect(kit.surface(surfaceId), `${theme.id}:${surfaceId}`).not.toBeNull();
  });
});
