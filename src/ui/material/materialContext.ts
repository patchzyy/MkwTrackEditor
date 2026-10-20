// "What is under the cursor": the model a click landed on and the materials its draw calls use.
// Pure, so the wording and the grouping are unit tested; `ModelMaterialsStrip.tsx` renders it.
import type { GxMaterialRef } from '../../lib/gxMaterial';
import type { MaterialBrief, ModelSlot } from '../../lib/materialSlots';
import type { SurfaceKind, SurfacePick } from '../../lib/surfacePick';

/** The model whose materials the Details panel is listing. */
export interface MaterialContext {
  archivePath: string;
  modelName: string;
  kind: SurfaceKind | 'archive';
  /** "Item Box", "Track", "Sky". */
  title: string;
  /** `'common'`: the game's shared file; editing makes a track copy first. */
  source: 'track' | 'common';
  /** Set for models placed from the content browser, whose materials cannot be edited here. */
  placed?: boolean;
}

/** One material the model draws with, for the "On this …" list. */
export interface ModelMaterialRow {
  key: string;
  ref: GxMaterialRef;
  materialName: string;
  materialIndex: number;
  /** Texture names of its layers, in order. */
  textureNames: string[];
  /** How many draw calls of the model use it. */
  drawCalls: number;
  translucent: boolean;
}

export function contextTitle(kind: SurfaceKind | 'archive', objectName: string | undefined, fallback: string): string {
  if (kind === 'course') return 'Track';
  if (kind === 'skybox') return 'Sky';
  if (kind === 'placed') return 'Placed model';
  return objectName?.trim() || fallback;
}

export function contextFromPick(pick: SurfacePick, archivePath: string): MaterialContext {
  return {
    archivePath,
    modelName: pick.modelName,
    kind: pick.kind,
    title: contextTitle(pick.kind, pick.objectName, friendlyFileName(pick.archivePath)),
    source: pick.source,
    placed: pick.kind === 'placed' ? true : undefined,
  };
}

/** "./itembox.brres" -> "Itembox" for a model with no better name. */
export function friendlyFileName(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.brres$/i, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : path;
}

/**
 * The materials a model's draw calls actually use — not every material in its dictionary — in the
 * order they are first drawn. A material no draw call points at is invisible in the viewport, so
 * it is not something you can have clicked.
 */
export function buildModelMaterialRows(
  archivePath: string,
  modelName: string,
  slots: readonly ModelSlot[],
  briefs: readonly MaterialBrief[],
): ModelMaterialRow[] {
  const byIndex = new Map<number, ModelMaterialRow>();
  for (const slot of slots) {
    const existing = byIndex.get(slot.materialIndex);
    if (existing) {
      existing.drawCalls++;
      continue;
    }
    const brief = briefs.find((entry) => entry.modelName === modelName && entry.materialIndex === slot.materialIndex);
    byIndex.set(slot.materialIndex, {
      key: `${slot.materialIndex}|${slot.materialName}`,
      ref: { archivePath, modelName, materialName: slot.materialName },
      materialName: slot.materialName,
      materialIndex: slot.materialIndex,
      textureNames: (brief?.textureNames ?? []).filter(Boolean),
      drawCalls: 1,
      translucent: brief?.translucent ?? slot.translucent,
    });
  }
  return [...byIndex.values()];
}

/** The line under the title. */
export function describeContext(context: MaterialContext, rowCount: number): string {
  const count = `${rowCount} material${rowCount === 1 ? '' : 's'}`;
  if (context.placed) return 'Placed model';
  const what = context.kind === 'course' ? 'Course model' : context.kind === 'skybox' ? 'Sky model' : 'Object model';
  return `${what} · ${count}`;
}

export function filterModelMaterialRows(rows: readonly ModelMaterialRow[], query: string): ModelMaterialRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => [row.materialName, ...row.textureNames].join(' ').toLowerCase().includes(needle));
}
