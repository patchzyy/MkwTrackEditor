/**
 * Picks which MDL0s inside a BRRES archive belong in a thumbnail.
 *
 * Mario Kart Wii object archives usually ship the real model alongside a low-poly LOD and a
 * flat shadow decal (`itembox`, `itembox-low`, `itembox-shadow`). Drawing all three stacks a
 * grey blob over the object, so the helpers here keep only the presentation model.
 *
 * Pure string logic; unit tested without a renderer.
 */

/** Suffixes that mark a model as a LOD, shadow decal or effect helper rather than the object. */
const AUXILIARY_SUFFIX = /[-_ ](shadow|shadows|low|lod|lod\d+|lo|effect|efct|dummy|collision|kcl)$/i;

export function isAuxiliaryModelName(name: string): boolean {
  return AUXILIARY_SUFFIX.test(name.trim());
}

export function normalizeModelName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Strip a resource path down to the name Mario Kart Wii uses for its main MDL0
 * (`Extracted/itembox.brres` -> `itembox`).
 */
export function modelNameFromResourcePath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Returns the names of the models to draw, in archive order.
 *
 * - When `preferName` matches a model, only that model is drawn (this mirrors how the
 *   Mario Kart Wii scene spawns objects: the MDL0 named after the archive).
 * - Otherwise every non-auxiliary model is drawn.
 * - If that would leave nothing, every model is drawn so something still shows up.
 */
export function selectThumbnailModelNames(names: string[], preferName?: string | null): string[] {
  if (names.length === 0) return [];

  if (preferName) {
    const wanted = normalizeModelName(preferName);
    const exact = names.filter((name) => normalizeModelName(name) === wanted);
    if (exact.length > 0) return exact;
  }

  const primary = names.filter((name) => !isAuxiliaryModelName(name));
  return primary.length > 0 ? primary : [...names];
}
