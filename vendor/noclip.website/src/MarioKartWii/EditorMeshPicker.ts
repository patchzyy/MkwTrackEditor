// CPU mesh picker + per-draw-call editing for the MKW track editor's "Model" mode.
//
// Builds, lazily and cached, a world-space triangle list for every draw call of every
// MDL0ModelInstance we are told about, so that a click in the viewport can resolve to
// "this polygon group" or even "this single tree" (a connected component of the shape).

import { mat4, vec3 } from 'gl-matrix';
import * as BRRES from '../rres/brres.js';
import * as GX from '../gx/gx_enum.js';
import { MDL0ModelInstance } from '../rres/render.js';
import type { ShapeInstanceEditorComponentDraw, ShapeInstanceEditorCopyDraw, ShapeInstanceEditorOverride } from '../rres/render.js';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import {
    buildComponentIndexLists,
    collectTriangleEdges,
    createEmptyBounds,
    expandBounds,
    isBoundsEmpty,
    rayAabbIntersection,
    rayTriangleIntersection,
    splitTrianglesIntoComponents,
    unionBounds,
    type MeshBounds,
    type TriangleComponentSplit,
} from '../../../../src/lib/meshPick.js';

export type EditorMeshGranularity = 'component' | 'shape' | 'node';

export interface EditorMeshTargetRef {
    archivePath: string;
    modelName: string;
    shapeIndex: number;
    /** Index into the concatenated [DrawOpa, DrawXlu] op lists. */
    drawOpIndex: number;
    componentIndex: number | null;
    nodeId: number;
    granularity: EditorMeshGranularity;
}

export interface EditorMeshPickResult extends EditorMeshTargetRef {
    shapeName: string;
    materialName: string;
    nodeName: string;
    /** Hit position in KMP/game units. */
    hitPoint: { x: number; y: number; z: number };
    /** Distance from the ray origin, in scene units. */
    distance: number;
}

export interface EditorMeshBounds {
    /** Bounds in KMP/game units. */
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    /** Half of the bounding box diagonal, in game units. */
    radius: number;
    triangleCount: number;
}

export type EditorMeshTransformInput =
    | { kind: 'trs'; translation: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }
    | { kind: 'matrix'; matrix: ArrayLike<number> };

interface EditorMeshDrawCache {
    key: string;
    archivePath: string;
    modelName: string;
    modelInstance: MDL0ModelInstance;
    shapeIndex: number;
    shapeName: string;
    drawOpIndex: number;
    nodeId: number;
    nodeName: string;
    materialName: string;
    shapeInstanceIndex: number;
    /** Scene-space vertex positions, 3 floats per vertex. */
    positions: Float32Array;
    indices: Uint16Array;
    bounds: MeshBounds;
    split: TriangleComponentSplit | null;
    componentBuffers: GfxBuffer[] | null;
    componentDraws: ShapeInstanceEditorComponentDraw[] | null;
}

export interface EditorMeshSource {
    archivePath: string;
    modelInstance: MDL0ModelInstance;
}

const scratchMatrix = mat4.create();
const scratchPivot = mat4.create();
const scratchVec = vec3.create();

function drawKey(archivePath: string, modelName: string, drawOpIndex: number): string {
    return `${archivePath.toLowerCase()}::draw::${modelName}::${drawOpIndex}`;
}

/** Stable key for a target, matching `meshTargetKey` in src/lib/brresEditor.ts. */
export function editorMeshTargetKey(target: EditorMeshTargetRef): string {
    return [
        target.archivePath.toLowerCase(),
        target.modelName,
        target.granularity,
        target.granularity === 'node' ? `node${target.nodeId}` : `shape${target.shapeIndex}`,
        target.granularity === 'node' ? '' : `op${target.drawOpIndex}`,
        target.granularity === 'component' && target.componentIndex !== null ? `c${target.componentIndex}` : '',
    ].join('::');
}

/** Computes every joint-to-world matrix of a model instance, the way the renderer does. */
function computeJointToWorldMatrices(modelInstance: MDL0ModelInstance): mat4[] {
    const mdl0 = modelInstance.mdl0Model.mdl0;
    const count = Math.max(mdl0.numViewMtx, mdl0.mtxIdToNodeId.length, mdl0.nodes.length) + 1;
    const matrices: mat4[] = [];
    for (let i = 0; i < count; i++) matrices.push(mat4.create());
    mat4.copy(matrices[0], modelInstance.modelMatrix);
    for (const op of mdl0.sceneGraph.nodeTreeOps) {
        if (op.op === BRRES.ByteCodeOp.NODEDESC) {
            const node = mdl0.nodes[op.nodeId];
            if (node === undefined) continue;
            const parent = matrices[op.parentMtxId] ?? matrices[0];
            if (matrices[node.mtxId] === undefined) continue;
            mat4.mul(matrices[node.mtxId], parent, node.modelMatrix);
        } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
            const from = matrices[op.fromMtxId];
            const to = matrices[op.toMtxId];
            if (from !== undefined && to !== undefined) mat4.copy(to, from);
        }
    }
    return matrices;
}

/** One duplicate of a draw call, or of a single connected component of it. */
interface EditorMeshCopy {
    componentIndex: number | null;
    matrix: mat4;
}

export class EditorMeshPicker {
    private sources: EditorMeshSource[] = [];
    private caches: EditorMeshDrawCache[] | null = null;
    private cachesByKey = new Map<string, EditorMeshDrawCache>();
    private overridesByDraw = new Map<string, ShapeInstanceEditorOverride>();
    private componentTransforms = new Map<string, mat4>();
    private componentHidden = new Set<string>();
    /** Duplicates of a draw call, by draw key. Each one is redrawn with its own matrix. */
    private copiesByDraw = new Map<string, EditorMeshCopy[]>();
    /** Scene units per game unit (the MKW scene renders at 0.1). */
    public sceneScale = 0.1;
    public componentEpsilon = 1.0;
    /** Shapes above this triangle count are not split into components (too slow / pointless). */
    public maxComponentSplitTriangles = 200000;

    constructor(private device: GfxDevice) {
    }

    public setSources(sources: EditorMeshSource[]): void {
        this.sources = sources;
        this.invalidate();
    }

    public invalidate(): void {
        this.destroyComponentBuffers();
        this.caches = null;
        this.cachesByKey.clear();
    }

    public get isBuilt(): boolean {
        return this.caches !== null;
    }

    private destroyComponentBuffers(): void {
        if (this.caches === null) return;
        for (const cache of this.caches) {
            if (cache.componentBuffers === null) continue;
            for (const buffer of cache.componentBuffers) this.device.destroyBuffer(buffer);
            cache.componentBuffers = null;
            cache.componentDraws = null;
        }
    }

    public destroy(): void {
        this.destroyComponentBuffers();
        this.caches = null;
        this.cachesByKey.clear();
        this.overridesByDraw.clear();
        this.componentTransforms.clear();
        this.componentHidden.clear();
    }

    private ensureCaches(): EditorMeshDrawCache[] {
        if (this.caches !== null) return this.caches;
        const caches: EditorMeshDrawCache[] = [];
        for (const source of this.sources) {
            const modelInstance = source.modelInstance;
            const mdl0 = modelInstance.mdl0Model.mdl0;
            const jointToWorld = computeJointToWorldMatrices(modelInstance);
            const drawOps = [...mdl0.sceneGraph.drawOpaOps, ...mdl0.sceneGraph.drawXluOps];
            for (let drawOpIndex = 0; drawOpIndex < drawOps.length; drawOpIndex++) {
                const op = drawOps[drawOpIndex];
                const shape = mdl0.shapes[op.shpId];
                if (shape === undefined) continue;
                // Skinned shapes have no single node matrix; they are not editable per-mesh.
                if (shape.mtxIdx < 0) continue;
                const worldMatrix = jointToWorld[shape.mtxIdx];
                if (worldMatrix === undefined) continue;
                const geometry = this.readShapeGeometry(shape, worldMatrix);
                if (geometry === null) continue;
                const node = mdl0.nodes[op.nodeId];
                caches.push({
                    key: drawKey(source.archivePath, mdl0.name, drawOpIndex),
                    archivePath: source.archivePath,
                    modelName: mdl0.name,
                    modelInstance,
                    shapeIndex: op.shpId,
                    shapeName: shape.name,
                    drawOpIndex,
                    nodeId: op.nodeId,
                    nodeName: node?.name ?? `node${op.nodeId}`,
                    materialName: mdl0.materials[op.matId]?.name ?? '',
                    shapeInstanceIndex: drawOpIndex,
                    positions: geometry.positions,
                    indices: geometry.indices,
                    bounds: geometry.bounds,
                    split: null,
                    componentBuffers: null,
                    componentDraws: null,
                });
            }
        }
        this.caches = caches;
        this.cachesByKey.clear();
        for (const cache of caches) this.cachesByKey.set(cache.key, cache);
        this.reapplyOverrides();
        return caches;
    }

    private readShapeGeometry(shape: BRRES.MDL0_ShapeEntry, worldMatrix: mat4): { positions: Float32Array; indices: Uint16Array; bounds: MeshBounds } | null {
        const loaded = shape.loadedVertexData;
        const layout = shape.loadedVertexLayout;
        const stride = layout.vertexBufferStrides[0];
        const posOffset = layout.vertexAttributeOffsets[GX.Attr.POS];
        if (stride === undefined || posOffset === undefined) return null;
        const vertexBuffer = loaded.vertexBuffers[0];
        if (vertexBuffer === undefined) return null;

        const vertexCount = loaded.totalVertexCount;
        const view = new DataView(vertexBuffer);
        const positions = new Float32Array(vertexCount * 3);
        const bounds = createEmptyBounds();
        for (let i = 0; i < vertexCount; i++) {
            const base = i * stride + posOffset;
            if (base + 12 > view.byteLength) break;
            vec3.set(scratchVec, view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true));
            vec3.transformMat4(scratchVec, scratchVec, worldMatrix);
            positions[i * 3 + 0] = scratchVec[0];
            positions[i * 3 + 1] = scratchVec[1];
            positions[i * 3 + 2] = scratchVec[2];
            expandBounds(bounds, scratchVec[0], scratchVec[1], scratchVec[2]);
        }

        const indices = new Uint16Array(loaded.indexData, 0, loaded.totalIndexCount);
        if (indices.length < 3 || isBoundsEmpty(bounds)) return null;
        return { positions, indices, bounds };
    }

    private ensureSplit(cache: EditorMeshDrawCache): TriangleComponentSplit | null {
        if (cache.split !== null) return cache.split;
        if (cache.indices.length / 3 > this.maxComponentSplitTriangles) return null;
        cache.split = splitTrianglesIntoComponents(cache.positions, cache.indices, this.componentEpsilon * this.sceneScale);
        return cache.split;
    }

    // ------------------------------------------------------------------ picking

    /**
     * Ray/triangle pick. `origin` and `direction` are in scene space; `direction`
     * must be normalized.
     */
    public pick(origin: vec3, direction: vec3, granularity: EditorMeshGranularity): EditorMeshPickResult | null {
        const caches = this.ensureCaches();
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestCache: EditorMeshDrawCache | null = null;
        let bestTriangle = -1;

        for (const cache of caches) {
            if (this.isDrawHidden(cache)) continue;
            const boxHit = rayAabbIntersection(origin[0], origin[1], origin[2], direction[0], direction[1], direction[2], cache.bounds);
            if (boxHit === null || boxHit > bestDistance) continue;
            const positions = cache.positions;
            const indices = cache.indices;
            for (let t = 0; t + 2 < indices.length; t += 3) {
                const a = indices[t] * 3;
                const b = indices[t + 1] * 3;
                const c = indices[t + 2] * 3;
                const hit = rayTriangleIntersection(
                    origin[0], origin[1], origin[2],
                    direction[0], direction[1], direction[2],
                    positions[a], positions[a + 1], positions[a + 2],
                    positions[b], positions[b + 1], positions[b + 2],
                    positions[c], positions[c + 1], positions[c + 2],
                );
                if (hit === null || hit >= bestDistance) continue;
                bestDistance = hit;
                bestCache = cache;
                bestTriangle = t / 3;
            }
        }

        if (bestCache === null) return null;
        return this.makePickResult(bestCache, bestTriangle, bestDistance, origin, direction, granularity);
    }

    private makePickResult(
        cache: EditorMeshDrawCache,
        triangleIndex: number,
        distance: number,
        origin: vec3,
        direction: vec3,
        granularity: EditorMeshGranularity,
    ): EditorMeshPickResult {
        let componentIndex: number | null = null;
        if (granularity === 'component') {
            const split = this.ensureSplit(cache);
            if (split !== null && triangleIndex >= 0) componentIndex = split.triangleComponent[triangleIndex];
        }
        const inv = 1 / this.sceneScale;
        return {
            archivePath: cache.archivePath,
            modelName: cache.modelName,
            shapeIndex: cache.shapeIndex,
            shapeName: cache.shapeName,
            drawOpIndex: cache.drawOpIndex,
            componentIndex,
            nodeId: cache.nodeId,
            nodeName: cache.nodeName,
            materialName: cache.materialName,
            granularity,
            hitPoint: {
                x: (origin[0] + direction[0] * distance) * inv,
                y: (origin[1] + direction[1] * distance) * inv,
                z: (origin[2] + direction[2] * distance) * inv,
            },
            distance,
        };
    }

    /**
     * Every mesh whose bounds project inside the given screen rectangle.
     * `project` maps a scene-space point to normalized viewport coordinates, or null when behind the camera.
     */
    public pickInRect(
        minX: number, minY: number, maxX: number, maxY: number,
        project: (point: vec3) => { x: number; y: number } | null,
        granularity: EditorMeshGranularity,
    ): EditorMeshPickResult[] {
        const caches = this.ensureCaches();
        const results: EditorMeshPickResult[] = [];
        const seen = new Set<string>();
        for (const cache of caches) {
            if (this.isDrawHidden(cache)) continue;
            if (granularity === 'component') {
                const split = this.ensureSplit(cache);
                if (split !== null) {
                    for (let component = 0; component < split.componentCount; component++) {
                        if (!this.boundsInRect(split.bounds[component], minX, minY, maxX, maxY, project)) continue;
                        const result = this.makeTargetResult(cache, component, granularity);
                        if (seen.has(editorMeshTargetKey(result))) continue;
                        seen.add(editorMeshTargetKey(result));
                        results.push(result);
                    }
                    continue;
                }
            }
            if (!this.boundsInRect(cache.bounds, minX, minY, maxX, maxY, project)) continue;
            const result = this.makeTargetResult(cache, null, granularity);
            if (seen.has(editorMeshTargetKey(result))) continue;
            seen.add(editorMeshTargetKey(result));
            results.push(result);
        }
        return results;
    }

    private boundsInRect(
        bounds: MeshBounds,
        minX: number, minY: number, maxX: number, maxY: number,
        project: (point: vec3) => { x: number; y: number } | null,
    ): boolean {
        if (isBoundsEmpty(bounds)) return false;
        vec3.set(scratchVec, (bounds.min.x + bounds.max.x) * 0.5, (bounds.min.y + bounds.max.y) * 0.5, (bounds.min.z + bounds.max.z) * 0.5);
        const projected = project(scratchVec);
        if (projected === null) return false;
        return projected.x >= minX && projected.x <= maxX && projected.y >= minY && projected.y <= maxY;
    }

    private makeTargetResult(cache: EditorMeshDrawCache, componentIndex: number | null, granularity: EditorMeshGranularity): EditorMeshPickResult {
        const bounds = componentIndex !== null && cache.split !== null ? cache.split.bounds[componentIndex] : cache.bounds;
        const inv = 1 / this.sceneScale;
        return {
            archivePath: cache.archivePath,
            modelName: cache.modelName,
            shapeIndex: cache.shapeIndex,
            shapeName: cache.shapeName,
            drawOpIndex: cache.drawOpIndex,
            componentIndex: granularity === 'component' ? componentIndex : null,
            nodeId: cache.nodeId,
            nodeName: cache.nodeName,
            materialName: cache.materialName,
            granularity,
            hitPoint: {
                x: (bounds.min.x + bounds.max.x) * 0.5 * inv,
                y: (bounds.min.y + bounds.max.y) * 0.5 * inv,
                z: (bounds.min.z + bounds.max.z) * 0.5 * inv,
            },
            distance: 0,
        };
    }

    // ------------------------------------------------------------------ bounds

    private collectTargetCaches(target: EditorMeshTargetRef): EditorMeshDrawCache[] {
        const caches = this.ensureCaches();
        if (target.granularity === 'node')
            return caches.filter((cache) => cache.archivePath.toLowerCase() === target.archivePath.toLowerCase() && cache.modelName === target.modelName && cache.nodeId === target.nodeId);
        const cache = this.cachesByKey.get(drawKey(target.archivePath, target.modelName, target.drawOpIndex));
        return cache === undefined ? [] : [cache];
    }

    /** Bounds of a target, in KMP/game units, including any live edit. */
    public getBounds(target: EditorMeshTargetRef, applyEdits = true): EditorMeshBounds | null {
        const caches = this.collectTargetCaches(target);
        if (caches.length === 0) return null;
        const bounds = this.getSceneBounds(target, applyEdits);
        if (bounds === null) return null;
        let triangleCount = 0;
        for (const cache of caches) {
            if (target.granularity === 'component' && target.componentIndex !== null && caches.length === 1) {
                const split = this.ensureSplit(cache);
                if (split !== null && target.componentIndex < split.componentCount) {
                    triangleCount += split.triangleCounts[target.componentIndex];
                    continue;
                }
            }
            triangleCount += cache.indices.length / 3;
        }
        const inv = 1 / this.sceneScale;
        const min = { x: bounds.min.x * inv, y: bounds.min.y * inv, z: bounds.min.z * inv };
        const max = { x: bounds.max.x * inv, y: bounds.max.y * inv, z: bounds.max.z * inv };
        return {
            min,
            max,
            center: { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: (min.z + max.z) * 0.5 },
            radius: 0.5 * Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z),
            triangleCount,
        };
    }

    /** The extra transform currently applied to a draw call / component, if any. */
    private getActiveMatrix(cache: EditorMeshDrawCache, componentIndex: number | null): mat4 | null {
        if (componentIndex !== null) {
            const componentMatrix = this.componentTransforms.get(this.componentKey(cache, componentIndex));
            if (componentMatrix !== undefined) return componentMatrix;
        }
        return this.overridesByDraw.get(cache.key)?.extraWorldMatrix ?? null;
    }

    private expandTransformedBounds(dst: MeshBounds, source: MeshBounds, matrix: mat4 | null): void {
        if (matrix === null) {
            unionBounds(dst, source);
            return;
        }
        if (isBoundsEmpty(source)) return;
        for (let corner = 0; corner < 8; corner++) {
            vec3.set(
                scratchVec,
                (corner & 1) ? source.max.x : source.min.x,
                (corner & 2) ? source.max.y : source.min.y,
                (corner & 4) ? source.max.z : source.min.z,
            );
            vec3.transformMat4(scratchVec, scratchVec, matrix);
            expandBounds(dst, scratchVec[0], scratchVec[1], scratchVec[2]);
        }
    }

    /** Scene-space bounds (with any live edit applied), for drawing the highlight box. */
    public getSceneBounds(target: EditorMeshTargetRef, applyEdits = true): MeshBounds | null {
        const caches = this.collectTargetCaches(target);
        if (caches.length === 0) return null;
        const bounds = createEmptyBounds();
        for (const cache of caches) {
            const componentIndex = target.granularity === 'component' && caches.length === 1 ? target.componentIndex : null;
            const matrix = applyEdits ? this.getActiveMatrix(cache, componentIndex) : null;
            if (componentIndex !== null) {
                const split = this.ensureSplit(cache);
                if (split !== null && componentIndex < split.componentCount) {
                    this.expandTransformedBounds(bounds, split.bounds[componentIndex], matrix);
                    continue;
                }
            }
            this.expandTransformedBounds(bounds, cache.bounds, matrix);
        }
        return isBoundsEmpty(bounds) ? null : bounds;
    }

    /** Number of connected components in the shape a target points at. */
    public getComponentCount(target: EditorMeshTargetRef): number {
        const caches = this.collectTargetCaches(target);
        if (caches.length !== 1) return 0;
        const split = this.ensureSplit(caches[0]);
        return split?.componentCount ?? 0;
    }

    /**
     * Edges of the target's triangles, in scene space, for the hover/selection wireframe.
     * Capped so a huge shape cannot stall the debug draw.
     */
    public getHighlightEdges(target: EditorMeshTargetRef, maxEdges = 6000): Array<[number, number, number, number, number, number]> {
        const caches = this.collectTargetCaches(target);
        const edges: Array<[number, number, number, number, number, number]> = [];
        for (const cache of caches) {
            if (edges.length >= maxEdges) break;
            let indices: ArrayLike<number> = cache.indices;
            const componentIndex = target.granularity === 'component' && caches.length === 1 ? target.componentIndex : null;
            if (componentIndex !== null) {
                const split = this.ensureSplit(cache);
                if (split !== null && componentIndex < split.componentCount) {
                    const filtered: number[] = [];
                    for (let t = 0; t < split.triangleComponent.length; t++) {
                        if (split.triangleComponent[t] !== componentIndex) continue;
                        filtered.push(cache.indices[t * 3], cache.indices[t * 3 + 1], cache.indices[t * 3 + 2]);
                    }
                    indices = filtered;
                }
            }
            const matrix = this.getActiveMatrix(cache, componentIndex);
            const localEdges = collectTriangleEdges(indices, maxEdges - edges.length);
            const p = cache.positions;
            for (const [a, b] of localEdges) {
                if (matrix === null) {
                    edges.push([p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]]);
                    continue;
                }
                vec3.transformMat4(scratchVec, vec3.set(scratchVec, p[a * 3], p[a * 3 + 1], p[a * 3 + 2]), matrix);
                const ax = scratchVec[0], ay = scratchVec[1], az = scratchVec[2];
                vec3.transformMat4(scratchVec, vec3.set(scratchVec, p[b * 3], p[b * 3 + 1], p[b * 3 + 2]), matrix);
                edges.push([ax, ay, az, scratchVec[0], scratchVec[1], scratchVec[2]]);
            }
        }
        return edges;
    }

    // ------------------------------------------------------------------ editing

    private isDrawHidden(cache: EditorMeshDrawCache): boolean {
        const override = this.overridesByDraw.get(cache.key);
        return override !== undefined && override.hidden;
    }

    private getShapeInstance(cache: EditorMeshDrawCache): { editorOverride: ShapeInstanceEditorOverride | null } | null {
        const instance = cache.modelInstance.shapeInstances[cache.shapeInstanceIndex];
        return (instance as unknown as { editorOverride: ShapeInstanceEditorOverride | null }) ?? null;
    }

    /** Builds (once) one index buffer per connected component of a shape. */
    private ensureComponentDraws(cache: EditorMeshDrawCache): ShapeInstanceEditorComponentDraw[] | null {
        if (cache.componentDraws !== null) return cache.componentDraws;
        const split = this.ensureSplit(cache);
        if (split === null || split.componentCount <= 1) return null;
        const lists = buildComponentIndexLists(cache.indices, split);
        const shapeData = cache.modelInstance.mdl0Model.shapeData[cache.shapeIndex];
        if (shapeData === undefined) return null;
        const buffers: GfxBuffer[] = [];
        const draws: ShapeInstanceEditorComponentDraw[] = [];
        for (const list of lists) {
            const u16 = Uint16Array.from(list);
            const buffer = createBufferFromData(this.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, u16.buffer);
            buffers.push(buffer);
            draws.push({ indexBuffer: { buffer, byteOffset: 0 }, indexCount: u16.length, extraWorldMatrix: null, hidden: false });
        }
        cache.componentBuffers = buffers;
        cache.componentDraws = draws;
        return draws;
    }

    private componentKey(cache: EditorMeshDrawCache, componentIndex: number): string {
        return `${cache.key}::c${componentIndex}`;
    }

    /**
     * Applies (or clears) an extra transform on a mesh target. `null` resets it.
     * TRS input is expressed in KMP/game units and degrees and pivots on the target's centre.
     */
    public setTransform(target: EditorMeshTargetRef, transform: EditorMeshTransformInput | null): boolean {
        const matrix = transform === null ? null : this.buildSceneMatrix(target, transform);
        return this.mutateTarget(target, (cache, componentIndex) => {
            if (componentIndex === null) {
                const override = this.getOrCreateOverride(cache);
                override.extraWorldMatrix = matrix === null ? null : mat4.clone(matrix);
            } else {
                const key = this.componentKey(cache, componentIndex);
                if (matrix === null) this.componentTransforms.delete(key);
                else this.componentTransforms.set(key, mat4.clone(matrix));
            }
        });
    }

    public setVisible(target: EditorMeshTargetRef, visible: boolean): boolean {
        return this.mutateTarget(target, (cache, componentIndex) => {
            if (componentIndex === null) {
                const override = this.getOrCreateOverride(cache);
                override.hidden = !visible;
            } else {
                const key = this.componentKey(cache, componentIndex);
                if (visible) this.componentHidden.delete(key);
                else this.componentHidden.add(key);
            }
        });
    }

    /**
     * Replaces the set of duplicates of `target`. Each transform is a game-unit TRS pivoting on
     * the target's own centre, exactly like `setTransform`, so a copy offset by (0, 500, 0) sits
     * 500 units above the original — the same thing the exporter bakes.
     */
    public setCopies(target: EditorMeshTargetRef, transforms: readonly EditorMeshTransformInput[]): boolean {
        const matrices = transforms.map((transform) => mat4.clone(this.buildSceneMatrix(target, transform)));
        return this.mutateTarget(target, (cache, componentIndex) => {
            const kept = (this.copiesByDraw.get(cache.key) ?? []).filter((copy) => copy.componentIndex !== componentIndex);
            const next = [...kept, ...matrices.map((matrix) => ({ componentIndex, matrix }))];
            if (next.length === 0) this.copiesByDraw.delete(cache.key);
            else this.copiesByDraw.set(cache.key, next);
        });
    }

    public clearAllEdits(): void {
        this.overridesByDraw.clear();
        this.componentTransforms.clear();
        this.componentHidden.clear();
        this.copiesByDraw.clear();
        this.reapplyOverrides();
    }

    private mutateTarget(target: EditorMeshTargetRef, mutate: (cache: EditorMeshDrawCache, componentIndex: number | null) => void): boolean {
        const caches = this.collectTargetCaches(target);
        if (caches.length === 0) return false;
        let componentIndex = target.granularity === 'component' && caches.length === 1 ? target.componentIndex : null;
        if (componentIndex !== null) {
            // A shape with a single component needs no split: edit the whole draw call.
            const split = this.ensureSplit(caches[0]);
            if (split === null || split.componentCount <= 1) componentIndex = null;
        }
        for (const cache of caches) mutate(cache, componentIndex);
        this.reapplyOverrides();
        return true;
    }

    private getOrCreateOverride(cache: EditorMeshDrawCache): ShapeInstanceEditorOverride {
        let override = this.overridesByDraw.get(cache.key);
        if (override === undefined) {
            override = { hidden: false, extraWorldMatrix: null, componentDraws: null, copyDraws: null };
            this.overridesByDraw.set(cache.key, override);
        }
        return override;
    }

    /** Pushes the accumulated overrides onto the live shape instances. */
    private reapplyOverrides(): void {
        if (this.caches === null) return;
        for (const cache of this.caches) {
            const shapeInstance = this.getShapeInstance(cache);
            if (shapeInstance === null) continue;
            const override = this.overridesByDraw.get(cache.key) ?? null;

            let componentDraws: ShapeInstanceEditorComponentDraw[] | null = null;
            const needsComponents = this.cacheNeedsComponentDraws(cache);
            if (needsComponents) componentDraws = this.ensureComponentDraws(cache);
            if (componentDraws !== null) {
                for (let i = 0; i < componentDraws.length; i++) {
                    const key = this.componentKey(cache, i);
                    componentDraws[i].extraWorldMatrix = this.componentTransforms.get(key) ?? null;
                    componentDraws[i].hidden = this.componentHidden.has(key);
                }
            }

            const copies = this.copiesByDraw.get(cache.key) ?? null;
            let copyDraws: ShapeInstanceEditorCopyDraw[] | null = null;
            if (copies !== null && copies.length > 0) {
                // A copy of one connected component needs that component's index buffer; a copy
                // of a whole draw call reuses the shape's own index ranges.
                const draws = copies.some((copy) => copy.componentIndex !== null)
                    ? componentDraws ?? this.ensureComponentDraws(cache)
                    : null;
                copyDraws = copies.map((copy) => {
                    const component = copy.componentIndex !== null && draws !== null ? draws[copy.componentIndex] : undefined;
                    return component !== undefined
                        ? { indexBuffer: component.indexBuffer, indexCount: component.indexCount, extraWorldMatrix: copy.matrix }
                        : { indexBuffer: null, indexCount: 0, extraWorldMatrix: copy.matrix };
                });
            }

            if (override === null && componentDraws === null && copyDraws === null) {
                shapeInstance.editorOverride = null;
                continue;
            }
            shapeInstance.editorOverride = {
                hidden: override?.hidden ?? false,
                extraWorldMatrix: override?.extraWorldMatrix ?? null,
                componentDraws,
                copyDraws,
            };
        }
    }

    private cacheNeedsComponentDraws(cache: EditorMeshDrawCache): boolean {
        const prefix = `${cache.key}::c`;
        for (const key of this.componentTransforms.keys()) if (key.startsWith(prefix)) return true;
        for (const key of this.componentHidden) if (key.startsWith(prefix)) return true;
        return false;
    }

    /** Converts a game-unit TRS (pivoting on the target's centre) into a scene-space matrix. */
    private buildSceneMatrix(target: EditorMeshTargetRef, transform: EditorMeshTransformInput): mat4 {
        if (transform.kind === 'matrix') {
            const matrix = mat4.create();
            for (let i = 0; i < 16; i++) matrix[i] = transform.matrix[i];
            return matrix;
        }
        // Pivot on the untransformed centre so repeated edits do not drift.
        const bounds = this.getSceneBounds(target, false);
        const pivotX = bounds === null ? 0 : (bounds.min.x + bounds.max.x) * 0.5;
        const pivotY = bounds === null ? 0 : (bounds.min.y + bounds.max.y) * 0.5;
        const pivotZ = bounds === null ? 0 : (bounds.min.z + bounds.max.z) * 0.5;

        const deg = Math.PI / 180;
        mat4.identity(scratchMatrix);
        mat4.translate(scratchMatrix, scratchMatrix, [
            pivotX + transform.translation.x * this.sceneScale,
            pivotY + transform.translation.y * this.sceneScale,
            pivotZ + transform.translation.z * this.sceneScale,
        ]);
        mat4.rotateY(scratchMatrix, scratchMatrix, transform.rotation.y * deg);
        mat4.rotateX(scratchMatrix, scratchMatrix, transform.rotation.x * deg);
        mat4.rotateZ(scratchMatrix, scratchMatrix, transform.rotation.z * deg);
        mat4.scale(scratchMatrix, scratchMatrix, [transform.scale.x, transform.scale.y, transform.scale.z]);
        mat4.identity(scratchPivot);
        mat4.translate(scratchPivot, scratchPivot, [-pivotX, -pivotY, -pivotZ]);
        return mat4.mul(mat4.create(), scratchMatrix, scratchPivot);
    }

    /** Every draw call currently known, for debugging and for the app's mesh list. */
    public listMeshes(): Array<EditorMeshTargetRef & { shapeName: string; materialName: string; nodeName: string; triangleCount: number }> {
        return this.ensureCaches().map((cache) => ({
            archivePath: cache.archivePath,
            modelName: cache.modelName,
            shapeIndex: cache.shapeIndex,
            shapeName: cache.shapeName,
            drawOpIndex: cache.drawOpIndex,
            componentIndex: null,
            nodeId: cache.nodeId,
            nodeName: cache.nodeName,
            materialName: cache.materialName,
            granularity: 'shape' as const,
            triangleCount: cache.indices.length / 3,
        }));
    }
}
