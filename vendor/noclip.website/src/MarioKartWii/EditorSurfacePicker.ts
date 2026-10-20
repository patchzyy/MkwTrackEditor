// CPU surface picker for the MKW track editor: "which model, draw call and material is under the
// cursor", across the course model, the skybox, models placed from the content browser and every
// KMP object preview (item boxes, trees, ...).
//
// Unlike `EditorMeshPicker` (Model mode), nothing here is baked into world space. Geometry is
// cached once per (MDL0Model, shape) in the shape's own space and the *ray* is brought into that
// space per draw call, using the joint matrix the instance drew with on its last frame. That is
// what makes it cheap for three hundred trees, and what lets a spinning, route-following item
// box be hit where it is on screen rather than where it was spawned.
//
// What is approximate:
//  - Skinned shapes (`mtxIdx < 0`) are tested in bind pose under the instance's model matrix.
//  - Billboarded nodes are tested un-billboarded.
//  - Model-mode per-component moves and duplicates are ignored (whole-draw-call moves and hides
//    are honoured).
//  - An instance counts only if it queued draws on the last frame or the one before, so anything
//    culled, hidden or not yet spawned on its route is not pickable — it is not on screen either.

import { mat4, vec3 } from 'gl-matrix';
import * as GX from '../gx/gx_enum.js';
import * as BRRES from '../rres/brres.js';
import { MDL0Model, MDL0ModelInstance, editorFrameClock } from '../rres/render.js';
import { cullFacingSign, triangleFacing } from './EditorMeshPicker.js';
import {
    collectTriangleEdges,
    createEmptyBounds,
    expandBounds,
    isBoundsEmpty,
    rayAabbIntersection,
    rayTriangleIntersection,
    type MeshBounds,
} from '../../../../src/lib/meshPick.js';

export type EditorSurfaceKind = 'course' | 'skybox' | 'object' | 'placed';

/** One live model instance the picker may hit, with what the host knows about it. */
export interface EditorSurfaceInstance {
    modelInstance: MDL0ModelInstance;
    /** The archive path the model was loaded from (`./course_model.brres`, `./itembox.brres`). */
    archivePath: string;
    kind: EditorSurfaceKind;
    /** KMP GOBJ index, for object previews. */
    objectIndex: number | null;
    objectId: number | null;
    /** ObjFlow name of the object (`itembox`), for object previews. */
    objectName: string | null;
    /** Scene id of a model placed from the content browser (`imported-3`). */
    placedInstanceId: string | null;
}

export interface EditorSurfacePickResult {
    archivePath: string;
    kind: EditorSurfaceKind;
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
    /** Hit position in KMP/game units. */
    hitPoint: { x: number; y: number; z: number };
    /** Distance along the (scene-space, normalized) ray. */
    distance: number;
    /** True when the shape was tested in bind pose or un-billboarded; see the file header. */
    approximate: boolean;
}

/** One highlight request: a single draw call, or every draw call that uses a material. */
export interface EditorSurfaceHighlightRequest {
    archivePath: string;
    modelName: string;
    drawOpIndex?: number | null;
    materialName?: string | null;
    /** Restrict to the instances of one KMP object; null/undefined means every instance. */
    objectIndex?: number | null;
    selected: boolean;
}

/** A resolved highlight: edges in shape space plus the matrix that puts them on screen. */
export interface EditorSurfaceHighlightDraw {
    edges: Float32Array;
    bounds: MeshBounds;
    matrix: mat4;
    selected: boolean;
    /** Draw the bounding box too: a single selected draw call, not a material's every use. */
    box: boolean;
}

interface ShapeGeometry {
    /** Raw POS values, shape space, 3 floats per vertex. */
    positions: Float32Array;
    indices: Uint16Array;
    bounds: MeshBounds;
    edges: Float32Array | null;
}

const EMPTY_GEOMETRY: unique symbol = Symbol('empty');

const scratchInverse = mat4.create();
const scratchWorld = mat4.create();
const scratchOrigin = vec3.create();
const scratchFar = vec3.create();
const scratchDirection = vec3.create();

export function normalizeEditorArchivePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').toLowerCase();
}

export class EditorSurfacePicker {
    private geometry = new WeakMap<MDL0Model, Map<number, ShapeGeometry | typeof EMPTY_GEOMETRY>>();
    private shapeIndices = new WeakMap<MDL0Model, Map<BRRES.MDL0_ShapeEntry, number>>();
    /** Scene units per game unit (the MKW scene renders at 0.1). */
    public sceneScale = 0.1;
    /** Edges per shape kept for the highlight; a 20k-triangle road does not need all of them. */
    public maxEdgesPerShape = 6000;

    /** Is this instance on screen right now (queued draws this frame or the previous one)? */
    public static isLive(instance: MDL0ModelInstance): boolean {
        return instance.visible && instance.editorPreparedFrame >= editorFrameClock.frame - 1;
    }

    private shapeIndexOf(model: MDL0Model, shape: BRRES.MDL0_ShapeEntry): number {
        let map = this.shapeIndices.get(model);
        if (map === undefined) {
            map = new Map(model.mdl0.shapes.map((entry, index) => [entry, index] as const));
            this.shapeIndices.set(model, map);
        }
        return map.get(shape) ?? -1;
    }

    private getGeometry(model: MDL0Model, shapeIndex: number): ShapeGeometry | null {
        let perModel = this.geometry.get(model);
        if (perModel === undefined) {
            perModel = new Map();
            this.geometry.set(model, perModel);
        }
        const cached = perModel.get(shapeIndex);
        if (cached !== undefined)
            return cached === EMPTY_GEOMETRY ? null : cached;
        const built = this.readGeometry(model.mdl0.shapes[shapeIndex]);
        perModel.set(shapeIndex, built ?? EMPTY_GEOMETRY);
        return built;
    }

    private readGeometry(shape: BRRES.MDL0_ShapeEntry | undefined): ShapeGeometry | null {
        if (shape === undefined)
            return null;
        const loaded = shape.loadedVertexData;
        const layout = shape.loadedVertexLayout;
        const stride = layout.vertexBufferStrides[0];
        const posOffset = layout.vertexAttributeOffsets[GX.Attr.POS];
        const vertexBuffer = loaded.vertexBuffers[0];
        if (stride === undefined || posOffset === undefined || vertexBuffer === undefined)
            return null;
        const view = new DataView(vertexBuffer);
        const count = loaded.totalVertexCount;
        const positions = new Float32Array(count * 3);
        const bounds = createEmptyBounds();
        for (let i = 0; i < count; i++) {
            const base = i * stride + posOffset;
            if (base + 12 > view.byteLength)
                break;
            const x = view.getFloat32(base, true), y = view.getFloat32(base + 4, true), z = view.getFloat32(base + 8, true);
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            expandBounds(bounds, x, y, z);
        }
        const indices = new Uint16Array(loaded.indexData, 0, loaded.totalIndexCount);
        if (indices.length < 3 || isBoundsEmpty(bounds))
            return null;
        return { positions, indices, bounds, edges: null };
    }

    /**
     * The matrix a draw call is drawn with on screen (shape space to scene space), including a
     * Model-mode whole-draw-call move. Null when Model mode hid the draw call.
     */
    private drawMatrix(dst: mat4, instance: MDL0ModelInstance, drawIndex: number): { matrix: mat4; approximate: boolean } | null {
        const shapeInstance = instance.shapeInstances[drawIndex];
        const override = shapeInstance.editorOverride;
        if (override !== null && override.hidden)
            return null;
        const shape = shapeInstance.shape;
        let approximate = false;
        if (shape.mtxIdx >= 0) {
            mat4.copy(dst, instance.getNodeToWorldMatrixReference(shape.mtxIdx));
            const nodeId = instance.mdl0Model.mdl0.mtxIdToNodeId[shape.mtxIdx];
            const node = nodeId !== undefined && nodeId >= 0 ? instance.mdl0Model.mdl0.nodes[nodeId] : undefined;
            if (node !== undefined && node.billboardMode !== BRRES.BillboardMode.NONE)
                approximate = true;
        } else {
            mat4.copy(dst, instance.modelMatrix);
            approximate = true;
        }
        if (override !== null && override.extraWorldMatrix !== null)
            mat4.mul(dst, override.extraWorldMatrix, dst);
        return { matrix: dst, approximate };
    }

    private isDrawVisible(instance: MDL0ModelInstance, drawIndex: number): boolean {
        const shapeInstance = instance.shapeInstances[drawIndex];
        if (shapeInstance === undefined || !shapeInstance.sortVizNode.visible)
            return false;
        const materialInstance = shapeInstance.materialInstance;
        return materialInstance.visible && materialInstance.materialHelper.valid;
    }

    /**
     * Nearest surface along a scene-space ray. `direction` must be normalized. The skybox is only
     * considered when `includeSkybox` is set, and then only when nothing else was hit: it wraps
     * the whole scene and would otherwise answer every click.
     */
    public pick(instances: readonly EditorSurfaceInstance[], origin: vec3, direction: vec3, includeSkybox = false): EditorSurfacePickResult | null {
        const solid = instances.filter((entry) => entry.kind !== 'skybox');
        const hit = this.pickAmong(solid, origin, direction);
        if (hit !== null || !includeSkybox)
            return hit;
        return this.pickAmong(instances.filter((entry) => entry.kind === 'skybox'), origin, direction);
    }

    private pickAmong(instances: readonly EditorSurfaceInstance[], origin: vec3, direction: vec3): EditorSurfacePickResult | null {
        let best: { entry: EditorSurfaceInstance; drawIndex: number; shapeIndex: number; distance: number; approximate: boolean } | null = null;
        for (const entry of instances) {
            const instance = entry.modelInstance;
            if (!EditorSurfacePicker.isLive(instance))
                continue;
            const model = instance.mdl0Model;
            for (let drawIndex = 0; drawIndex < instance.shapeInstances.length; drawIndex++) {
                if (!this.isDrawVisible(instance, drawIndex))
                    continue;
                const shapeInstance = instance.shapeInstances[drawIndex];
                const cullMode = shapeInstance.materialInstance.materialData.material.gxMaterial.cullMode;
                if (cullMode === GX.CullMode.ALL)
                    continue;
                const shapeIndex = this.shapeIndexOf(model, shapeInstance.shape);
                const geometry = this.getGeometry(model, shapeIndex);
                if (geometry === null)
                    continue;
                const placed = this.drawMatrix(scratchWorld, instance, drawIndex);
                if (placed === null)
                    continue;
                if (mat4.invert(scratchInverse, placed.matrix) === null)
                    continue;
                vec3.transformMat4(scratchOrigin, origin, scratchInverse);
                vec3.add(scratchFar, origin, direction);
                vec3.transformMat4(scratchFar, scratchFar, scratchInverse);
                vec3.sub(scratchDirection, scratchFar, scratchOrigin);
                const limit = best === null ? Number.POSITIVE_INFINITY : best.distance;
                const boxHit = rayAabbIntersection(scratchOrigin[0], scratchOrigin[1], scratchOrigin[2], scratchDirection[0], scratchDirection[1], scratchDirection[2], geometry.bounds);
                if (boxHit === null || boxHit > limit)
                    continue;
                // A mirroring matrix flips the winding the cull mode is judged by.
                const mirrored = mat4.determinant(placed.matrix) < 0;
                const cullFacing = cullFacingSign(cullMode) * (mirrored ? -1 : 1);
                const distance = this.intersect(geometry, scratchOrigin, scratchDirection, cullFacing, limit);
                if (distance === null)
                    continue;
                best = { entry, drawIndex, shapeIndex, distance, approximate: placed.approximate };
            }
        }
        if (best === null)
            return null;

        const instance = best.entry.modelInstance;
        const mdl0 = instance.mdl0Model.mdl0;
        const materialIndex = instance.materialInstanceMatIds[best.drawIndex] ?? -1;
        const inv = 1 / this.sceneScale;
        return {
            archivePath: best.entry.archivePath,
            kind: best.entry.kind,
            modelName: mdl0.name,
            drawOpIndex: best.drawIndex,
            shapeIndex: best.shapeIndex,
            shapeName: mdl0.shapes[best.shapeIndex]?.name ?? '',
            materialIndex,
            materialName: mdl0.materials[materialIndex]?.name ?? '',
            objectIndex: best.entry.objectIndex,
            objectId: best.entry.objectId,
            objectName: best.entry.objectName,
            placedInstanceId: best.entry.placedInstanceId,
            hitPoint: {
                x: (origin[0] + direction[0] * best.distance) * inv,
                y: (origin[1] + direction[1] * best.distance) * inv,
                z: (origin[2] + direction[2] * best.distance) * inv,
            },
            distance: best.distance,
            approximate: best.approximate,
        };
    }

    /** Nearest triangle hit in shape space, as a distance along the (world-normalized) ray. */
    private intersect(geometry: ShapeGeometry, origin: vec3, direction: vec3, cullFacing: number, limit: number): number | null {
        const positions = geometry.positions;
        const indices = geometry.indices;
        let best = limit;
        let found = false;
        for (let t = 0; t + 2 < indices.length; t += 3) {
            const a = indices[t] * 3;
            const b = indices[t + 1] * 3;
            const c = indices[t + 2] * 3;
            if (cullFacing !== 0 && triangleFacing(positions, a, b, c, direction) === cullFacing)
                continue;
            const hit = rayTriangleIntersection(
                origin[0], origin[1], origin[2],
                direction[0], direction[1], direction[2],
                positions[a], positions[a + 1], positions[a + 2],
                positions[b], positions[b + 1], positions[b + 2],
                positions[c], positions[c + 1], positions[c + 2],
            );
            if (hit === null || hit >= best)
                continue;
            best = hit;
            found = true;
        }
        return found ? best : null;
    }

    private getEdges(geometry: ShapeGeometry): Float32Array {
        if (geometry.edges !== null)
            return geometry.edges;
        const pairs = collectTriangleEdges(geometry.indices, this.maxEdgesPerShape);
        const edges = new Float32Array(pairs.length * 6);
        const p = geometry.positions;
        pairs.forEach(([a, b], i) => {
            edges.set([p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], i * 6);
        });
        geometry.edges = edges;
        return edges;
    }

    /**
     * Resolves highlight requests against the instances on screen right now. Cheap enough to run
     * every frame (it only compares names and indices; edges are cached per shape), which is what
     * keeps a highlight glued to an item box that is moving along its route.
     */
    public resolveHighlights(instances: readonly EditorSurfaceInstance[], requests: readonly EditorSurfaceHighlightRequest[], maxEdges = 24000): EditorSurfaceHighlightDraw[] {
        const out: EditorSurfaceHighlightDraw[] = [];
        if (requests.length === 0)
            return out;
        let budget = maxEdges;
        // Selected first, so a hover cannot starve the selection of its edge budget.
        const ordered = [...requests].sort((a, b) => Number(b.selected) - Number(a.selected));
        for (const request of ordered) {
            const archive = normalizeEditorArchivePath(request.archivePath);
            const byDrawOp = request.drawOpIndex !== undefined && request.drawOpIndex !== null;
            const matching = instances.filter((entry) =>
                normalizeEditorArchivePath(entry.archivePath) === archive &&
                entry.modelInstance.mdl0Model.mdl0.name === request.modelName &&
                (request.objectIndex === undefined || request.objectIndex === null || entry.objectIndex === request.objectIndex));
            const single = byDrawOp && matching.length === 1;
            for (const entry of matching) {
                const instance = entry.modelInstance;
                if (!EditorSurfacePicker.isLive(instance))
                    continue;
                const mdl0 = instance.mdl0Model.mdl0;
                for (let drawIndex = 0; drawIndex < instance.shapeInstances.length; drawIndex++) {
                    if (byDrawOp) {
                        if (drawIndex !== request.drawOpIndex)
                            continue;
                    } else if (mdl0.materials[instance.materialInstanceMatIds[drawIndex]]?.name !== request.materialName) {
                        continue;
                    }
                    if (!this.isDrawVisible(instance, drawIndex))
                        continue;
                    const shapeIndex = this.shapeIndexOf(instance.mdl0Model, instance.shapeInstances[drawIndex].shape);
                    const geometry = this.getGeometry(instance.mdl0Model, shapeIndex);
                    if (geometry === null)
                        continue;
                    const placed = this.drawMatrix(mat4.create(), instance, drawIndex);
                    if (placed === null)
                        continue;
                    let edges = this.getEdges(geometry);
                    if (edges.length / 6 > budget)
                        edges = edges.subarray(0, Math.max(0, budget) * 6);
                    budget -= edges.length / 6;
                    out.push({ edges, bounds: geometry.bounds, matrix: placed.matrix, selected: request.selected, box: request.selected && single });
                }
            }
        }
        return out;
    }
}
