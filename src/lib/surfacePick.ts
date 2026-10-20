// Surface picking: "click a model in the viewport, get the draw call and material under the
// cursor". Shared types for the viewport prop (`surfacePicking`), the modes that use it and the
// noclip scene methods behind it. See docs/SURFACE-PICKING.md.

import type { Vec3 } from './kmp';

/** What kind of thing a surface belongs to. */
export type SurfaceKind = 'course' | 'skybox' | 'object' | 'placed';

/** The surface under a click. */
export interface SurfacePick {
  /**
   * `'track'` when the track archive has its own copy of `archivePath`; `'common'` when the model
   * comes from Common.szs (or the bundled object folders) and has to be copied in with
   * `ensureTrackLocalArchive` before it can be edited. Placed models report `'track'`.
   */
  source: 'track' | 'common';
  /**
   * Path of the archive inside the track (`./course_model.brres`, `./itembox.brres`). For a
   * `'common'` model it is the path a track copy would get. For a model placed from the content
   * browser it is the scene-only path `./editor-imported/imported-N.brres` (see `placedMeshId`).
   */
  archivePath: string;
  kind: SurfaceKind;
  modelName: string;
  /** Index into the model's `[...DrawOpa, ...DrawXlu]` draw calls. */
  drawOpIndex: number;
  shapeIndex: number;
  shapeName: string;
  materialIndex: number;
  materialName: string;
  /** KMP entity id of the object (`GOBJ-12`) when the surface belongs to an object preview. */
  objectEntityId?: string;
  /** Friendly object name ("Item Box"). */
  objectName?: string;
  /** KMP object id (`0x65` for the item box). */
  objectId?: number;
  /** `ImportedMesh.id` of a model placed from the content browser. */
  placedMeshId?: string;
  /** Hit position in game units. */
  hitPoint: Vec3;
  /**
   * True when the shape was tested in its bind pose or without billboarding, so the hit point
   * can be slightly off. The draw call and material are still the right ones.
   */
  approximate: boolean;
}

/** Outline one draw call, or every draw call that uses a material. */
export type SurfaceHighlight =
  | {
      kind: 'surface';
      archivePath: string;
      modelName: string;
      drawOpIndex: number;
      /** Limit to one object's instances (`GOBJ-12` or its index). Omit for every instance. */
      objectEntityId?: string;
      style?: 'selected' | 'hover';
    }
  | {
      kind: 'material';
      archivePath: string;
      modelName: string;
      materialName: string;
      objectEntityId?: string;
      style?: 'selected' | 'hover';
    };

/** The `surfacePicking` prop of `Noclip3DViewport`. */
export interface SurfacePickingOptions {
  /** A left click without drag. `null` for empty space (or sky, unless `includeSkybox`). */
  onPick: (pick: SurfacePick | null) => void;
  /** Pointer moved over a different surface (or off every surface). Throttled to one per frame. */
  onHover?: (pick: SurfacePick | null) => void;
  /** Outlines drawn in the viewport. Use the selected/hover colours of Model mode. */
  highlight?: SurfaceHighlight | readonly SurfaceHighlight[] | null;
  /** Outline the hovered surface automatically. Default true. */
  hoverHighlight?: boolean;
  /** Let a click on the sky pick the skybox model when nothing else is under the cursor. Default false. */
  includeSkybox?: boolean;
}

/** What the noclip scene returns from `pickEditorSurface`, before the viewport adds names. */
export interface RendererSurfacePick {
  archivePath: string;
  kind: SurfaceKind;
  modelName: string;
  drawOpIndex: number;
  shapeIndex: number;
  shapeName: string;
  materialIndex: number;
  materialName: string;
  objectIndex: number | null;
  objectId: number | null;
  objectName: string | null;
  placedInstanceId: string | null;
  hitPoint: Vec3;
  distance: number;
  approximate: boolean;
}

export interface RendererSurfaceHighlightRequest {
  archivePath: string;
  modelName: string;
  drawOpIndex?: number | null;
  materialName?: string | null;
  objectIndex?: number | null;
  selected: boolean;
}

/**
 * The slice of the noclip MKW scene that surface picking and material assignment use. Every
 * member is optional so `src/ui` can call it structurally on whatever scene is loaded.
 *
 * Hot paths for live preview — each returns false when it cannot apply, and the caller then falls
 * back to the "Refresh track" scene rebuild (`sceneRevision` on the viewport):
 *  - `reloadEditorMaterial(archivePath, modelName, materialName, brresBytes)` — re-parses one
 *    material from edited archive bytes and swaps it into *every* live instance of that model:
 *    the course model, and every copy of an object model (all item boxes at once).
 *  - `setEditorDrawOpMaterial(archivePath, modelName, drawOpIndex, materialIndex)` — mirrors
 *    `setDrawOpMaterial` on the live model, including the move between passes.
 */
export interface SurfaceRendererScene {
  pickEditorSurface?: (normalizedX: number, normalizedY: number, options?: { includeSkybox?: boolean }) => RendererSurfacePick | null;
  setEditorSurfaceHighlight?: (requests: RendererSurfaceHighlightRequest[]) => void;
  setEditorDrawOpMaterial?: (archivePath: string, modelName: string, drawOpIndex: number, materialIndex: number) => boolean;
  reloadEditorMaterial?: (archivePath: string, modelName: string, materialName: string, brres: Uint8Array) => boolean;
  getEditorArchiveSource?: (archivePath: string) => 'track' | 'common' | null;
}

/** Same surface (ignores the hit point)? */
export function sameSurface(a: SurfacePick | null | undefined, b: SurfacePick | null | undefined): boolean {
  if (!a || !b) return a === b || (!a && !b);
  return (
    a.archivePath.toLowerCase() === b.archivePath.toLowerCase() &&
    a.modelName === b.modelName &&
    a.drawOpIndex === b.drawOpIndex &&
    a.materialIndex === b.materialIndex &&
    (a.objectEntityId ?? '') === (b.objectEntityId ?? '') &&
    (a.placedMeshId ?? '') === (b.placedMeshId ?? '')
  );
}

/** `GOBJ-12` → 12. Accepts a bare index too. */
export function objectIndexFromEntityId(id: string | undefined): number | null {
  if (id === undefined) return null;
  const match = /^(?:GOBJ-)?(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Turns a mode's highlight prop into the scene's requests. */
export function toRendererHighlightRequests(highlight: SurfacePickingOptions['highlight'], hovered: SurfacePick | null): RendererSurfaceHighlightRequest[] {
  const list: readonly SurfaceHighlight[] = !highlight ? [] : Array.isArray(highlight) ? (highlight as readonly SurfaceHighlight[]) : [highlight as SurfaceHighlight];
  const requests: RendererSurfaceHighlightRequest[] = list.map((entry) => ({
    archivePath: entry.archivePath,
    modelName: entry.modelName,
    drawOpIndex: entry.kind === 'surface' ? entry.drawOpIndex : null,
    materialName: entry.kind === 'material' ? entry.materialName : null,
    objectIndex: objectIndexFromEntityId(entry.objectEntityId),
    selected: (entry.style ?? 'selected') === 'selected',
  }));
  if (hovered) {
    const already = list.some((entry) =>
      entry.kind === 'surface' &&
      entry.archivePath.toLowerCase() === hovered.archivePath.toLowerCase() &&
      entry.modelName === hovered.modelName &&
      entry.drawOpIndex === hovered.drawOpIndex &&
      (entry.objectEntityId === undefined || objectIndexFromEntityId(entry.objectEntityId) === objectIndexFromEntityId(hovered.objectEntityId)));
    if (!already) {
      requests.push({
        archivePath: hovered.archivePath,
        modelName: hovered.modelName,
        drawOpIndex: hovered.drawOpIndex,
        objectIndex: objectIndexFromEntityId(hovered.objectEntityId),
        selected: false,
      });
    }
  }
  return requests;
}
