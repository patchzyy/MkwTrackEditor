// Model Studio scene.
//
// A second, much smaller noclip scene for the editor's Model Studio: one or more BRRES archives
// rendered on a neutral backdrop with a ground grid, every MDL0 drawn as an `MDL0ModelInstance`,
// every CHR0/SRT0/PAT0/CLR0/VIS0 bindable on one shared clock, per-draw picking that follows the
// *animated* pose, and the same structural editor API the material tools already drive
// (`reloadEditorMaterial`, `addEditorTexture`, `listEditorMeshes`, the mesh highlight).
//
// It deliberately does not reuse `Scenes_MarioKartWii.ts`: that scene is a track — a course
// archive, KMP objects, post effects, editor overlays — and none of that applies to looking at a
// character. What it does reuse is everything below the scene: `MDL0Model` / `MDL0ModelInstance`,
// the texture holder, `AnimationController`, and the GX render helper.
//
// ## The light rig, and why a character used to render as a flat silhouette
//
// A Mario Kart Wii character material has lighting enabled on colour channel 0 and names a
// *light set* (`MDL0_MaterialEntry.lightSetIdx`) that the model itself does not contain: on the
// console the light set comes from the scene's `.blight`, which for a driver is the one the kart
// scene installs. Render the same BRRES with no `LightSetting` bound at all and every light in
// `u_Lights` stays zero, so the channel collapses to `ambient x material` — which for the retail
// driver materials is a dark blue — and the character comes out as a flat dark-blue silhouette.
// Binding a *course* `.blight` is no better: its light sets are indexed for course materials, so
// the driver's `lightSetIdx` lands on a set with no light objects in it and `calcLightSetLitMask`
// then pins the channel's `litMask` to 0, which is the same flat ambient result.
//
// The studio therefore builds its own three-point `LightSetting` and points *every* light set at
// it, so whichever index a material names it is lit. See `createStudioLightSetting`.

import * as Viewer from '../viewer.js';
import * as BRRES from '../rres/brres.js';
import * as GX from '../gx/gx_enum.js';
import * as GX_Texture from '../gx/gx_texture.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import AnimationController from '../AnimationController.js';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from '../rres/render.js';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from '../gx/gx_render.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRendererLayer, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { colorNewFromRGBA, type Color } from '../Color.js';
import { DebugDrawFlags } from '../gfx/helpers/DebugDraw.js';
import { AABB } from '../Geometry.js';
import {
    createEmptyBounds,
    expandBounds,
    isBoundsEmpty,
    rayAabbIntersection,
    rayTriangleIntersection,
    type MeshBounds,
} from '../../../../src/lib/meshPick.js';

export type StudioAnimationKind = 'chr0' | 'srt0' | 'pat0' | 'clr0' | 'vis0' | 'scn0';

/** One animation in a loaded archive, as the studio's transport lists it. */
export interface StudioAnimationInfo {
    kind: StudioAnimationKind;
    name: string;
    duration: number;
    loopMode: number;
    enabled: boolean;
    /** False for kinds the BRRES renderer cannot play (SCN0). */
    supported: boolean;
}

export interface StudioModelInfo {
    archivePath: string;
    modelName: string;
    kind: 'course' | 'skybox' | 'imported';
    visible: boolean;
    materialCount: number;
    shapeCount: number;
    nodeCount: number;
}

export interface StudioArchiveInfo {
    archivePath: string;
    models: StudioModelInfo[];
    textureNames: string[];
    animations: StudioAnimationInfo[];
}

export interface StudioMeshRef {
    archivePath: string;
    modelName: string;
    shapeIndex: number;
    drawOpIndex: number;
    componentIndex: number | null;
    nodeId: number;
    granularity: 'component' | 'shape' | 'node';
}

export interface StudioMeshEntry extends StudioMeshRef {
    shapeName: string;
    materialName: string;
    nodeName: string;
    triangleCount: number;
}

export interface StudioMeshPick extends StudioMeshEntry {
    hitPoint: { x: number; y: number; z: number };
    distance: number;
}

export interface StudioBounds {
    center: { x: number; y: number; z: number };
    radius: number;
}

export interface StudioTransportState {
    playing: boolean;
    /** 1 = real time. */
    speed: number;
    loop: boolean;
}

const studioClearDescriptor = makeAttachmentClearDescriptor(colorNewFromRGBA(0.078, 0.086, 0.102, 1.0));
const gridLineOptions = { flags: DebugDrawFlags.DepthTint };
const gridMinorColor = colorNewFromRGBA(1, 1, 1, 0.07);
const gridMajorColor = colorNewFromRGBA(1, 1, 1, 0.15);
const gridAxisXColor = colorNewFromRGBA(0.85, 0.32, 0.35, 0.5);
const gridAxisZColor = colorNewFromRGBA(0.35, 0.55, 0.95, 0.5);
const meshHoverColor = colorNewFromRGBA(1.0, 0.78, 0.25, 0.85);
const meshSelectedColor = colorNewFromRGBA(1.0, 0.55, 0.1, 1.0);

/** NDC depths probed when unprojecting a pick ray; conventions differ between backends. */
const pickRayDepthSamples = [0.5, 0.25, 0.75, 0.1, 0.9, 0.0, 1.0];

/** The studio's own three-point rig, plus a soft ambient, in every one of the 128 light sets. */
export function createStudioLightSetting(): BRRES.LightSetting {
    const setting = new BRRES.LightSetting(8, 128);

    const place = (index: number, dir: vec3, color: Color) => {
        const obj = setting.lightObj[index];
        obj.enable();
        obj.enableColor();
        obj.initLightColor(color);
        // A point light parked a long way out is a directional light for all practical purposes,
        // and it is the only kind `LightSet.calcLights` knows how to place.
        vec3.scale(obj.light.Position, dir, 1.0e6);
        vec3.negate(obj.light.Direction, dir);
        vec3.normalize(obj.light.Direction, obj.light.Direction);
        // Unit attenuation: `attn = k0 + k1*c + k2*c^2` with (1, 0, 0) is 1 for every spot and
        // distance function, so the rig is exactly as bright as its colours say.
        obj.initLightAttnA(1, 0, 0);
        obj.initLightAttnK(1, 0, 0);
    };

    // Key from the front-upper-right, fill from the front-left, rim from behind.
    place(0, vec3.normalize(vec3.create(), vec3.fromValues(0.55, 0.72, 0.42)), colorNewFromRGBA(0.92, 0.90, 0.86, 1.0));
    place(1, vec3.normalize(vec3.create(), vec3.fromValues(-0.62, 0.35, 0.70)), colorNewFromRGBA(0.34, 0.38, 0.46, 1.0));
    place(2, vec3.normalize(vec3.create(), vec3.fromValues(0.10, 0.45, -0.88)), colorNewFromRGBA(0.30, 0.32, 0.38, 1.0));

    for (let i = 0; i < setting.ambLightObj.length; i++)
        setting.ambLightObj[i] = colorNewFromRGBA(0.42, 0.43, 0.46, 1.0);

    for (const lightSet of setting.lightSet) {
        lightSet.lightObjIndexes[0] = 0;
        lightSet.lightObjIndexes[1] = 1;
        lightSet.lightObjIndexes[2] = 2;
        lightSet.ambLightObjIndex = 0;
    }

    return setting;
}

interface StudioModel {
    archivePath: string;
    modelName: string;
    model: MDL0Model;
    instance: MDL0ModelInstance;
    visible: boolean;
}

interface StudioArchive {
    archivePath: string;
    rres: BRRES.RRES;
    models: StudioModel[];
}

/** One draw call's world-space geometry, rebuilt whenever the pose moves. */
interface StudioDrawCache {
    key: string;
    archivePath: string;
    modelName: string;
    instance: MDL0ModelInstance;
    shapeIndex: number;
    shapeName: string;
    drawOpIndex: number;
    nodeId: number;
    nodeName: string;
    materialName: string;
    positions: Float32Array;
    indices: Uint16Array;
    bounds: MeshBounds;
    triangleCount: number;
}

function meshKey(archivePath: string, modelName: string, drawOpIndex: number): string {
    return `${archivePath.toLowerCase()}::${modelName}::${drawOpIndex}`;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec4 = vec4.create();
const scratchMat4 = mat4.create();
const scratchAABB = new AABB();

export class StudioScene implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController(60);
    public clearRenderPassDescriptor = studioClearDescriptor;

    private renderInstListMain = new GfxRenderInstList();
    private archives: StudioArchive[] = [];
    private lightSetting = createStudioLightSetting();

    private disabledAnimations = new Set<string>();
    private transport: StudioTransportState = { playing: true, speed: 1, loop: true };
    private timeFrames = 0;

    private texturesEnabled = true;
    private vertexColorsEnabled = true;
    private lightingEnabled = true;
    private wireframe = false;
    private gridVisible = true;

    /**
     * A uniform scale put on every model so the studio's models sit in a size range the viewer's
     * fixed 5-unit near plane and the orbit camera are both comfortable with, whatever units the
     * BRRES was authored in. Recomputed whenever the loaded set changes.
     */
    private displayScale = 1;
    private sceneBounds: MeshBounds = createEmptyBounds();

    private drawCaches: StudioDrawCache[] | null = null;
    private drawCachesByKey = new Map<string, StudioDrawCache>();
    private drawCacheTimeFrames = Number.NaN;
    private highlights: Array<{ ref: StudioMeshRef; selected: boolean }> = [];
    private hiddenMeshes = new Set<string>();

    private cameraWorldPosition = vec3.create();
    private worldFromClipMatrix = mat4.create();

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public get device(): GfxDevice {
        return this.renderHelper.device;
    }

    //#region Archives

    /**
     * Parses one BRRES and adds every MDL0 in it to the scene. Re-loading a path that is already
     * present replaces it, so "open this archive again after an edit" is one call.
     */
    public loadStudioArchive(archivePath: string, brres: Uint8Array | ArrayBufferSlice): StudioArchiveInfo {
        this.unloadStudioArchive(archivePath);
        const device = this.renderHelper.device;
        const cache = this.renderHelper.renderCache;
        const buffer = toArrayBufferSlice(brres);

        const rres = BRRES.parse(buffer);
        this.textureHolder.addRRESTextures(device, rres);

        const archive: StudioArchive = { archivePath, rres, models: [] };
        for (let i = 0; i < rres.mdl0.length; i++) {
            const mdl0 = rres.mdl0[i];
            const model = new MDL0Model(device, cache, mdl0);
            const instance = new MDL0ModelInstance(this.textureHolder, model, archivePath);
            instance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
            instance.bindLightSetting(this.lightSetting);
            // Two kinds of MDL0 are in the archive but are never drawn *with* the model on the
            // console, and drawing them here is worse than useless: a kart's `shadow` is the blob
            // projected on the ground, which on its own is a translucent box around the vehicle,
            // and a `*_lod` mesh is the distant stand-in, which sits inside the real one and
            // z-fights it. Both start hidden; one click in the outliner brings either back.
            const lower = mdl0.name.toLowerCase();
            const visible = lower !== 'shadow' && !lower.endsWith('_lod');
            instance.setVisible(visible);
            archive.models.push({ archivePath, modelName: mdl0.name, model, instance, visible });
        }
        this.archives.push(archive);

        for (const animation of defaultEnabledAnimations(rres))
            this.disabledAnimations.delete(this.animationKey(archivePath, animation.kind, animation.name));
        for (const info of this.listEditorAnimations(archivePath))
            if (!defaultEnabledAnimations(rres).some((entry) => entry.kind === info.kind && entry.name === info.name))
                this.disabledAnimations.add(this.animationKey(archivePath, info.kind, info.name));

        this.applyArchiveAnimations(archive);
        this.recomputeLayout();
        return this.describeArchive(archive);
    }

    public unloadStudioArchive(archivePath: string): boolean {
        const key = archivePath.toLowerCase();
        const index = this.archives.findIndex((archive) => archive.archivePath.toLowerCase() === key);
        if (index < 0)
            return false;
        const [archive] = this.archives.splice(index, 1);
        for (const model of archive.models)
            model.model.destroy(this.renderHelper.device);
        this.recomputeLayout();
        return true;
    }

    public listStudioArchives(): StudioArchiveInfo[] {
        return this.archives.map((archive) => this.describeArchive(archive));
    }

    private describeArchive(archive: StudioArchive): StudioArchiveInfo {
        return {
            archivePath: archive.archivePath,
            models: archive.models.map((model) => ({
                archivePath: archive.archivePath,
                modelName: model.modelName,
                kind: 'course' as const,
                visible: model.visible,
                materialCount: model.model.mdl0.materials.length,
                shapeCount: model.model.mdl0.shapes.length,
                nodeCount: model.model.mdl0.nodes.length,
            })),
            textureNames: archive.rres.tex0.map((tex0) => tex0.name),
            animations: this.listEditorAnimations(archive.archivePath),
        };
    }

    public listEditorSceneModels(): StudioModelInfo[] {
        return this.archives.flatMap((archive) => this.describeArchive(archive).models);
    }

    public setEditorSceneModelVisible(archivePath: string, visible: boolean): boolean {
        const key = archivePath.toLowerCase();
        let changed = false;
        for (const archive of this.archives) {
            if (archive.archivePath.toLowerCase() !== key)
                continue;
            for (const model of archive.models) {
                model.visible = visible;
                model.instance.setVisible(visible);
                changed = true;
            }
        }
        if (changed)
            this.recomputeLayout();
        return changed;
    }

    public setStudioModelVisible(archivePath: string, modelName: string, visible: boolean): boolean {
        const model = this.findModel(archivePath, modelName);
        if (model === null)
            return false;
        model.visible = visible;
        model.instance.setVisible(visible);
        this.recomputeLayout();
        return true;
    }

    private findModel(archivePath: string, modelName: string): StudioModel | null {
        const key = archivePath.toLowerCase();
        for (const archive of this.archives) {
            if (archive.archivePath.toLowerCase() !== key)
                continue;
            for (const model of archive.models)
                if (model.modelName === modelName)
                    return model;
        }
        return null;
    }

    private findArchive(archivePath: string): StudioArchive | null {
        const key = archivePath.toLowerCase();
        return this.archives.find((archive) => archive.archivePath.toLowerCase() === key) ?? null;
    }

    //#endregion

    //#region Layout: display scale and scene bounds

    /**
     * Puts the loaded models on a common scale and remembers the bounds the camera frames and the
     * grid is sized from.
     *
     * The scale comes from the MDL0 bounding boxes, which is cheap; the *framing* bounds come
     * from the drawn triangles instead, because an MDL0's stored bbox is not always tight — a
     * kart's shadow model and a driver's LOD mesh both ship boxes far larger than the geometry
     * in them, and framing on those puts the character in the middle distance.
     */
    private recomputeLayout(): void {
        const raw = createEmptyBounds();
        for (const archive of this.archives) {
            for (const model of archive.models) {
                if (!model.visible)
                    continue;
                const bbox = model.model.mdl0.bbox;
                if (bbox === null)
                    continue;
                expandBounds(raw, bbox.min[0], bbox.min[1], bbox.min[2]);
                expandBounds(raw, bbox.max[0], bbox.max[1], bbox.max[2]);
            }
        }

        this.displayScale = isBoundsEmpty(raw)
            ? 1
            : 400 / Math.max(1e-4, Math.hypot(raw.max.x - raw.min.x, raw.max.y - raw.min.y, raw.max.z - raw.min.z) / 2);

        for (const archive of this.archives)
            for (const model of archive.models)
                mat4.fromScaling(model.instance.modelMatrix, [this.displayScale, this.displayScale, this.displayScale]);
        this.invalidateDrawCaches();

        const geometry = createEmptyBounds();
        for (const cache of this.ensureDrawCaches()) {
            if (!cache.instance.visible)
                continue;
            expandBounds(geometry, cache.bounds.min.x, cache.bounds.min.y, cache.bounds.min.z);
            expandBounds(geometry, cache.bounds.max.x, cache.bounds.max.y, cache.bounds.max.z);
        }
        this.sceneBounds = isBoundsEmpty(geometry) ? createEmptyBounds() : geometry;
    }

    /** Where the orbit camera should look and how far away it should sit. */
    public getStudioBounds(): StudioBounds | null {
        if (isBoundsEmpty(this.sceneBounds))
            return null;
        const center = {
            x: (this.sceneBounds.min.x + this.sceneBounds.max.x) / 2,
            y: (this.sceneBounds.min.y + this.sceneBounds.max.y) / 2,
            z: (this.sceneBounds.min.z + this.sceneBounds.max.z) / 2,
        };
        const radius = Math.max(
            1,
            Math.hypot(
                this.sceneBounds.max.x - this.sceneBounds.min.x,
                this.sceneBounds.max.y - this.sceneBounds.min.y,
                this.sceneBounds.max.z - this.sceneBounds.min.z,
            ) / 2,
        );
        return { center, radius };
    }

    /** Bounds of one draw call, for "frame the selected mesh". */
    public getStudioMeshBounds(target: StudioMeshRef): StudioBounds | null {
        this.ensureDrawCaches();
        const cache = this.drawCachesByKey.get(meshKey(target.archivePath, target.modelName, target.drawOpIndex));
        if (cache === undefined || isBoundsEmpty(cache.bounds))
            return null;
        return {
            center: {
                x: (cache.bounds.min.x + cache.bounds.max.x) / 2,
                y: (cache.bounds.min.y + cache.bounds.max.y) / 2,
                z: (cache.bounds.min.z + cache.bounds.max.z) / 2,
            },
            radius: Math.max(
                1,
                Math.hypot(
                    cache.bounds.max.x - cache.bounds.min.x,
                    cache.bounds.max.y - cache.bounds.min.y,
                    cache.bounds.max.z - cache.bounds.min.z,
                ) / 2,
            ),
        };
    }

    //#endregion

    //#region Animations and the transport

    private animationKey(archivePath: string, kind: string, name: string): string {
        return `${archivePath.toLowerCase()}|${kind}|${name}`;
    }

    public listEditorAnimations(archivePath: string): StudioAnimationInfo[] {
        const archive = this.findArchive(archivePath);
        if (archive === null)
            return [];
        const out: StudioAnimationInfo[] = [];
        const push = (kind: StudioAnimationKind, animations: ReadonlyArray<{ name: string; duration: number; loopMode: number }>, supported: boolean) => {
            for (const animation of animations)
                out.push({
                    kind,
                    name: animation.name,
                    duration: animation.duration,
                    loopMode: animation.loopMode,
                    enabled: supported && !this.disabledAnimations.has(this.animationKey(archivePath, kind, animation.name)),
                    supported,
                });
        };
        push('chr0', archive.rres.chr0, true);
        push('srt0', archive.rres.srt0, true);
        push('pat0', archive.rres.pat0, true);
        push('clr0', archive.rres.clr0, true);
        push('vis0', archive.rres.vis0, true);
        push('scn0', archive.rres.scn0, false);
        return out;
    }

    public setEditorAnimationEnabled(archivePath: string, kind: string, name: string, enabled: boolean): boolean {
        const archive = this.findArchive(archivePath);
        if (archive === null)
            return false;
        const key = this.animationKey(archivePath, kind, name);
        if (enabled)
            this.disabledAnimations.delete(key);
        else
            this.disabledAnimations.add(key);
        this.applyArchiveAnimations(archive);
        return true;
    }

    /**
     * A CHR0 replaces the pose and a VIS0 replaces the shape visibility, and `MDL0ModelInstance`
     * has no unbind for either, so switching animations off means rebuilding the instance from
     * the same (already uploaded) `MDL0Model` with only the still-enabled animations on it.
     */
    private applyArchiveAnimations(archive: StudioArchive): void {
        for (const model of archive.models) {
            const previous = model.instance;
            const next = new MDL0ModelInstance(this.textureHolder, model.model, archive.archivePath);
            next.setSortKeyLayer(GfxRendererLayer.OPAQUE);
            next.bindLightSetting(this.lightSetting);
            next.setVisible(previous.visible);
            mat4.copy(next.modelMatrix, previous.modelMatrix);
            this.bindAnimations(next, archive, model.modelName);
            model.instance = next;
        }
        this.applyRenderToggles();
        this.reapplyMeshVisibility();
        this.invalidateDrawCaches();
    }

    /**
     * Binds every enabled animation of the archive that applies to this model. NW4R's convention
     * is that an animation named after the model belongs to it; a character's CHR0s are named
     * after the *action* instead ("wait", "run"), so an animation whose name matches no model in
     * the archive is bound to all of them.
     */
    private bindAnimations(instance: MDL0ModelInstance, archive: StudioArchive, modelName: string): void {
        const modelNames = new Set(archive.models.map((model) => model.modelName));
        const applies = (name: string) => (modelNames.has(name) ? name === modelName : true);
        const isEnabled = (kind: string, name: string) => !this.disabledAnimations.has(this.animationKey(archive.archivePath, kind, name));

        for (const chr0 of archive.rres.chr0)
            if (applies(chr0.name) && isEnabled('chr0', chr0.name))
                instance.bindCHR0(this.animationController, chr0);
        for (const srt0 of archive.rres.srt0)
            if (applies(srt0.name) && isEnabled('srt0', srt0.name))
                instance.bindSRT0(this.animationController, srt0);
        for (const pat0 of archive.rres.pat0)
            if (applies(pat0.name) && isEnabled('pat0', pat0.name))
                instance.bindPAT0(this.animationController, pat0);
        for (const clr0 of archive.rres.clr0)
            if (applies(clr0.name) && isEnabled('clr0', clr0.name))
                instance.bindCLR0(this.animationController, clr0);
        for (const vis0 of archive.rres.vis0)
            if (applies(vis0.name) && isEnabled('vis0', vis0.name))
                instance.bindVIS0(this.animationController, vis0);
    }

    /** The longest enabled animation, which is what the transport's scrubber spans. */
    public getStudioAnimationDuration(): number {
        let duration = 0;
        for (const archive of this.archives)
            for (const animation of this.listEditorAnimations(archive.archivePath))
                if (animation.enabled && animation.supported)
                    duration = Math.max(duration, animation.duration);
        return duration;
    }

    public setStudioTransport(transport: Partial<StudioTransportState>): void {
        this.transport = { ...this.transport, ...transport };
    }

    public getStudioTransport(): StudioTransportState {
        return { ...this.transport };
    }

    public setEditorSceneTimeFrames(frames: number | null): void {
        if (frames === null)
            return;
        this.timeFrames = frames;
        this.animationController.setTimeInFrames(frames);
        this.invalidateDrawCaches();
    }

    public getEditorSceneTimeFrames(): number {
        return this.timeFrames;
    }

    public setEditorAnimationsPlaying(playing: boolean): void {
        this.transport.playing = playing;
    }

    /**
     * A number that changes when, and only when, the pose does: the sum of every visible model's
     * animated joint translations at the current frame. The browser probe uses it to prove a CHR0
     * is actually moving bones rather than inferring it from pixels, which a subtle idle
     * animation would not show.
     */
    public getStudioPoseSignature(): number {
        let signature = 0;
        for (const archive of this.archives) {
            for (const model of archive.models) {
                if (!model.visible)
                    continue;
                const matrices = this.computeJointToWorldMatrices(model.instance);
                for (let i = 0; i < matrices.length; i++)
                    signature += matrices[i][12] + matrices[i][13] * 3 + matrices[i][14] * 7;
            }
        }
        return Math.round(signature * 1000) / 1000;
    }

    //#endregion

    //#region Render toggles

    private applyRenderToggles(): void {
        for (const instance of this.instances()) {
            instance.setVertexColorsEnabled(this.vertexColorsEnabled);
            instance.setTexturesEnabled(this.texturesEnabled);
            for (const materialInstance of instance.materialInstances)
                materialInstance.setMaterialHacks({ disableLighting: !this.lightingEnabled });
        }
    }

    private instances(): MDL0ModelInstance[] {
        const out: MDL0ModelInstance[] = [];
        for (const archive of this.archives)
            for (const model of archive.models)
                out.push(model.instance);
        return out;
    }

    public setEditorVertexColorsEnabled(enabled: boolean): void {
        this.vertexColorsEnabled = enabled;
        this.applyRenderToggles();
    }

    public setEditorTexturesEnabled(enabled: boolean): void {
        this.texturesEnabled = enabled;
        this.applyRenderToggles();
    }

    public setEditorLightingEnabled(enabled: boolean): void {
        this.lightingEnabled = enabled;
        this.applyRenderToggles();
    }

    public isEditorWireframeSupported(): boolean {
        return this.renderHelper.device.queryLimits().wireframeSupported;
    }

    public setEditorWireframe(enabled: boolean): boolean {
        if (enabled && !this.isEditorWireframeSupported())
            return false;
        this.wireframe = enabled;
        return true;
    }

    public setStudioGridVisible(visible: boolean): void {
        this.gridVisible = visible;
    }

    //#endregion

    //#region Materials and textures

    public reloadEditorMaterial(archivePath: string, modelName: string, materialName: string, brres: ArrayBufferSlice | Uint8Array): boolean {
        const model = this.findModel(archivePath, modelName);
        if (model === null)
            return false;
        const buffer = toArrayBufferSlice(brres);

        let parsed: { entry: BRRES.MDL0_MaterialEntry; index: number } | null = null;
        try {
            parsed = BRRES.parseMaterialEntry(buffer, modelName, materialName);
        } catch {
            return false;
        }
        if (parsed === null)
            return false;
        if (!model.model.replaceMaterial(this.renderHelper.device, this.renderHelper.renderCache, parsed.index, parsed.entry))
            return false;
        if (model.instance.replaceMaterial(parsed.index) === 0)
            return false;

        const archive = this.findArchive(archivePath);
        if (archive !== null)
            this.bindAnimations(model.instance, archive, modelName);
        this.applyRenderToggles();
        this.reapplyMeshVisibility();
        return true;
    }

    public reloadEditorTexture(name: string, texture: { format: number; width: number; height: number; mipCount: number; data: Uint8Array }): boolean {
        const device = this.renderHelper.device;
        const holder = this.textureHolder;
        const index = holder.findTextureEntryIndex(name);
        if (index < 0)
            return false;
        const existing = holder.textureEntries[index];
        if (existing.width !== texture.width || existing.height !== texture.height || existing.format !== texture.format)
            return false;
        const gfxTexture = holder.gfxTextures[index];
        const copy = texture.data.slice();
        const input: GX_Texture.TextureInputGX = {
            name,
            format: texture.format,
            width: texture.width,
            height: texture.height,
            mipCount: texture.mipCount,
            data: new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength),
            paletteFormat: existing.paletteFormat ?? null,
            paletteData: existing.paletteData ?? null,
        };
        const mipChain = GX_Texture.calcMipChain(input, texture.mipCount);
        for (let level = 0; level < mipChain.mipLevels.length; level++) {
            void GX_Texture.decodeTexture(mipChain.mipLevels[level]).then((decoded) => {
                device.uploadTextureData(gfxTexture, level, [decoded.pixels]);
            });
        }
        holder.textureEntries[index] = input;
        return true;
    }

    public addEditorTexture(name: string, texture: { format: number; width: number; height: number; mipCount: number; data: Uint8Array; paletteFormat?: number | null; paletteData?: ArrayBufferSlice | null }): boolean {
        if (this.textureHolder.hasTexture(name))
            return this.reloadEditorTexture(name, texture);
        const copy = texture.data.slice();
        this.textureHolder.addTexture(this.renderHelper.device, {
            name,
            format: texture.format,
            width: texture.width,
            height: texture.height,
            mipCount: texture.mipCount,
            data: new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength),
            paletteFormat: texture.paletteFormat ?? null,
            paletteData: texture.paletteData ?? null,
        });
        return this.textureHolder.hasTexture(name);
    }

    public listEditorTextureNames(): string[] {
        return this.textureHolder.textureNames;
    }

    //#endregion

    //#region Mesh picking, listing, visibility and highlight

    private invalidateDrawCaches(): void {
        this.drawCaches = null;
        this.drawCachesByKey.clear();
        this.drawCacheTimeFrames = Number.NaN;
    }

    /**
     * World-space triangles for every draw call, taken from the *live* joint matrices so picking
     * follows the animated pose. Rigid shapes take their one node matrix; a skinned shape reads
     * the matrix slot packed in the w of each position and looks it up through the draw's
     * position-matrix table, which is exactly what the vertex shader does.
     *
     * Rebuilt when the clock has moved since it was built, so a paused model costs nothing.
     */
    private ensureDrawCaches(): StudioDrawCache[] {
        const now = this.animationController.getTimeInFrames();
        if (this.drawCaches !== null && Math.abs(now - this.drawCacheTimeFrames) < 1e-4)
            return this.drawCaches;

        const caches: StudioDrawCache[] = [];
        for (const archive of this.archives) {
            for (const model of archive.models) {
                const instance = model.instance;
                const mdl0 = instance.mdl0Model.mdl0;
                const jointToWorld = this.computeJointToWorldMatrices(instance);
                const drawOps = [...mdl0.sceneGraph.drawOpaOps, ...mdl0.sceneGraph.drawXluOps];
                for (let drawOpIndex = 0; drawOpIndex < drawOps.length; drawOpIndex++) {
                    const op = drawOps[drawOpIndex];
                    const shape = mdl0.shapes[op.shpId];
                    if (shape === undefined)
                        continue;
                    const geometry = readShapeWorldGeometry(shape, jointToWorld);
                    if (geometry === null)
                        continue;
                    const node = mdl0.nodes[op.nodeId];
                    caches.push({
                        key: meshKey(archive.archivePath, mdl0.name, drawOpIndex),
                        archivePath: archive.archivePath,
                        modelName: mdl0.name,
                        instance,
                        shapeIndex: op.shpId,
                        shapeName: shape.name,
                        drawOpIndex,
                        nodeId: op.nodeId,
                        nodeName: node?.name ?? `node${op.nodeId}`,
                        materialName: mdl0.materials[op.matId]?.name ?? '',
                        positions: geometry.positions,
                        indices: geometry.indices,
                        bounds: geometry.bounds,
                        triangleCount: Math.floor(geometry.indices.length / 3),
                    });
                }
            }
        }

        this.drawCaches = caches;
        this.drawCacheTimeFrames = now;
        this.drawCachesByKey.clear();
        for (const cache of caches)
            this.drawCachesByKey.set(cache.key, cache);
        return caches;
    }

    /**
     * The animated joint matrices: the same walk `MDL0ModelInstance` does per frame, but without
     * a camera — CHR0 first, the node's own matrix otherwise.
     */
    private computeJointToWorldMatrices(instance: MDL0ModelInstance): mat4[] {
        const mdl0 = instance.mdl0Model.mdl0;
        const count = Math.max(mdl0.numViewMtx, mdl0.mtxIdToNodeId.length, mdl0.nodes.length) + 1;
        const matrices: mat4[] = [];
        for (let i = 0; i < count; i++)
            matrices.push(mat4.create());
        mat4.copy(matrices[0], instance.modelMatrix);
        const animator = instance.getCHR0Animator();
        for (const op of mdl0.sceneGraph.nodeTreeOps) {
            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = mdl0.nodes[op.nodeId];
                if (node === undefined)
                    continue;
                const parent = matrices[op.parentMtxId] ?? matrices[0];
                if (matrices[node.mtxId] === undefined)
                    continue;
                const local = animator !== null && animator.calcModelMtx(scratchMat4, op.nodeId) ? scratchMat4 : node.modelMatrix;
                mat4.mul(matrices[node.mtxId], parent, local);
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const from = matrices[op.fromMtxId];
                const to = matrices[op.toMtxId];
                if (from !== undefined && to !== undefined)
                    mat4.copy(to, from);
            }
        }
        return matrices;
    }

    public listEditorMeshes(): StudioMeshEntry[] {
        return this.ensureDrawCaches().map((cache) => ({
            archivePath: cache.archivePath,
            modelName: cache.modelName,
            shapeIndex: cache.shapeIndex,
            drawOpIndex: cache.drawOpIndex,
            componentIndex: null,
            nodeId: cache.nodeId,
            granularity: 'shape' as const,
            shapeName: cache.shapeName,
            materialName: cache.materialName,
            nodeName: cache.nodeName,
            triangleCount: cache.triangleCount,
        }));
    }

    /** World-space pick ray for normalized (0..1, y down) viewport coordinates. */
    private buildPickRay(normalizedX: number, normalizedY: number): { origin: vec3; direction: vec3 } | null {
        if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY))
            return null;
        const ndcX = normalizedX * 2 - 1;
        const ndcY = 1 - normalizedY * 2;
        const origin = vec3.clone(this.cameraWorldPosition);
        let bestDistance = -1;
        let found = false;
        for (const ndcZ of pickRayDepthSamples) {
            vec4.set(scratchVec4, ndcX, ndcY, ndcZ, 1);
            vec4.transformMat4(scratchVec4, scratchVec4, this.worldFromClipMatrix);
            const w = scratchVec4[3];
            if (!Number.isFinite(w) || Math.abs(w) < 1e-9)
                continue;
            vec3.set(scratchVec3a, scratchVec4[0] / w, scratchVec4[1] / w, scratchVec4[2] / w);
            const distance = vec3.squaredDistance(origin, scratchVec3a);
            if (!Number.isFinite(distance) || distance <= bestDistance)
                continue;
            bestDistance = distance;
            vec3.copy(scratchVec3b, scratchVec3a);
            found = true;
        }
        if (!found)
            return null;
        const direction = vec3.sub(vec3.create(), scratchVec3b, origin);
        if (vec3.squaredLength(direction) < 1e-12)
            return null;
        vec3.normalize(direction, direction);
        return { origin, direction };
    }

    public getEditorPickRay(normalizedX: number, normalizedY: number): { origin: number[]; direction: number[] } | null {
        const ray = this.buildPickRay(normalizedX, normalizedY);
        return ray === null ? null : { origin: [...ray.origin], direction: [...ray.direction] };
    }

    public pickEditorMesh(normalizedX: number, normalizedY: number): StudioMeshPick | null {
        const ray = this.buildPickRay(normalizedX, normalizedY);
        if (ray === null)
            return null;
        const caches = this.ensureDrawCaches();
        let best: StudioDrawCache | null = null;
        let bestT = Number.POSITIVE_INFINITY;
        for (const cache of caches) {
            if (!cache.instance.visible || this.hiddenMeshes.has(cache.key))
                continue;
            const boxHit = rayAabbIntersection(ray.origin[0], ray.origin[1], ray.origin[2], ray.direction[0], ray.direction[1], ray.direction[2], cache.bounds);
            if (boxHit === null || boxHit > bestT)
                continue;
            const positions = cache.positions;
            const indices = cache.indices;
            for (let i = 0; i + 2 < indices.length; i += 3) {
                const a = indices[i] * 3;
                const b = indices[i + 1] * 3;
                const c = indices[i + 2] * 3;
                const t = rayTriangleIntersection(
                    ray.origin[0], ray.origin[1], ray.origin[2],
                    ray.direction[0], ray.direction[1], ray.direction[2],
                    positions[a], positions[a + 1], positions[a + 2],
                    positions[b], positions[b + 1], positions[b + 2],
                    positions[c], positions[c + 1], positions[c + 2],
                );
                if (t === null || t >= bestT)
                    continue;
                bestT = t;
                best = cache;
            }
        }
        if (best === null)
            return null;
        return {
            archivePath: best.archivePath,
            modelName: best.modelName,
            shapeIndex: best.shapeIndex,
            drawOpIndex: best.drawOpIndex,
            componentIndex: null,
            nodeId: best.nodeId,
            granularity: 'shape',
            shapeName: best.shapeName,
            materialName: best.materialName,
            nodeName: best.nodeName,
            triangleCount: best.triangleCount,
            hitPoint: {
                x: ray.origin[0] + ray.direction[0] * bestT,
                y: ray.origin[1] + ray.direction[1] * bestT,
                z: ray.origin[2] + ray.direction[2] * bestT,
            },
            distance: bestT,
        };
    }

    public setEditorMeshVisible(target: StudioMeshRef, visible: boolean): boolean {
        const key = meshKey(target.archivePath, target.modelName, target.drawOpIndex);
        if (visible)
            this.hiddenMeshes.delete(key);
        else
            this.hiddenMeshes.add(key);
        return this.applyMeshVisibility(target.archivePath, target.modelName, target.drawOpIndex, visible);
    }

    private applyMeshVisibility(archivePath: string, modelName: string, drawOpIndex: number, visible: boolean): boolean {
        const model = this.findModel(archivePath, modelName);
        if (model === null)
            return false;
        const shapeInstance = model.instance.shapeInstances[drawOpIndex];
        if (shapeInstance === undefined)
            return false;
        const override = shapeInstance.editorOverride ?? { hidden: false, extraWorldMatrix: null, componentDraws: null, copyDraws: null };
        override.hidden = !visible;
        shapeInstance.editorOverride = override;
        return true;
    }

    private reapplyMeshVisibility(): void {
        if (this.hiddenMeshes.size === 0)
            return;
        for (const archive of this.archives) {
            for (const model of archive.models) {
                const total = model.instance.shapeInstances.length;
                for (let drawOpIndex = 0; drawOpIndex < total; drawOpIndex++)
                    if (this.hiddenMeshes.has(meshKey(archive.archivePath, model.modelName, drawOpIndex)))
                        this.applyMeshVisibility(archive.archivePath, model.modelName, drawOpIndex, false);
            }
        }
    }

    public setEditorMeshHighlight(targets: Array<{ target: StudioMeshRef; selected: boolean }>): void {
        this.highlights = targets.map((entry) => ({ ref: entry.target, selected: entry.selected }));
    }

    //#endregion

    //#region Render

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.transport.playing) {
            const duration = this.getStudioAnimationDuration();
            this.timeFrames += viewerInput.deltaTime * (60 / 1000) * this.transport.speed;
            if (this.transport.loop && duration > 0)
                this.timeFrames = ((this.timeFrames % duration) + duration) % duration;
            else if (duration > 0 && this.timeFrames > duration)
                this.timeFrames = duration;
        }
        this.animationController.setTimeInFrames(this.timeFrames);

        mat4.invert(this.worldFromClipMatrix, viewerInput.camera.clipFromWorldMatrix);
        vec3.set(this.cameraWorldPosition, viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]);

        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        if (this.wireframe)
            template.setMegaStateFlags({ wireframe: true });
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        for (const instance of this.instances())
            instance.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.drawGrid();
        this.drawHighlights();
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplate();
    }

    private drawGrid(): void {
        if (!this.gridVisible)
            return;
        const bounds = this.getStudioBounds();
        const radius = bounds === null ? 400 : bounds.radius;
        const centerX = bounds === null ? 0 : bounds.center.x;
        const centerZ = bounds === null ? 0 : bounds.center.z;
        const y = isBoundsEmpty(this.sceneBounds) ? 0 : this.sceneBounds.min.y;

        // A round-ish spacing that keeps the grid to about 20 cells across whatever the model is.
        const rawStep = (radius * 2) / 20;
        const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-6))));
        const normalized = rawStep / magnitude;
        const step = magnitude * (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1);
        const half = Math.min(60, Math.ceil((radius * 1.6) / step));

        const debugDraw = this.renderHelper.debugDraw;
        for (let i = -half; i <= half; i++) {
            const offset = i * step;
            const extent = half * step;
            const isAxis = i === 0;
            const isMajor = i % 5 === 0;

            vec3.set(scratchVec3a, centerX + offset, y, centerZ - extent);
            vec3.set(scratchVec3b, centerX + offset, y, centerZ + extent);
            debugDraw.drawLine(scratchVec3a, scratchVec3b, isAxis ? gridAxisZColor : isMajor ? gridMajorColor : gridMinorColor, undefined, gridLineOptions);

            vec3.set(scratchVec3a, centerX - extent, y, centerZ + offset);
            vec3.set(scratchVec3b, centerX + extent, y, centerZ + offset);
            debugDraw.drawLine(scratchVec3a, scratchVec3b, isAxis ? gridAxisXColor : isMajor ? gridMajorColor : gridMinorColor, undefined, gridLineOptions);
        }
    }

    /**
     * The hover / selection marker: the draw call's world-space bounding box, in the animated
     * pose. It is a box rather than the mesh's wireframe on purpose — a Mario Kart Wii character
     * is one draw call for the whole body, and drawing every edge of it hides the thing the user
     * just selected behind a mesh of orange lines.
     */
    private drawHighlights(): void {
        if (this.highlights.length === 0)
            return;
        const debugDraw = this.renderHelper.debugDraw;
        this.ensureDrawCaches();
        for (const highlight of this.highlights) {
            const cache = this.drawCachesByKey.get(meshKey(highlight.ref.archivePath, highlight.ref.modelName, highlight.ref.drawOpIndex));
            if (cache === undefined || isBoundsEmpty(cache.bounds))
                continue;
            scratchAABB.set(cache.bounds.min.x, cache.bounds.min.y, cache.bounds.min.z, cache.bounds.max.x, cache.bounds.max.y, cache.bounds.max.z);
            mat4.identity(scratchMat4);
            debugDraw.drawBoxLine(scratchAABB, scratchMat4, highlight.selected ? meshSelectedColor : meshHoverColor, gridLineOptions);
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        this.renderHelper.pushTemplateRenderInst();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Studio Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Studio Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Studio Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        renderInstManager.popTemplate();

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        for (const archive of this.archives)
            for (const model of archive.models)
                model.model.destroy(device);
        this.archives = [];
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();
    }

    //#endregion
}

function toArrayBufferSlice(bytes: Uint8Array | ArrayBufferSlice): ArrayBufferSlice {
    if (bytes instanceof ArrayBufferSlice)
        return bytes;
    const copy = bytes.slice();
    return new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength);
}

/**
 * Animations enabled the moment an archive is opened: the ones NW4R's naming convention says
 * belong to a model in it, plus a character's idle CHR0 when nothing matched, so a driver stands
 * in its wait pose rather than in the bind pose.
 */
function defaultEnabledAnimations(rres: BRRES.RRES): Array<{ kind: StudioAnimationKind; name: string }> {
    const modelNames = new Set(rres.mdl0.map((mdl0) => mdl0.name));
    const out: Array<{ kind: StudioAnimationKind; name: string }> = [];
    const consider = (kind: StudioAnimationKind, animations: ReadonlyArray<{ name: string }>) => {
        for (const animation of animations)
            if (modelNames.has(animation.name))
                out.push({ kind, name: animation.name });
    };
    consider('srt0', rres.srt0);
    consider('pat0', rres.pat0);
    consider('clr0', rres.clr0);
    consider('vis0', rres.vis0);
    consider('chr0', rres.chr0);
    if (!out.some((entry) => entry.kind === 'chr0')) {
        const idle = rres.chr0.find((chr0) => chr0.name === 'wait') ?? rres.chr0.find((chr0) => chr0.name === 'body') ?? rres.chr0[0];
        if (idle !== undefined)
            out.push({ kind: 'chr0', name: idle.name });
    }
    return out;
}

/**
 * World-space positions and triangle indices for one shape. A rigid shape has a single node
 * matrix; a skinned shape stores the position-matrix slot in the w of each vertex position, and
 * each `LoadedVertexDraw` carries the table that turns that slot into a joint index — the same
 * lookup the vertex shader does through `u_PosMtx`.
 */
function readShapeWorldGeometry(shape: BRRES.MDL0_ShapeEntry, jointToWorld: mat4[]): { positions: Float32Array; indices: Uint16Array; bounds: MeshBounds } | null {
    const loaded = shape.loadedVertexData;
    const layout = shape.loadedVertexLayout;
    const stride = layout.vertexBufferStrides[0];
    const posOffset = layout.vertexAttributeOffsets[GX.Attr.POS];
    if (stride === undefined || posOffset === undefined)
        return null;
    const vertexBuffer = loaded.vertexBuffers[0];
    if (vertexBuffer === undefined)
        return null;

    const vertexCount = loaded.totalVertexCount;
    const view = new DataView(vertexBuffer);
    const positions = new Float32Array(vertexCount * 3);
    const bounds = createEmptyBounds();
    const skinned = shape.mtxIdx < 0;
    const pnMtxOffset = layout.vertexAttributeOffsets[GX.Attr.PNMTXIDX];
    const indices = new Uint16Array(loaded.indexData, 0, loaded.totalIndexCount);

    // Which joint matrix each vertex uses. A rigid shape: the same one for all of them.
    let vertexMatrix: Int32Array | null = null;
    if (skinned) {
        if (pnMtxOffset === undefined)
            return null;
        vertexMatrix = new Int32Array(vertexCount).fill(-1);
        for (const draw of loaded.draws) {
            for (let i = 0; i < draw.indexCount; i++) {
                const vertexIndex = indices[draw.indexOffset + i];
                if (vertexIndex === undefined || vertexIndex >= vertexCount)
                    continue;
                const base = vertexIndex * stride + pnMtxOffset;
                if (base + 4 > view.byteLength)
                    continue;
                const slot = Math.round(view.getFloat32(base, true));
                const matrixIndex = draw.posMatrixTable[slot];
                if (matrixIndex === undefined || matrixIndex === 0xFFFF)
                    continue;
                vertexMatrix[vertexIndex] = matrixIndex;
            }
        }
    }

    const rigidMatrix = skinned ? null : jointToWorld[shape.mtxIdx];
    if (!skinned && rigidMatrix === undefined)
        return null;

    for (let i = 0; i < vertexCount; i++) {
        const base = i * stride + posOffset;
        if (base + 12 > view.byteLength)
            break;
        vec3.set(scratchVec3a, view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true));
        const matrix = skinned ? jointToWorld[vertexMatrix![i]] : rigidMatrix!;
        if (matrix === undefined)
            continue;
        vec3.transformMat4(scratchVec3a, scratchVec3a, matrix);
        positions[i * 3 + 0] = scratchVec3a[0];
        positions[i * 3 + 1] = scratchVec3a[1];
        positions[i * 3 + 2] = scratchVec3a[2];
        expandBounds(bounds, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    }

    if (indices.length < 3 || isBoundsEmpty(bounds))
        return null;
    return { positions, indices, bounds };
}
