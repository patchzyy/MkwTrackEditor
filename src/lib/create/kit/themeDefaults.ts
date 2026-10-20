import type { CreateKitCatalog, SurfaceSlot } from '../types';

/**
 * Corrections to the shipped kit's world defaults that are cheaper to state here than to rebuild
 * `create-kit.szs` for. They run when the kit is read, so the compiler, the previews and the palette
 * all see the same surfaces.
 *
 * - snow: packed-snow road on fresh-snow ground was white on white from above; a grey asphalt road
 *   reads as a ploughed road across the snow.
 * - castle: the whole ground was the orange cobble `mud.dark`, which looks like lava (it is heavy
 *   off-road, not lava); a dark murky floor lets the pale castle road and the lava patches stand out.
 *   The "Castle stone" road style is also the pale stone tiles its name says, not the red carpet that
 *   read as a thin red strip.
 */
export const THEME_SLOT_OVERRIDES: Record<string, Partial<Record<SurfaceSlot, string>>> = {
  snow: { road: 'asphalt.grey' },
  castle: { ground: 'mud.swamp', groundAlt: 'mud.dark', roadAlt: 'road.castle' },
};

/** Applies `THEME_SLOT_OVERRIDES` in place; an override naming a surface the kit lacks is ignored. */
export function applyThemeSlotOverrides(catalog: CreateKitCatalog): void {
  const known = new Set(catalog.surfaces.map((surface) => surface.id));
  for (const theme of catalog.themes) {
    const overrides = THEME_SLOT_OVERRIDES[theme.id];
    if (!overrides) continue;
    for (const [slot, surfaceId] of Object.entries(overrides) as Array<[SurfaceSlot, string]>) {
      if (known.has(surfaceId)) theme.slots[slot] = surfaceId;
    }
  }
}
