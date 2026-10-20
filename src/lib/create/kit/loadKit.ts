/**
 * Loading the Create-mode asset kit (`public/data/MarioKartWii/Create/create-kit.szs`).
 *
 * The kit is a Yaz0-compressed U8 archive: `kit.json` (the `CreateKitCatalog`) plus the swatch
 * BRRES files, thumbnails, theme files and previews it refers to. See docs/CREATE-KIT.md.
 */

import { applyThemeSlotOverrides } from './themeDefaults';
import { buildPublicAssetUrl } from '../../assetPaths';
import { parseU8 } from '../../u8';
import { decodeYaz0, isYaz0 } from '../../yaz0';
import { CREATE_KIT_PATH } from '../types';
import type { CreateKit, CreateKitCatalog, KitSurface, KitTheme, SurfaceRef, SurfaceSlot } from '../types';

function normalisePath(path: string): string {
  return path.replace(/^\.?\/+/, '');
}

/**
 * Builds a `CreateKit` from the bytes of a kit archive (compressed or not). Also used by node
 * tests and scripts. The byte arrays returned by `file()` are stable objects, so callers (such as
 * the model writer) can cache work keyed on them.
 */
export function createKitFromArchive(bytes: Uint8Array): CreateKit {
  const archive = isYaz0(bytes) ? decodeYaz0(bytes) : bytes;
  const files = new Map<string, Uint8Array>();
  for (const entry of parseU8(archive)) {
    if (entry.type === 'file' && entry.data) files.set(normalisePath(entry.path), entry.data);
  }
  const json = files.get('kit.json');
  if (!json) throw new Error('This is not a Create-mode asset kit: kit.json is missing.');
  const catalog = JSON.parse(new TextDecoder().decode(json)) as CreateKitCatalog;
  if (catalog.version !== 1) throw new Error(`Unsupported asset kit version ${String(catalog.version)}.`);
  if (catalog.themes.length === 0 || catalog.surfaces.length === 0) throw new Error('The asset kit is empty.');
  applyThemeSlotOverrides(catalog);

  const surfaces = new Map<string, KitSurface>(catalog.surfaces.map((surface) => [surface.id, surface]));
  const themes = new Map<string, KitTheme>(catalog.themes.map((theme) => [theme.id, theme]));
  const firstTheme = catalog.themes[0];

  const surfaceForSlot = (theme: KitTheme, slot: SurfaceSlot): KitSurface => {
    return (
      surfaces.get(theme.slots[slot]) ??
      surfaces.get(firstTheme.slots[slot]) ??
      surfaces.get(firstTheme.slots.road) ??
      catalog.surfaces[0]
    );
  };

  return {
    catalog,
    file: (path: string) => files.get(normalisePath(path)) ?? null,
    surface: (id: string) => surfaces.get(id) ?? null,
    theme: (id: string) => themes.get(id) ?? null,
    /**
     * Slot refs resolve through the theme (an unknown theme counts as the first one); a slot the
     * theme lacks falls back to the first theme's. An unknown `surfaceId` falls back to the
     * theme's road surface, so a design never fails to compile because the kit changed.
     */
    resolveSurface(ref: SurfaceRef, themeId: string): KitSurface {
      const theme = themes.get(themeId) ?? firstTheme;
      if ('slot' in ref) return surfaceForSlot(theme, ref.slot);
      return surfaces.get(ref.surfaceId) ?? surfaceForSlot(theme, 'road');
    },
  };
}

let cached: Promise<CreateKit> | null = null;

/** Fetches and parses the kit once; later calls share the same promise (a failure is not cached). */
export function loadCreateKit(): Promise<CreateKit> {
  if (!cached) {
    cached = (async () => {
      const response = await fetch(buildPublicAssetUrl(CREATE_KIT_PATH));
      if (!response.ok) throw new Error(`Could not load the Create asset kit (${response.status}).`);
      return createKitFromArchive(new Uint8Array(await response.arrayBuffer()));
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Test hook: forget the cached kit. */
export function resetCreateKitCache(): void {
  cached = null;
}
