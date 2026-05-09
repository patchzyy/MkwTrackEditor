
// Mario Kart Wii

import * as Viewer from '../viewer.js';
import * as UI from '../ui.js';
import * as BRRES from '../rres/brres.js';
import * as U8 from '../rres/u8.js';
import * as Yaz0 from '../Common/Compression/Yaz0.js';

import { assert, readString, hexzero, assertExists } from '../util.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from '../rres/render.js';
import AnimationController from '../AnimationController.js';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from '../gx/gx_render.js';
import { GfxDevice, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform.js';
import { computeModelMatrixSRT, computeModelMatrixS, MathConstants, scaleMatrix } from '../MathHelpers.js';
import { SceneContext, GraphObjBase } from '../SceneBase.js';
import { EggLightManager, parseBLIGHT } from '../rres/Egg.js';
import { GfxRendererLayer, GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { CameraController } from '../Camera.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { EggDrawPathBloom, EggDrawPathDOF, parseBBLM, parseBDOF } from './PostEffect.js';
import { BTI, BTIData } from '../Common/JSYSTEM/JUTTexture.js';
import { GXMaterialHacks } from '../gx/gx_material.js';
import { Cyan, Green, Magenta, Red, White, Yellow, colorNewFromRGBA, type Color } from '../Color.js';
import { DebugDrawFlags } from '../gfx/helpers/DebugDraw.js';
import { AABB } from '../Geometry.js';

interface ObjFlowObj {
    name: string;
    resources: string;
}

interface EditorOverlayPoint {
    id: string;
    section: string;
    position: { x: number; y: number; z: number; };
    markerText?: string;
    specialColor?: 'bulletBillCantStop';
    selected: boolean;
    hovered: boolean;
    invalid: boolean;
}

interface EditorOverlayLine {
    id: string;
    section: string;
    a: { x: number; y: number; z: number; };
    b: { x: number; y: number; z: number; };
}

interface EditorOverlayAxis {
    ownerId: string;
    axis: 'x' | 'y' | 'z';
    a: { x: number; y: number; z: number; };
    b: { x: number; y: number; z: number; };
    hovered: boolean;
    active: boolean;
}

interface EditorOverlayPlane {
    ownerId: string;
    plane: 'xy' | 'xz' | 'yz';
    a: { x: number; y: number; z: number; };
    b: { x: number; y: number; z: number; };
    c: { x: number; y: number; z: number; };
    d: { x: number; y: number; z: number; };
    hovered: boolean;
    active: boolean;
}

interface EditorOverlayCenterHandle {
    ownerId: string;
    position: { x: number; y: number; z: number; };
    hovered: boolean;
    active: boolean;
}

interface EditorOverlayCheckpointEndpoint {
    id: string;
    side: 'left' | 'right';
    position: { x: number; y: number; z: number; };
}

interface EditorOverlayCollisionTriangle {
    a: { x: number; y: number; z: number; };
    b: { x: number; y: number; z: number; };
    c: { x: number; y: number; z: number; };
    typeIndex: number;
}

interface EditorOverlayCheckpointWall {
    id: string;
    left: { x: number; y: number; z: number; };
    right: { x: number; y: number; z: number; };
    topY: number;
    selected: boolean;
    invalid: boolean;
}

interface EditorOverlayAreaVolume {
    id: string;
    shape: number;
    position: { x: number; y: number; z: number; };
    rotation: { x: number; y: number; z: number; };
    scale: { x: number; y: number; z: number; };
    selected: boolean;
    hovered: boolean;
    invalid: boolean;
}

interface EditorOverlayStartSlot {
    ownerId: string;
    slotIndex: number;
    position: { x: number; y: number; z: number; };
    rotation: { x: number; y: number; z: number; };
    selected: boolean;
    hovered: boolean;
}

interface EditorOverlayFillBetweenPreview {
    position: { x: number; y: number; z: number; };
    index: number;
}

interface EditorOverlayRouteDeviationSegment {
    id: string;
    section: 'ENPT' | 'ITPT';
    aLeft: { x: number; y: number; z: number; };
    aRight: { x: number; y: number; z: number; };
    bLeft: { x: number; y: number; z: number; };
    bRight: { x: number; y: number; z: number; };
    selected: boolean;
    hovered: boolean;
}

interface EditorOverlayRouteDeviationCap {
    id: string;
    section: 'ENPT' | 'ITPT';
    position: { x: number; y: number; z: number; };
    radius: number;
    selected: boolean;
    hovered: boolean;
}

interface EditorOverlayData {
    tool: 'translate' | 'rotate' | 'scale';
    points: EditorOverlayPoint[];
    lines: EditorOverlayLine[];
    centerHandle: EditorOverlayCenterHandle | null;
    axes: EditorOverlayAxis[];
    planes: EditorOverlayPlane[];
    checkpointEndpoints: EditorOverlayCheckpointEndpoint[];
    collisionTriangles: EditorOverlayCollisionTriangle[];
    checkpointWalls: EditorOverlayCheckpointWall[];
    areaVolumes: EditorOverlayAreaVolume[];
    startSlots: EditorOverlayStartSlot[];
    fillBetweenPreview: EditorOverlayFillBetweenPreview[];
    routeDeviationSegments: EditorOverlayRouteDeviationSegment[];
    routeDeviationCaps: EditorOverlayRouteDeviationCap[];
}

type EditorViewMode = 'normal' | 'dev' | 'topdown' | 'ortho';
type EditorDOFMode = 'full' | 'reduced' | 'off';

type EditorOverlayPick =
    | { kind: 'point'; id: string; }
    | { kind: 'center'; id: string; }
    | { kind: 'plane'; id: string; plane: 'xy' | 'xz' | 'yz'; }
    | { kind: 'axis'; id: string; axis: 'x' | 'y' | 'z'; }
    | { kind: 'checkpointEndpoint'; id: string; side: 'left' | 'right'; };

const fallbackMaterialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

const emptyEditorOverlayData: EditorOverlayData = { tool: 'translate', points: [], lines: [], centerHandle: null, axes: [], planes: [], checkpointEndpoints: [], collisionTriangles: [], checkpointWalls: [], areaVolumes: [], startSlots: [], fillBetweenPreview: [], routeDeviationSegments: [], routeDeviationCaps: [] };
const editorOverlayLineOptions = { flags: DebugDrawFlags.DepthTint };
const editorOverlayPointOptions = { flags: DebugDrawFlags.DepthTint };
const editorOverlayFillBetweenPreviewColor = colorNewFromRGBA(1.0, 0.9, 0.3, 0.88);
const editorOverlayFillBetweenPreviewLineColor = colorNewFromRGBA(1.0, 0.9, 0.3, 0.5);
const editorOverlayAxisOptions = { flags: DebugDrawFlags.DepthTint };
const editorOverlayCollisionOptions = { flags: DebugDrawFlags.DepthTint };
const editorOverlayAreaUnitBox = new AABB(-1, -1, -1, 1, 1, 1);
const editorOverlayPlaneColors = {
    xy: colorNewFromRGBA(1.0, 0.85, 0.2, 0.18),
    xz: colorNewFromRGBA(0.95, 0.35, 0.9, 0.18),
    yz: colorNewFromRGBA(0.35, 0.95, 1.0, 0.18),
};
const rotateAxisRight = {
    x: vec3.fromValues(0, 1, 0),
    y: vec3.fromValues(1, 0, 0),
    z: vec3.fromValues(1, 0, 0),
};
const editorOverlayFlatDiscRight = vec3.fromValues(1, 0, 0);
const editorOverlayFlatDiscUp = vec3.fromValues(0, 0, 1);
const rotateAxisUp = {
    x: vec3.fromValues(0, 0, 1),
    y: vec3.fromValues(0, 0, 1),
    z: vec3.fromValues(0, 1, 0),
};
const editorOverlayPointColors = new Map<string, Color>([
    ['GOBJ', colorNewFromRGBA(0.98, 0.46, 0.32, 0.95)],
    ['ENPT', Cyan],
    ['ITPT', colorNewFromRGBA(0.42, 0.88, 1.0, 0.95)],
    ['CKPT', Yellow],
    ['KTPT', Green],
    ['POTI', Magenta],
    ['AREA', colorNewFromRGBA(0.72, 0.66, 1.0, 0.95)],
    ['CAME', colorNewFromRGBA(1.0, 0.58, 0.88, 0.95)],
    ['JGPT', colorNewFromRGBA(0.45, 0.75, 1.0, 0.95)],
    ['CNPT', colorNewFromRGBA(1.0, 0.82, 0.34, 0.95)],
    ['MSPT', colorNewFromRGBA(1.0, 0.4, 0.58, 0.95)],
]);
const editorOverlayHoveredPointColor = colorNewFromRGBA(0.78, 0.92, 1.0, 0.98);
const editorOverlayInvalidPointColor = colorNewFromRGBA(1.0, 0.24, 0.24, 0.98);
const editorOverlayBulletBillCantStopColor = colorNewFromRGBA(1.0, 0.32, 0.32, 0.98);
const editorOverlayLineColors = new Map<string, Color>([
    ['ENPT', Cyan],
    ['ITPT', colorNewFromRGBA(0.42, 0.88, 1.0, 0.95)],
    ['CKPT', Yellow],
    ['POTI', Magenta],
]);
const editorOverlayAxisColors = new Map<'x' | 'y' | 'z', Color>([
    ['x', Red],
    ['y', Green],
    ['z', Cyan],
]);

function getCollisionOverlayColor(typeIndex: number, solid: boolean): Color {
    const alphaScale = solid ? 5.0 : 1.0;
    if ([0, 1, 2, 3, 4, 5, 9, 23].includes(typeIndex))
        return colorNewFromRGBA(0.32, 0.85, 0.47, Math.min(0.7, 0.11 * alphaScale));
    if ([6, 7, 8, 19].includes(typeIndex))
        return colorNewFromRGBA(0.89, 0.77, 0.25, Math.min(0.72, 0.16 * alphaScale));
    if ([10, 12, 13, 14, 15, 20, 25, 30, 31].includes(typeIndex))
        return colorNewFromRGBA(1.0, 0.36, 0.36, Math.min(0.68, 0.12 * alphaScale));
    if (typeIndex === 16)
        return colorNewFromRGBA(0.71, 0.55, 1.0, Math.min(0.76, 0.18 * alphaScale));
    if (typeIndex === 17)
        return colorNewFromRGBA(0.37, 0.84, 1.0, Math.min(0.76, 0.18 * alphaScale));
    if ([24, 26, 27].includes(typeIndex))
        return colorNewFromRGBA(0.96, 0.63, 0.30, Math.min(0.7, 0.14 * alphaScale));
    return colorNewFromRGBA(0.37, 0.84, 1.0, Math.min(0.55, 0.08 * alphaScale));
}

class ObjFlow {
    public objects: ObjFlowObj[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        const count = view.getUint16(0x00);
        let idx = 0x02;
        for (let i = 0; i < count; i++, idx += 0x74) {
            const objectId = view.getUint16(idx + 0x00);
            const name = readString(buffer, idx + 0x02, 0x20);
            const resources = readString(buffer, idx + 0x22, 0x40);
            this.objects[objectId] = { name, resources };
        }
    }
}

class CommonCache {
    public objFlow: ObjFlow;
    public mounts: U8.U8Archive[];
    private filesByBaseName = new Map<string, ArrayBufferSlice>();

    constructor(public commonArc: U8.U8Archive, extraArcs: U8.U8Archive[] = []) {
        this.mounts = [commonArc, ...extraArcs];
        // Parse ObjFlow.bin
        this.objFlow = new ObjFlow(assertExists(this.commonArc.findFileData(`./ObjFlow.bin`)));
        for (let i = 0; i < this.mounts.length; i++)
            this.indexArchiveBaseNames(this.mounts[i].root);
    }

    public findFileData(path: string): ArrayBufferSlice | null {
        const normalizedBaseName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
        for (let i = 0; i < this.mounts.length; i++) {
            const file = this.mounts[i].findFileData(path);
            if (file !== null)
                return file;
        }
        return this.filesByBaseName.get(normalizedBaseName) ?? null;
    }

    private indexArchiveBaseNames(dir: U8.U8Dir): void {
        for (let i = 0; i < dir.files.length; i++) {
            const baseName = dir.files[i].name.toLowerCase();
            if (!this.filesByBaseName.has(baseName))
                this.filesByBaseName.set(baseName, dir.files[i].buffer);
        }
        for (let i = 0; i < dir.subdirs.length; i++)
            this.indexArchiveBaseNames(dir.subdirs[i]);
    }

    public destroy(device: GfxDevice) {
    }
}

function getObjFlowResourceNames(obj: ObjFlowObj): string[] {
    return obj.resources
        .split(/[\s,;]+/)
        .map((resource) => resource.trim())
        .filter((resource) => resource.length > 0 && resource !== '-')
        .map((resource) => {
            const baseName = resource.split('/').pop() ?? resource;
            return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.brres`;
        });
}

class ModelCache {
    public rresCache = new Map<string, BRRES.RRES>();
    public modelCache = new Map<string, MDL0Model>();

    public ensureRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, path: string, buffer: ArrayBufferSlice | null): BRRES.RRES {
        if (!this.rresCache.has(path)) {
            if (buffer === null)
                throw new Error(`Missing BRRES resource ${path}`);
            const rres = BRRES.parse(buffer);
            renderer.textureHolder.addRRESTextures(device, rres);
            this.rresCache.set(path, rres);

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            for (let i = 0; i < rres.mdl0.length; i++) {
                const mdl0Model = new MDL0Model(device, cache, rres.mdl0[i], renderer.materialHacks);
                this.modelCache.set(rres.mdl0[i].name, mdl0Model);
            }
        }

        return this.rresCache.get(path)!;
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.modelCache.values())
            v.destroy(device);
    }
}

interface BaseObject extends GraphObjBase {
    visible: boolean;
    modelMatrix: mat4;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    bindLightSetting(lightSetting: BRRES.LightSetting): void;
}

function getModelInstances(baseObj: BaseObject): MDL0ModelInstance[] {
    if (baseObj instanceof GobjPreviewRenderer)
        return baseObj.getModelInstances();
    else if (baseObj instanceof CourseBGRenderer)
        return [baseObj.modelInstance];
    else if (baseObj instanceof EditorStartPreviewRenderer)
        return [...baseObj.kartInstances, baseObj.driverInstance];
    else if (baseObj instanceof MDL0ModelInstance)
        return [baseObj];
    else
        throw "Object's class does not have a known model instance.";
}

class MarioKartWiiRenderer {
    public renderHelper: GXRenderHelperGfx;
    private renderInstListMain = new GfxRenderInstList();
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;
    public enablePostProcessing = true;
    public wireframe = false;

    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController(60);

    public eggBloom: EggDrawPathBloom | null = null;
    public eggDOF: EggDrawPathDOF | null = null;
    public eggLightManager: EggLightManager | null = null;
    public baseObjects: BaseObject[] = [];
    public modelCache = new ModelCache();
    public materialHacks?: GXMaterialHacks;
    private editorOverlayData: EditorOverlayData = emptyEditorOverlayData;
    private editorStartPreviewObjects: EditorStartPreviewRenderer[] = [];
    private editorViewMode: EditorViewMode = 'normal';
    private editorOverlayScratchA = vec3.create();
    private editorOverlayScratchB = vec3.create();
    private editorOverlayScratchC = vec3.create();
    private editorOverlayScratchD = vec3.create();
    private editorOverlayScratchE = vec3.create();
    private editorOverlayScratchF = vec3.create();
    private editorOverlayScratchG = vec3.create();
    private editorOverlayScratchH = vec3.create();
    private editorOverlayScratchClip = vec4.create();
    private editorOverlayClipFromWorldMatrix = mat4.create();
    private editorOverlayViewportWidth = 1;
    private editorOverlayViewportHeight = 1;
    private editorOverlayScratchMatrix = mat4.create();
    private editorDOFMode: EditorDOFMode = 'off';

    constructor(context: SceneContext, public commonCache: CommonCache, public courseArc: U8.U8Archive, useFallbackLighting: boolean) {
        this.renderHelper = new GXRenderHelperGfx(context.device, context);
        this.materialHacks = useFallbackLighting ? fallbackMaterialHacks : undefined;
    }

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);
        for (let i = 0; i < this.baseObjects.length; i++) {
            mat4.mul(this.baseObjects[i].modelMatrix, negScaleMatrix, this.baseObjects[i].modelMatrix);
            const modelInstances = getModelInstances(this.baseObjects[i]);
            for (let k = 0; k < modelInstances.length; k++)
                for (let j = 0; j < modelInstances[k].materialInstances.length; j++)
                    modelInstances[k].materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(24/60);
    }

    public updateEditorGobjTransform(index: number, translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): boolean {
        let updated = false;
        for (const object of this.baseObjects) {
            if (object instanceof GobjPreviewRenderer && object.gobj.editorIndex === index) {
                object.setEditorTransform(translation, rotation, scale);
                updated = true;
            }
        }
        return updated;
    }

    public hasEditorGobjIndex(index: number): boolean {
        for (const object of this.baseObjects) {
            if (object instanceof GobjPreviewRenderer && object.gobj.editorIndex === index)
                return true;
        }
        return false;
    }

    public rebuildEditorGobjs(device: GfxDevice, kmpBuffer: ArrayBufferSlice): void {
        for (let i = this.baseObjects.length - 1; i >= 2; i--) {
            if (this.baseObjects[i] instanceof EditorStartPreviewRenderer)
                continue;
            this.baseObjects[i].destroy(device);
            this.baseObjects.splice(i, 1);
        }

        const kmp = parseKMP(kmpBuffer);
        for (let i = 0; i < kmp.gobj.length; i++) {
            try {
                MarioKartWiiSceneDesc.spawnObjectFromKMP(device, this, this.courseArc, kmp.gobj[i], kmp.poti);
            } catch (error) {
                console.warn(`Failed to rebuild editor object ${hexzero(kmp.gobj[i].objectId, 4)}`, error);
            }
        }
    }

    public setEditorOverlayData(data: EditorOverlayData): void {
        this.editorOverlayData = data;
        this.syncEditorStartPreviewObjects(this.renderHelper.device);
    }

    private syncEditorStartPreviewObjects(device: GfxDevice): void {
        if (this.editorOverlayData.startSlots.length === 0) {
            for (const object of this.editorStartPreviewObjects)
                object.visible = false;
            return;
        }

        if (this.editorStartPreviewObjects.length === 0) {
            const driverBuffer = this.commonCache.findFileData(previewDummyDriverAssetPath);
            const kartBuffer = this.commonCache.findFileData(previewDummyKartAssetPath);
            if (driverBuffer === null || kartBuffer === null)
                return;

            const driverRRES = this.modelCache.ensureRRES(device, this, previewDummyDriverAssetPath, driverBuffer);
            const kartRRES = this.modelCache.ensureRRES(device, this, previewDummyKartAssetPath, kartBuffer);
            const driverModelName = driverRRES.mdl0[0]?.name;
            const kartModelNames = kartRRES.mdl0.map((mdl0) => mdl0.name).filter((name) => name !== undefined);
            if (driverModelName === undefined || kartModelNames.length === 0)
                return;

            for (let i = 0; i < 12; i++) {
                const driverInstance = new MDL0ModelInstance(this.textureHolder, assertExists(this.modelCache.modelCache.get(driverModelName)), driverModelName);
                driverInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
                const kartInstances = kartModelNames.map((kartModelName) => {
                    const kartInstance = new MDL0ModelInstance(this.textureHolder, assertExists(this.modelCache.modelCache.get(kartModelName)), kartModelName);
                    kartInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
                    return kartInstance;
                });
                const driverChr0 = driverRRES.chr0.find((chr0) => chr0.name === 'wait') ?? driverRRES.chr0[0];
                if (driverChr0 !== undefined)
                    driverInstance.bindCHR0(this.animationController, driverChr0);
                const kartChr0 = kartRRES.chr0.find((chr0) => chr0.name === 'body') ?? kartRRES.chr0[0];
                if (kartChr0 !== undefined) {
                    for (let j = 0; j < kartInstances.length; j++)
                        kartInstances[j].bindCHR0(this.animationController, kartChr0);
                }
                const preview = new EditorStartPreviewRenderer(driverInstance, kartInstances, i);
                this.editorStartPreviewObjects.push(preview);
                this.baseObjects.push(preview);
            }
        }

        for (let i = 0; i < this.editorStartPreviewObjects.length; i++) {
            const preview = this.editorStartPreviewObjects[i];
            const slot = this.editorOverlayData.startSlots[i];
            if (slot === undefined) {
                preview.visible = false;
                continue;
            }
            preview.visible = true;
            preview.setTransform(slot.position, slot.rotation);
        }
    }

    public setEditorViewMode(mode: EditorViewMode): void {
        this.editorViewMode = mode;
    }

    public setEditorDOFMode(mode: EditorDOFMode): void {
        this.editorDOFMode = mode;
        if (this.eggDOF !== null)
            this.eggDOF.setBlurScale(mode === 'reduced' ? 0.45 : 1.0);
    }

    public pickEditorHandle(normalizedX: number, normalizedY: number): EditorOverlayPick | null {
        if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY))
            return null;

        const targetX = normalizedX * this.editorOverlayViewportWidth;
        const targetY = normalizedY * this.editorOverlayViewportHeight;
        let best: { result: EditorOverlayPick; score: number } | null = null;
        if ((this.editorOverlayData.tool === 'translate' || this.editorOverlayData.tool === 'scale') && this.editorOverlayData.centerHandle !== null) {
            const centerProjected = this.projectEditorOverlayPoint(this.editorOverlayData.centerHandle.position);
            if (centerProjected !== null) {
                const dx = centerProjected.x - targetX;
                const dy = centerProjected.y - targetY;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq <= 26 * 26)
                    best = { result: { kind: 'center', id: this.editorOverlayData.centerHandle.ownerId }, score: distanceSq + centerProjected.depth * 0.0001 };
            }
        }
        for (let i = 0; i < this.editorOverlayData.planes.length; i++) {
            const plane = this.editorOverlayData.planes[i];
            const score = this.scorePlanePick(plane, targetX, targetY);
            if (score === null)
                continue;
            if (best === null || score < best.score)
                best = { result: { kind: 'plane', id: plane.ownerId, plane: plane.plane }, score };
        }
        for (let i = 0; i < this.editorOverlayData.axes.length; i++) {
            const axis = this.editorOverlayData.axes[i];
            const score = this.editorOverlayData.tool === 'rotate'
                ? this.scoreRotateRingPick(axis, targetX, targetY)
                : this.scoreAxisPick(axis, targetX, targetY);
            if (score === null)
                continue;

            if (best === null || score < best.score)
                best = { result: { kind: 'axis', id: axis.ownerId, axis: axis.axis }, score };
        }

        for (let i = 0; i < this.editorOverlayData.checkpointEndpoints.length; i++) {
            const endpoint = this.editorOverlayData.checkpointEndpoints[i];
            const projected = this.projectEditorOverlayPoint(endpoint.position);
            if (projected === null)
                continue;

            const dx = projected.x - targetX;
            const dy = projected.y - targetY;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > 22 * 22)
                continue;

            const score = distanceSq + projected.depth * 0.0001;
            if (best === null || score < best.score)
                best = { result: { kind: 'checkpointEndpoint', id: endpoint.id, side: endpoint.side }, score };
        }

        for (let i = 0; i < this.editorOverlayData.points.length; i++) {
            const point = this.editorOverlayData.points[i];
            const projected = this.projectEditorOverlayPoint(point.position);
            if (projected === null)
                continue;

            const radius = point.selected ? 30 : 22;
            const dx = projected.x - targetX;
            const dy = projected.y - targetY;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > radius * radius)
                continue;

            const score = distanceSq + projected.depth * 0.0001;
            if (best === null || score < best.score)
                best = { result: { kind: 'point', id: point.id }, score };
        }

        return best?.result ?? null;
    }

    public pickEditorPointsInRect(normalizedX0: number, normalizedY0: number, normalizedX1: number, normalizedY1: number): string[] {
        if (!Number.isFinite(normalizedX0) || !Number.isFinite(normalizedY0) || !Number.isFinite(normalizedX1) || !Number.isFinite(normalizedY1))
            return [];

        const minX = Math.min(normalizedX0, normalizedX1) * this.editorOverlayViewportWidth;
        const maxX = Math.max(normalizedX0, normalizedX1) * this.editorOverlayViewportWidth;
        const minY = Math.min(normalizedY0, normalizedY1) * this.editorOverlayViewportHeight;
        const maxY = Math.max(normalizedY0, normalizedY1) * this.editorOverlayViewportHeight;
        const ids: string[] = [];
        for (let i = 0; i < this.editorOverlayData.points.length; i++) {
            const point = this.editorOverlayData.points[i];
            const projected = this.projectEditorOverlayPoint(point.position);
            if (projected === null)
                continue;
            if (projected.x < minX || projected.x > maxX || projected.y < minY || projected.y > maxY)
                continue;
            ids.push(point.id);
        }
        return ids;
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Courses');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enablePostProcessing = new UI.Checkbox('Enable Post-Processing', true);
        enablePostProcessing.onchanged = () => {
            const v = enablePostProcessing.checked;
            this.enablePostProcessing = v;
        };
        renderHacksPanel.contents.appendChild(enablePostProcessing.elem);
        const showDebugThumbnails = new UI.Checkbox('Show Debug Thumbnails', false);
        showDebugThumbnails.onchanged = () => {
            const v = showDebugThumbnails.checked;
            this.renderHelper.debugThumbnails.enabled = v;
        };
        renderHacksPanel.contents.appendChild(showDebugThumbnails.elem);

        if (this.renderHelper.device.queryLimits().wireframeSupported) {
            const wireframe = new UI.Checkbox('Wireframe', false);
            wireframe.onchanged = () => {
                const v = wireframe.checked;
                this.wireframe = v;
            };
            renderHacksPanel.contents.appendChild(wireframe.elem);
        }

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        mat4.copy(this.editorOverlayClipFromWorldMatrix, viewerInput.camera.clipFromWorldMatrix);
        this.editorOverlayViewportWidth = viewerInput.backbufferWidth;
        this.editorOverlayViewportHeight = viewerInput.backbufferHeight;
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        if (this.eggDOF !== null)
            this.eggDOF.updateScroll(this.animationController.getTimeInFrames() * 2.0);
        if (this.eggLightManager !== null)
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].bindLightSetting(this.eggLightManager.lightSetting);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        if (this.wireframe)
            template.setMegaStateFlags({ wireframe: true });
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        if (this.editorViewMode !== 'dev')
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.drawEditorOverlay();
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplate();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.renderHelper.pushTemplateRenderInst();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        const allowDOF = this.editorDOFMode !== 'off';
        if (this.enablePostProcessing && ((allowDOF && this.eggDOF !== null) || this.eggBloom !== null)) {
            const mainResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);

            if (allowDOF && this.eggDOF !== null)
                this.eggDOF.pushPassesDOF(builder, renderInstManager, viewerInput.camera, mainColorTargetID, mainDepthTargetID, mainResolveTextureID);
            if (this.eggBloom !== null)
                this.eggBloom.pushPassesBloom(builder, renderInstManager, mainColorTargetID, mainResolveTextureID);
        }

        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        renderInstManager.popTemplate();

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.baseObjects.length; i++)
            this.baseObjects[i].destroy(device);
    }

    private drawEditorOverlay(): void {
        const debugDraw = this.renderHelper.debugDraw;
        const solidCollision = this.editorViewMode === 'dev';
        for (let i = 0; i < this.editorOverlayData.collisionTriangles.length; i++) {
            const triangle = this.editorOverlayData.collisionTriangles[i];
            debugDraw.drawTriSolidP(
                this.toScenePosition(this.editorOverlayScratchA, triangle.a),
                this.toScenePosition(this.editorOverlayScratchB, triangle.b),
                this.toScenePosition(this.editorOverlayScratchC, triangle.c),
                getCollisionOverlayColor(triangle.typeIndex, solidCollision),
                editorOverlayCollisionOptions,
            );
        }

        for (let i = 0; i < this.editorOverlayData.lines.length; i++) {
            const line = this.editorOverlayData.lines[i];
            debugDraw.drawLine(
                this.toScenePosition(this.editorOverlayScratchA, line.a),
                this.toScenePosition(this.editorOverlayScratchB, line.b),
                editorOverlayLineColors.get(line.section) ?? White,
                undefined,
                editorOverlayLineOptions,
            );
        }

        for (let i = 0; i < this.editorOverlayData.checkpointWalls.length; i++)
            this.drawEditorCheckpointWall(this.editorOverlayData.checkpointWalls[i]);

        for (let i = 0; i < this.editorOverlayData.areaVolumes.length; i++)
            this.drawEditorAreaVolume(this.editorOverlayData.areaVolumes[i]);

        if (!this.editorStartPreviewObjects.some((object) => object.visible))
            for (let i = 0; i < this.editorOverlayData.startSlots.length; i++)
                this.drawEditorStartSlot(this.editorOverlayData.startSlots[i]);

        for (let i = 0; i < this.editorOverlayData.fillBetweenPreview.length; i++) {
            const preview = this.editorOverlayData.fillBetweenPreview[i];
            const anchor = this.toScenePosition(this.editorOverlayScratchA, preview.position);
            debugDraw.drawLocator(anchor, 18, editorOverlayFillBetweenPreviewColor, editorOverlayPointOptions);
            this.renderHelper.debugDraw.drawWorldTextRU(
                `${preview.index + 1}`,
                anchor,
                editorOverlayFillBetweenPreviewColor,
                undefined,
                undefined,
                { ...editorOverlayPointOptions, fontSize: 22, textAlign: 'center' },
            );
            if (i > 0) {
                debugDraw.drawLine(
                    this.toScenePosition(this.editorOverlayScratchB, this.editorOverlayData.fillBetweenPreview[i - 1].position),
                    anchor,
                    editorOverlayFillBetweenPreviewLineColor,
                    undefined,
                    editorOverlayLineOptions,
                );
            }
        }

        for (let i = 0; i < this.editorOverlayData.routeDeviationCaps.length; i++)
            this.drawEditorRouteDeviationCap(this.editorOverlayData.routeDeviationCaps[i]);

        for (let i = 0; i < this.editorOverlayData.routeDeviationSegments.length; i++)
            this.drawEditorRouteDeviationSegment(this.editorOverlayData.routeDeviationSegments[i]);

        if (this.editorOverlayData.centerHandle !== null) {
            const centerHandleLength = this.editorOverlayData.axes.length > 0
                ? vec3.distance(
                    this.toScenePosition(this.editorOverlayScratchA, this.editorOverlayData.axes[0].a),
                    this.toScenePosition(this.editorOverlayScratchB, this.editorOverlayData.axes[0].b),
                )
                : 0;
            this.drawEditorCenterHandle(this.editorOverlayData.centerHandle, centerHandleLength);
        }

        for (let i = 0; i < this.editorOverlayData.planes.length; i++) {
            this.drawEditorPlaneHandle(this.editorOverlayData.planes[i]);
        }

        for (let i = 0; i < this.editorOverlayData.axes.length; i++) {
            const axis = this.editorOverlayData.axes[i];
            if (this.editorOverlayData.tool === 'rotate')
                this.drawEditorRotateHandle(axis);
            else
                this.drawEditorLinearHandle(axis, this.editorOverlayData.tool);
        }

        for (let i = 0; i < this.editorOverlayData.checkpointEndpoints.length; i++) {
            const endpoint = this.editorOverlayData.checkpointEndpoints[i];
            debugDraw.drawLocator(
                this.toScenePosition(this.editorOverlayScratchA, endpoint.position),
                22,
                endpoint.side === 'left' ? White : Yellow,
                editorOverlayPointOptions,
            );
        }

        for (let i = 0; i < this.editorOverlayData.points.length; i++) {
            const point = this.editorOverlayData.points[i];
            if (point.section === 'AREA') {
                this.drawEditorAreaMarker(point);
                continue;
            }
            if (point.markerText !== undefined) {
                this.drawEditorTextMarker(point, point.markerText);
                continue;
            }
            debugDraw.drawSphereLine(
                this.toScenePosition(this.editorOverlayScratchA, point.position),
                point.selected ? 18 : point.invalid ? 15 : point.hovered ? 14 : 10,
                point.selected
                    ? White
                    : point.invalid
                        ? editorOverlayInvalidPointColor
                        : point.hovered
                            ? editorOverlayHoveredPointColor
                            : point.specialColor === 'bulletBillCantStop'
                                ? editorOverlayBulletBillCantStopColor
                                : (editorOverlayPointColors.get(point.section) ?? Red),
                16,
                editorOverlayPointOptions,
            );
        }
    }

    private drawEditorCheckpointWall(wall: EditorOverlayCheckpointWall): void {
        const leftBottom = this.toScenePosition(this.editorOverlayScratchA, wall.left);
        const rightBottom = this.toScenePosition(this.editorOverlayScratchB, wall.right);
        const leftTop = this.toScenePosition(this.editorOverlayScratchC, { x: wall.left.x, y: wall.topY, z: wall.left.z });
        const rightTop = this.toScenePosition(this.editorOverlayScratchD, { x: wall.right.x, y: wall.topY, z: wall.right.z });
        const outlineColor = wall.selected
            ? White
            : wall.invalid
                ? editorOverlayInvalidPointColor
                : colorNewFromRGBA(0.0, 0.5, 1.0, 0.85);
        const fillColor = wall.selected
            ? colorNewFromRGBA(1.0, 1.0, 1.0, 0.18)
            : wall.invalid
                ? colorNewFromRGBA(editorOverlayInvalidPointColor.r, editorOverlayInvalidPointColor.g, editorOverlayInvalidPointColor.b, 0.14)
                : colorNewFromRGBA(0.0, 0.35, 1.0, 0.12);
        const debugDraw = this.renderHelper.debugDraw;
        debugDraw.drawRectSolidP(leftTop, rightTop, leftBottom, rightBottom, fillColor, editorOverlayPointOptions);
        debugDraw.drawRectLineP(leftTop, rightTop, leftBottom, rightBottom, outlineColor, editorOverlayPointOptions);
    }

    private drawEditorRouteDeviationSegment(segment: EditorOverlayRouteDeviationSegment): void {
        const aLeft = this.toScenePosition(this.editorOverlayScratchA, segment.aLeft);
        const aRight = this.toScenePosition(this.editorOverlayScratchB, segment.aRight);
        const bLeft = this.toScenePosition(this.editorOverlayScratchC, segment.bLeft);
        const bRight = this.toScenePosition(this.editorOverlayScratchD, segment.bRight);
        const baseColor = editorOverlayLineColors.get(segment.section) ?? White;
        const outlineColor = segment.selected
            ? White
            : segment.hovered
                ? colorNewFromRGBA(1.0, 1.0, 1.0, 0.95)
                : colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, 0.78);
        const fillAlpha = segment.selected ? 0.12 : segment.hovered ? 0.1 : 0.07;
        const fillColor = colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, fillAlpha);
        const debugDraw = this.renderHelper.debugDraw;
        debugDraw.drawTriSolidP(aLeft, bLeft, bRight, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(aLeft, bRight, aRight, fillColor, editorOverlayPointOptions);
        debugDraw.drawLine(aLeft, bLeft, outlineColor, undefined, editorOverlayPointOptions);
        debugDraw.drawLine(aRight, bRight, outlineColor, undefined, editorOverlayPointOptions);
        debugDraw.drawLine(aLeft, aRight, outlineColor, undefined, editorOverlayPointOptions);
        debugDraw.drawLine(bLeft, bRight, outlineColor, undefined, editorOverlayPointOptions);
    }

    private drawEditorRouteDeviationCap(cap: EditorOverlayRouteDeviationCap): void {
        const center = this.toScenePosition(this.editorOverlayScratchA, cap.position);
        const baseColor = editorOverlayLineColors.get(cap.section) ?? White;
        const outlineColor = cap.selected
            ? White
            : cap.hovered
                ? colorNewFromRGBA(1.0, 1.0, 1.0, 0.95)
                : colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, 0.78);
        const fillAlpha = cap.selected ? 0.12 : cap.hovered ? 0.1 : 0.07;
        const fillColor = colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, fillAlpha);
        const radius = Math.max(1, cap.radius * scaleFactor);
        this.renderHelper.debugDraw.drawDiscSolidRU(center, editorOverlayFlatDiscRight, editorOverlayFlatDiscUp, radius, fillColor, 36, editorOverlayPointOptions);
        this.renderHelper.debugDraw.drawDiscLineRU(center, editorOverlayFlatDiscRight, editorOverlayFlatDiscUp, radius, outlineColor, 40, editorOverlayPointOptions);
    }

    private drawEditorTextMarker(point: EditorOverlayPoint, text: string): void {
        const color = point.selected
            ? White
            : point.invalid
                ? editorOverlayInvalidPointColor
                : point.hovered
                    ? editorOverlayHoveredPointColor
                    : (editorOverlayPointColors.get(point.section) ?? Red);
        this.renderHelper.debugDraw.drawWorldTextRU(
            text,
            this.toScenePosition(this.editorOverlayScratchA, point.position),
            color,
            undefined,
            undefined,
            { ...editorOverlayPointOptions, fontSize: point.selected ? 34 : 28, textAlign: 'center' },
        );
    }

    private drawEditorAreaMarker(point: EditorOverlayPoint): void {
        this.drawEditorTextMarker(point, 'A');
    }

    private drawEditorStartSlot(slot: EditorOverlayStartSlot): void {
        const color = slot.selected
            ? White
            : slot.hovered
                ? editorOverlayHoveredPointColor
                : (editorOverlayPointColors.get('KTPT') ?? Green);
        const anchor = this.toScenePosition(this.editorOverlayScratchA, slot.position);
        this.renderHelper.debugDraw.drawLocator(anchor, slot.selected ? 18 : 14, color, editorOverlayPointOptions);
        this.renderHelper.debugDraw.drawWorldTextRU(
            `${slot.slotIndex + 1}`,
            anchor,
            color,
            undefined,
            undefined,
            { ...editorOverlayPointOptions, fontSize: slot.selected ? 28 : 24, textAlign: 'center' },
        );
    }

    private drawEditorCenterHandle(handle: EditorOverlayCenterHandle, length: number): void {
        const anchor = this.toScenePosition(this.editorOverlayScratchA, handle.position);
        const color = handle.active
            ? White
            : handle.hovered
                ? colorNewFromRGBA(1.0, 0.96, 0.72, 0.98)
                : colorNewFromRGBA(1.0, 0.9, 0.2, 0.9);
        const metrics = this.getEditorGizmoMetrics(length, handle.active, handle.hovered);
        const radius = metrics.centerRadius;
        this.renderHelper.debugDraw.drawSphereLine(anchor, radius, color, 20, editorOverlayAxisOptions);
    }

    private drawEditorPlaneHandle(plane: EditorOverlayPlane): void {
        const debugDraw = this.renderHelper.debugDraw;
        const a = this.toScenePosition(this.editorOverlayScratchA, plane.a);
        const b = this.toScenePosition(this.editorOverlayScratchB, plane.b);
        const c = this.toScenePosition(this.editorOverlayScratchC, plane.c);
        const d = this.toScenePosition(this.editorOverlayScratchD, plane.d);
        const baseColor = editorOverlayPlaneColors[plane.plane];
        const alpha = plane.active ? 0.34 : plane.hovered ? 0.28 : baseColor.a;
        const color = colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, alpha);
        const outline = plane.active
            ? White
            : plane.hovered
                ? colorNewFromRGBA(1.0, 1.0, 1.0, 0.92)
                : colorNewFromRGBA(baseColor.r, baseColor.g, baseColor.b, 0.9);
        debugDraw.drawTriSolidP(a, b, c, color, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(a, c, d, color, editorOverlayAxisOptions);
        debugDraw.drawLine(a, b, outline, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(b, c, outline, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(c, d, outline, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(d, a, outline, undefined, editorOverlayAxisOptions);
    }

    private drawEditorLinearHandle(axis: EditorOverlayAxis, tool: 'translate' | 'scale'): void {
        const debugDraw = this.renderHelper.debugDraw;
        const color = this.getEditorGizmoColor(axis.axis, axis.hovered, axis.active);
        const center = this.toScenePosition(this.editorOverlayScratchA, axis.a);
        const endpoint = this.toScenePosition(this.editorOverlayScratchB, axis.b);
        const direction = vec3.sub(this.editorOverlayScratchC, endpoint, center);
        const length = vec3.length(direction);
        if (length < 0.001)
            return;
        vec3.scale(direction, direction, 1 / length);

        const metrics = this.getEditorGizmoMetrics(length, axis.active, axis.hovered);
        const shaftLength = tool === 'scale' ? length * 0.76 : length * 0.8;
        const shaftEnd = vec3.scaleAndAdd(this.editorOverlayScratchD, center, direction, shaftLength);
        const basis = this.getEditorGizmoBasis(direction);
        const offsets = [
            vec3.create(),
            vec3.scale(vec3.create(), basis.right, metrics.shaftThickness),
            vec3.scale(vec3.create(), basis.up, metrics.shaftThickness),
        ];
        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const start = vec3.add(vec3.create(), center, offset);
            const end = vec3.add(vec3.create(), shaftEnd, offset);
            debugDraw.drawLine(start, end, color, undefined, editorOverlayAxisOptions);
            if (i > 0) {
                const mirroredOffset = vec3.scale(vec3.create(), offset, -1);
                debugDraw.drawLine(
                    vec3.add(vec3.create(), center, mirroredOffset),
                    vec3.add(vec3.create(), shaftEnd, mirroredOffset),
                    color,
                    undefined,
                    editorOverlayAxisOptions,
                );
            }
        }

        if (tool === 'translate')
            this.drawEditorArrowHead(shaftEnd, endpoint, basis.right, basis.up, color, metrics.arrowRadius);
        else
            this.drawEditorScaleHandle(shaftEnd, endpoint, direction, color, metrics.boxRadius);

    }

    private drawEditorRotateHandle(axis: EditorOverlayAxis): void {
        const debugDraw = this.renderHelper.debugDraw;
        const color = this.getEditorGizmoColor(axis.axis, axis.hovered, axis.active);
        const center = this.toScenePosition(this.editorOverlayScratchA, axis.a);
        const endpoint = this.toScenePosition(this.editorOverlayScratchB, axis.b);
        const radius = vec3.distance(center, endpoint);
        const metrics = this.getEditorGizmoMetrics(radius, axis.active, axis.hovered);
        const ringThickness = metrics.ringThickness;
        for (let i = -1; i <= 1; i++) {
            const radiusOffset = i * ringThickness;
            if (radius + radiusOffset <= 0)
                continue;
            debugDraw.drawDiscLineRU(center, rotateAxisRight[axis.axis], rotateAxisUp[axis.axis], radius + radiusOffset, color, 64, editorOverlayAxisOptions);
        }

        const theta = -Math.PI / 4;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        const basisRight = rotateAxisRight[axis.axis];
        const basisUp = rotateAxisUp[axis.axis];
        const arrowPoint = vec3.set(
            this.editorOverlayScratchC,
            center[0] + (basisRight[0] * cosTheta + basisUp[0] * sinTheta) * radius,
            center[1] + (basisRight[1] * cosTheta + basisUp[1] * sinTheta) * radius,
            center[2] + (basisRight[2] * cosTheta + basisUp[2] * sinTheta) * radius,
        );
        const tangent = vec3.set(
            this.editorOverlayScratchD,
            -basisRight[0] * sinTheta + basisUp[0] * cosTheta,
            -basisRight[1] * sinTheta + basisUp[1] * cosTheta,
            -basisRight[2] * sinTheta + basisUp[2] * cosTheta,
        );
        vec3.normalize(tangent, tangent);
        const radial = vec3.sub(this.editorOverlayScratchE, arrowPoint, center);
        vec3.normalize(radial, radial);
        const binormal = vec3.normalize(this.editorOverlayScratchF, vec3.cross(this.editorOverlayScratchF, tangent, radial));
        debugDraw.drawLine(center, arrowPoint, colorNewFromRGBA(color.r, color.g, color.b, 0.45), undefined, editorOverlayAxisOptions);
        this.drawEditorArrowHead(
            vec3.scaleAndAdd(vec3.create(), arrowPoint, tangent, -metrics.arrowLength),
            arrowPoint,
            radial,
            binormal,
            color,
            metrics.arrowRadius,
        );
    }

    private drawEditorArrowHead(base: vec3, tip: vec3, right: ReadonlyVec3, up: ReadonlyVec3, color: Color, radius: number): void {
        const debugDraw = this.renderHelper.debugDraw;
        const p0 = vec3.scaleAndAdd(vec3.create(), base, right, radius);
        vec3.scaleAndAdd(p0, p0, up, radius);
        const p1 = vec3.scaleAndAdd(vec3.create(), base, right, -radius);
        vec3.scaleAndAdd(p1, p1, up, radius);
        const p2 = vec3.scaleAndAdd(vec3.create(), base, right, -radius);
        vec3.scaleAndAdd(p2, p2, up, -radius);
        const p3 = vec3.scaleAndAdd(vec3.create(), base, right, radius);
        vec3.scaleAndAdd(p3, p3, up, -radius);
        const fill = colorNewFromRGBA(color.r, color.g, color.b, 0.28);
        debugDraw.drawTriSolidP(tip, p0, p1, fill, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(tip, p1, p2, fill, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(tip, p2, p3, fill, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(tip, p3, p0, fill, editorOverlayAxisOptions);
        debugDraw.drawLine(tip, p0, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(tip, p1, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(tip, p2, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(tip, p3, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(p0, p1, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(p1, p2, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(p2, p3, color, undefined, editorOverlayAxisOptions);
        debugDraw.drawLine(p3, p0, color, undefined, editorOverlayAxisOptions);
    }

    private drawEditorScaleHandle(shaftEnd: vec3, endpoint: vec3, direction: vec3, color: Color, radius: number): void {
        const center = vec3.scaleAndAdd(vec3.create(), endpoint, direction, -radius);
        const fill = colorNewFromRGBA(color.r, color.g, color.b, 0.18);
        this.drawEditorSolidCube(center, radius, fill, color);
        this.renderHelper.debugDraw.drawLine(shaftEnd, center, color, undefined, editorOverlayAxisOptions);
    }

    private drawEditorSolidCube(center: vec3, radius: number, fillColor: Color, lineColor: Color): void {
        const matrix = mat4.fromTranslation(this.editorOverlayScratchMatrix, center);
        mat4.scale(matrix, matrix, [radius, radius, radius]);
        this.transformAreaPoint(this.editorOverlayScratchA, matrix, -1, 1, -1);
        this.transformAreaPoint(this.editorOverlayScratchB, matrix, 1, 1, -1);
        this.transformAreaPoint(this.editorOverlayScratchC, matrix, 1, 1, 1);
        this.transformAreaPoint(this.editorOverlayScratchD, matrix, -1, 1, 1);
        this.transformAreaPoint(this.editorOverlayScratchE, matrix, -1, -1, -1);
        this.transformAreaPoint(this.editorOverlayScratchF, matrix, 1, -1, -1);
        this.transformAreaPoint(this.editorOverlayScratchG, matrix, 1, -1, 1);
        this.transformAreaPoint(this.editorOverlayScratchH, matrix, -1, -1, 1);
        const debugDraw = this.renderHelper.debugDraw;
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchB, this.editorOverlayScratchC, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchC, this.editorOverlayScratchD, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchE, this.editorOverlayScratchH, this.editorOverlayScratchG, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchE, this.editorOverlayScratchG, this.editorOverlayScratchF, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchE, this.editorOverlayScratchF, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchF, this.editorOverlayScratchB, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchB, this.editorOverlayScratchF, this.editorOverlayScratchG, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchB, this.editorOverlayScratchG, this.editorOverlayScratchC, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchG, this.editorOverlayScratchH, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchH, this.editorOverlayScratchD, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchD, this.editorOverlayScratchH, this.editorOverlayScratchE, fillColor, editorOverlayAxisOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchD, this.editorOverlayScratchE, this.editorOverlayScratchA, fillColor, editorOverlayAxisOptions);
        debugDraw.drawBoxLine(editorOverlayAreaUnitBox, matrix, lineColor, editorOverlayAxisOptions);
    }

    private getEditorGizmoColor(axis: 'x' | 'y' | 'z', hovered: boolean, active: boolean): Color {
        const base = editorOverlayAxisColors.get(axis) ?? White;
        if (active)
            return colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
        if (hovered)
            return colorNewFromRGBA(
                Math.min(1.0, base.r + 0.28),
                Math.min(1.0, base.g + 0.28),
                Math.min(1.0, base.b + 0.28),
                1.0,
            );
        return colorNewFromRGBA(base.r, base.g, base.b, 0.95);
    }

    private getEditorGizmoMetrics(length: number, active: boolean, hovered: boolean): {
        shaftThickness: number;
        arrowRadius: number;
        arrowLength: number;
        boxRadius: number;
        ringThickness: number;
        centerRadius: number;
    } {
        const emphasis = active ? 1.18 : hovered ? 1.08 : 1.0;
        return {
            shaftThickness: Math.max(1.8, Math.min(4.8, length * 0.025 * emphasis)),
            arrowRadius: Math.max(6.0, Math.min(10.5, length * 0.07 * emphasis)),
            arrowLength: Math.max(8.0, Math.min(14.0, length * 0.11 * emphasis)),
            boxRadius: Math.max(5.5, Math.min(9.5, length * 0.062 * emphasis)),
            ringThickness: Math.max(2.0, Math.min(4.8, length * 0.028 * emphasis)),
            centerRadius: Math.max(6.5, Math.min(11.0, length * 0.05 * emphasis)),
        };
    }

    private getEditorGizmoBasis(direction: ReadonlyVec3): { right: vec3; up: vec3; } {
        const fallback = Math.abs(direction[1]) > 0.92 ? vec3.fromValues(1, 0, 0) : vec3.fromValues(0, 1, 0);
        const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), direction, fallback));
        const up = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), direction, right));
        return { right, up };
    }

    private drawEditorAreaVolume(area: EditorOverlayAreaVolume): void {
        const outlineColor = this.getEditorAreaOutlineColor(area);
        const fillColor = this.getEditorAreaFillColor(area);
        const matrix = this.buildEditorAreaVolumeMatrix(this.editorOverlayScratchMatrix, area);
        if (area.shape === 1) {
            this.drawEditorAreaCylinder(matrix, outlineColor, fillColor);
            return;
        }
        this.drawEditorAreaBox(matrix, outlineColor, fillColor);
    }

    private getEditorAreaOutlineColor(area: EditorOverlayAreaVolume): Color {
        const base = area.selected
            ? White
            : area.invalid
                ? editorOverlayInvalidPointColor
                : area.hovered
                    ? editorOverlayHoveredPointColor
                    : (editorOverlayPointColors.get('AREA') ?? Red);
        return colorNewFromRGBA(base.r, base.g, base.b, area.selected ? 0.98 : area.hovered ? 0.92 : 0.78);
    }

    private getEditorAreaFillColor(area: EditorOverlayAreaVolume): Color {
        const base = area.invalid
            ? editorOverlayInvalidPointColor
            : area.hovered
                ? editorOverlayHoveredPointColor
                : (editorOverlayPointColors.get('AREA') ?? Red);
        return colorNewFromRGBA(base.r, base.g, base.b, area.selected ? 0.18 : area.hovered ? 0.15 : 0.11);
    }

    private buildEditorAreaVolumeMatrix(dst: mat4, area: EditorOverlayAreaVolume): mat4 {
        const halfX = Math.max(Math.abs(area.scale.x), 0.0001) * editorOverlayAreaHalfExtent;
        const halfY = Math.max(Math.abs(area.scale.y), 0.0001) * editorOverlayAreaHalfExtent;
        const halfZ = Math.max(Math.abs(area.scale.z), 0.0001) * editorOverlayAreaHalfExtent;
        mat4.identity(dst);
        mat4.translate(dst, dst, [area.position.x * scaleFactor, area.position.y * scaleFactor, area.position.z * scaleFactor]);
        mat4.rotateX(dst, dst, area.rotation.x * MathConstants.DEG_TO_RAD);
        mat4.rotateY(dst, dst, area.rotation.y * MathConstants.DEG_TO_RAD);
        mat4.rotateZ(dst, dst, area.rotation.z * MathConstants.DEG_TO_RAD);
        mat4.translate(dst, dst, [0, halfY, 0]);
        mat4.scale(dst, dst, [halfX, halfY, halfZ]);
        return dst;
    }

    private drawEditorAreaBox(matrix: mat4, outlineColor: Color, fillColor: Color): void {
        this.transformAreaPoint(this.editorOverlayScratchA, matrix, -1, 1, -1);
        this.transformAreaPoint(this.editorOverlayScratchB, matrix, 1, 1, -1);
        this.transformAreaPoint(this.editorOverlayScratchC, matrix, 1, 1, 1);
        this.transformAreaPoint(this.editorOverlayScratchD, matrix, -1, 1, 1);
        this.transformAreaPoint(this.editorOverlayScratchE, matrix, -1, -1, -1);
        this.transformAreaPoint(this.editorOverlayScratchF, matrix, 1, -1, -1);
        this.transformAreaPoint(this.editorOverlayScratchG, matrix, 1, -1, 1);
        this.transformAreaPoint(this.editorOverlayScratchH, matrix, -1, -1, 1);

        const debugDraw = this.renderHelper.debugDraw;
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchB, this.editorOverlayScratchC, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchC, this.editorOverlayScratchD, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchE, this.editorOverlayScratchH, this.editorOverlayScratchG, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchE, this.editorOverlayScratchG, this.editorOverlayScratchF, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchE, this.editorOverlayScratchF, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchA, this.editorOverlayScratchF, this.editorOverlayScratchB, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchB, this.editorOverlayScratchF, this.editorOverlayScratchG, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchB, this.editorOverlayScratchG, this.editorOverlayScratchC, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchG, this.editorOverlayScratchH, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchH, this.editorOverlayScratchD, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchD, this.editorOverlayScratchH, this.editorOverlayScratchE, fillColor, editorOverlayPointOptions);
        debugDraw.drawTriSolidP(this.editorOverlayScratchD, this.editorOverlayScratchE, this.editorOverlayScratchA, fillColor, editorOverlayPointOptions);
        debugDraw.drawBoxLine(editorOverlayAreaUnitBox, matrix, outlineColor, editorOverlayPointOptions);
    }

    private drawEditorAreaCylinder(matrix: mat4, outlineColor: Color, fillColor: Color): void {
        const topCenter = this.transformAreaPoint(this.editorOverlayScratchA, matrix, 0, 1, 0);
        const bottomCenter = this.transformAreaPoint(this.editorOverlayScratchB, matrix, 0, -1, 0);
        const topRight = this.transformAreaPoint(this.editorOverlayScratchC, matrix, 1, 1, 0);
        const topForward = this.transformAreaPoint(this.editorOverlayScratchD, matrix, 0, 1, 1);
        const right = vec3.sub(this.editorOverlayScratchE, topRight, topCenter);
        const forward = vec3.sub(this.editorOverlayScratchF, topForward, topCenter);
        this.drawEditorAreaEllipseFill(topCenter, right, forward, fillColor);
        this.drawEditorAreaEllipseFill(bottomCenter, right, forward, fillColor);
        this.drawEditorAreaCylinderSides(topCenter, bottomCenter, right, forward, fillColor);
        this.drawEditorAreaEllipseLine(topCenter, right, forward, outlineColor);
        this.drawEditorAreaEllipseLine(bottomCenter, right, forward, outlineColor);
        for (let i = 0; i < 4; i++) {
            const theta = (i / 4) * MathConstants.TAU;
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchG, topCenter, right, forward, theta);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchH, bottomCenter, right, forward, theta);
            this.renderHelper.debugDraw.drawLine(this.editorOverlayScratchG, this.editorOverlayScratchH, outlineColor, undefined, editorOverlayPointOptions);
        }
    }

    private drawEditorAreaEllipseLine(center: vec3, right: vec3, forward: vec3, color: Color): void {
        const segments = 24;
        for (let i = 0; i < segments; i++) {
            const theta0 = (i / segments) * MathConstants.TAU;
            const theta1 = ((i + 1) / segments) * MathConstants.TAU;
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchG, center, right, forward, theta0);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchH, center, right, forward, theta1);
            this.renderHelper.debugDraw.drawLine(this.editorOverlayScratchG, this.editorOverlayScratchH, color, undefined, editorOverlayPointOptions);
        }
    }

    private drawEditorAreaEllipseFill(center: vec3, right: vec3, forward: vec3, color: Color): void {
        const segments = 24;
        for (let i = 0; i < segments; i++) {
            const theta0 = (i / segments) * MathConstants.TAU;
            const theta1 = ((i + 1) / segments) * MathConstants.TAU;
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchG, center, right, forward, theta0);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchH, center, right, forward, theta1);
            this.renderHelper.debugDraw.drawTriSolidP(center, this.editorOverlayScratchG, this.editorOverlayScratchH, color, editorOverlayPointOptions);
        }
    }

    private drawEditorAreaCylinderSides(topCenter: vec3, bottomCenter: vec3, right: vec3, forward: vec3, color: Color): void {
        const segments = 24;
        for (let i = 0; i < segments; i++) {
            const theta0 = (i / segments) * MathConstants.TAU;
            const theta1 = ((i + 1) / segments) * MathConstants.TAU;
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchC, topCenter, right, forward, theta0);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchD, topCenter, right, forward, theta1);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchG, bottomCenter, right, forward, theta0);
            this.setEditorAreaEllipsePoint(this.editorOverlayScratchH, bottomCenter, right, forward, theta1);
            this.renderHelper.debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchG, this.editorOverlayScratchH, color, editorOverlayPointOptions);
            this.renderHelper.debugDraw.drawTriSolidP(this.editorOverlayScratchC, this.editorOverlayScratchH, this.editorOverlayScratchD, color, editorOverlayPointOptions);
        }
    }

    private setEditorAreaEllipsePoint(dst: vec3, center: vec3, right: vec3, forward: vec3, theta: number): vec3 {
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        dst[0] = center[0] + right[0] * cosTheta + forward[0] * sinTheta;
        dst[1] = center[1] + right[1] * cosTheta + forward[1] * sinTheta;
        dst[2] = center[2] + right[2] * cosTheta + forward[2] * sinTheta;
        return dst;
    }

    private transformAreaPoint(dst: vec3, matrix: mat4, x: number, y: number, z: number): vec3 {
        vec3.set(dst, x, y, z);
        vec3.transformMat4(dst, dst, matrix);
        return dst;
    }

    private toScenePosition(dst: vec3, position: { x: number; y: number; z: number; }): vec3 {
        vec3.set(dst, position.x * scaleFactor, position.y * scaleFactor, position.z * scaleFactor);
        return dst;
    }

    private projectEditorOverlayPoint(position: { x: number; y: number; z: number; }): { x: number; y: number; depth: number } | null {
        if (this.editorOverlayViewportWidth <= 0 || this.editorOverlayViewportHeight <= 0)
            return null;

        const clip = vec4.set(
            this.editorOverlayScratchClip,
            position.x * scaleFactor,
            position.y * scaleFactor,
            position.z * scaleFactor,
            1,
        );
        vec4.transformMat4(clip, clip, this.editorOverlayClipFromWorldMatrix);
        if (clip[3] <= 0.00001)
            return null;

        const invW = 1 / clip[3];
        const ndcX = clip[0] * invW;
        const ndcY = clip[1] * invW;
        const ndcZ = clip[2] * invW;
        if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || !Number.isFinite(ndcZ))
            return null;

        return {
            x: (ndcX * 0.5 + 0.5) * this.editorOverlayViewportWidth,
            y: (0.5 - ndcY * 0.5) * this.editorOverlayViewportHeight,
            depth: clip[3],
        };
    }

    private scoreAxisPick(axis: EditorOverlayAxis, targetX: number, targetY: number): number | null {
        const a = this.projectEditorOverlayPoint(axis.a);
        const b = this.projectEditorOverlayPoint(axis.b);
        if (a === null || b === null)
            return null;

        const distanceSq = distanceSqToSegment2D(targetX, targetY, a.x, a.y, b.x, b.y);
        const tipDistanceSq = (b.x - targetX) * (b.x - targetX) + (b.y - targetY) * (b.y - targetY);
        const thresholdSq = (axis.active ? 34 : axis.hovered ? 30 : 26) ** 2;
        if (Math.min(distanceSq, tipDistanceSq) > thresholdSq)
            return null;

        return Math.min(distanceSq, tipDistanceSq * 0.8) + Math.min(a.depth, b.depth) * 0.0001;
    }

    private scorePlanePick(plane: EditorOverlayPlane, targetX: number, targetY: number): number | null {
        const a = this.projectEditorOverlayPoint(plane.a);
        const b = this.projectEditorOverlayPoint(plane.b);
        const c = this.projectEditorOverlayPoint(plane.c);
        const d = this.projectEditorOverlayPoint(plane.d);
        if (a === null || b === null || c === null || d === null)
            return null;
        if (!pointInTriangle2D(targetX, targetY, a.x, a.y, b.x, b.y, c.x, c.y) && !pointInTriangle2D(targetX, targetY, a.x, a.y, c.x, c.y, d.x, d.y))
            return null;
        return Math.min(a.depth, b.depth, c.depth, d.depth) * 0.0001;
    }

    private scoreRotateRingPick(axis: EditorOverlayAxis, targetX: number, targetY: number): number | null {
        const center = this.toScenePosition(this.editorOverlayScratchA, axis.a);
        const radius = vec3.distance(center, this.toScenePosition(this.editorOverlayScratchB, axis.b));
        let best: number | null = null;
        const basisRight = rotateAxisRight[axis.axis];
        const basisUp = rotateAxisUp[axis.axis];
        const samples = 48;
        for (let i = 0; i < samples; i++) {
            const theta0 = (i / samples) * MathConstants.TAU;
            const theta1 = ((i + 1) / samples) * MathConstants.TAU;
            const p0 = vec3.set(
                this.editorOverlayScratchB,
                center[0] + (basisRight[0] * Math.cos(theta0) + basisUp[0] * Math.sin(theta0)) * radius,
                center[1] + (basisRight[1] * Math.cos(theta0) + basisUp[1] * Math.sin(theta0)) * radius,
                center[2] + (basisRight[2] * Math.cos(theta0) + basisUp[2] * Math.sin(theta0)) * radius,
            );
            const p1 = vec3.set(
                this.editorOverlayScratchC,
                center[0] + (basisRight[0] * Math.cos(theta1) + basisUp[0] * Math.sin(theta1)) * radius,
                center[1] + (basisRight[1] * Math.cos(theta1) + basisUp[1] * Math.sin(theta1)) * radius,
                center[2] + (basisRight[2] * Math.cos(theta1) + basisUp[2] * Math.sin(theta1)) * radius,
            );
            const projected0 = this.projectScenePoint(p0);
            const projected1 = this.projectScenePoint(p1);
            if (projected0 === null || projected1 === null)
                continue;

            const distanceSq = distanceSqToSegment2D(targetX, targetY, projected0.x, projected0.y, projected1.x, projected1.y);
            const thresholdSq = (axis.active ? 30 : axis.hovered ? 26 : 22) ** 2;
            if (distanceSq > thresholdSq)
                continue;

            const score = distanceSq + Math.min(projected0.depth, projected1.depth) * 0.0001;
            if (best === null || score < best)
                best = score;
        }

        return best;
    }

    private projectScenePoint(position: vec3): { x: number; y: number; depth: number } | null {
        if (this.editorOverlayViewportWidth <= 0 || this.editorOverlayViewportHeight <= 0)
            return null;

        const clip = vec4.set(this.editorOverlayScratchClip, position[0], position[1], position[2], 1);
        vec4.transformMat4(clip, clip, this.editorOverlayClipFromWorldMatrix);
        if (clip[3] <= 0.00001)
            return null;

        const invW = 1 / clip[3];
        const ndcX = clip[0] * invW;
        const ndcY = clip[1] * invW;
        const ndcZ = clip[2] * invW;
        if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || !Number.isFinite(ndcZ))
            return null;

        return {
            x: (ndcX * 0.5 + 0.5) * this.editorOverlayViewportWidth,
            y: (0.5 - ndcY * 0.5) * this.editorOverlayViewportHeight,
            depth: clip[3],
        };
    }
}

function distanceSqToSegment2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    if (lengthSq <= 0.000001) {
        const dx = px - ax;
        const dy = py - ay;
        return dx * dx + dy * dy;
    }

    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    return dx * dx + dy * dy;
}

function pointInTriangle2D(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    const ab = signedArea2D(px, py, ax, ay, bx, by);
    const bc = signedArea2D(px, py, bx, by, cx, cy);
    const ca = signedArea2D(px, py, cx, cy, ax, ay);
    const hasNeg = ab < 0 || bc < 0 || ca < 0;
    const hasPos = ab > 0 || bc > 0 || ca > 0;
    return !(hasNeg && hasPos);
}

function signedArea2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

interface GOBJ {
    editorIndex: number;
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    objectArg4: number;
    objectArg5: number;
    objectArg6: number;
    objectArg7: number;
    presenceFlags: number;
    translationX: number;
    translationY: number;
    translationZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

interface POTIPoint {
    x: number;
    y: number;
    z: number;
    setting1: number;
    setting2: number;
}

interface POTIRoute {
    index: number;
    setting1: number;
    setting2: number;
    points: POTIPoint[];
}

interface KMP {
    gobj: GOBJ[];
    poti: POTIRoute[];
}

function parseKMP(buffer: ArrayBufferSlice): KMP {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RKMD');
    const sectionCount = view.getUint16(0x08);
    const headerSize = view.getUint16(0x0A);
    const offsetsStart = 0x10;
    const findSectionOffset = (sectionName: string): number | null => {
        for (let i = 0; i < sectionCount; i++) {
            const relativeOffset = view.getUint32(offsetsStart + i * 0x04);
            const absoluteOffset = headerSize + relativeOffset;
            if (absoluteOffset < 0 || absoluteOffset + 0x08 > buffer.byteLength)
                continue;
            if (readString(buffer, absoluteOffset + 0x00, 0x04) === sectionName)
                return absoluteOffset;
        }
        return null;
    };

    const gobjOffs = findSectionOffset('GOBJ');
    assert(gobjOffs !== null);
    assert(readString(buffer, gobjOffs + 0x00, 0x04) === 'GOBJ');
    const gobjTableCount = view.getUint16(gobjOffs + 0x04);
    let gobjTableIdx = gobjOffs + 0x08;

    const gobj: GOBJ[] = [];
    for (let i = 0; i < gobjTableCount; i++) {
        const objectId = view.getUint16(gobjTableIdx + 0x00);
        const translationX = view.getFloat32(gobjTableIdx + 0x04);
        const translationY = view.getFloat32(gobjTableIdx + 0x08);
        const translationZ = view.getFloat32(gobjTableIdx + 0x0C);
        const rotationX = view.getFloat32(gobjTableIdx + 0x10) * MathConstants.DEG_TO_RAD;
        const rotationY = view.getFloat32(gobjTableIdx + 0x14) * MathConstants.DEG_TO_RAD;
        const rotationZ = view.getFloat32(gobjTableIdx + 0x18) * MathConstants.DEG_TO_RAD;
        const scaleX = view.getFloat32(gobjTableIdx + 0x1C);
        const scaleY = view.getFloat32(gobjTableIdx + 0x20);
        const scaleZ = view.getFloat32(gobjTableIdx + 0x24);
        const routeId = view.getUint16(gobjTableIdx + 0x28);
        const objectArg0 = view.getUint16(gobjTableIdx + 0x2A);
        const objectArg1 = view.getUint16(gobjTableIdx + 0x2C);
        const objectArg2 = view.getUint16(gobjTableIdx + 0x2E);
        const objectArg3 = view.getUint16(gobjTableIdx + 0x30);
        const objectArg4 = view.getUint16(gobjTableIdx + 0x32);
        const objectArg5 = view.getUint16(gobjTableIdx + 0x34);
        const objectArg6 = view.getUint16(gobjTableIdx + 0x36);
        const objectArg7 = view.getUint16(gobjTableIdx + 0x38);

        const presenceFlags = view.getUint16(gobjTableIdx + 0x3A);
        gobj.push({
            editorIndex: i, objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, objectArg4, objectArg5, objectArg6, objectArg7, presenceFlags,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        gobjTableIdx += 0x3C;
    }

    const poti: POTIRoute[] = [];
    const potiOffs = findSectionOffset('POTI');
    if (potiOffs === null)
        return { gobj, poti };

    assert(readString(buffer, potiOffs + 0x00, 0x04) === 'POTI');
    const potiRouteCount = view.getUint16(potiOffs + 0x04);
    let potiTableIdx = potiOffs + 0x08;
    for (let i = 0; i < potiRouteCount; i++) {
        const pointCount = view.getUint16(potiTableIdx + 0x00);
        const setting1 = view.getUint8(potiTableIdx + 0x02);
        const setting2 = view.getUint8(potiTableIdx + 0x03);
        potiTableIdx += 0x04;

        const points: POTIPoint[] = [];
        for (let j = 0; j < pointCount; j++) {
            points.push({
                x: view.getFloat32(potiTableIdx + 0x00),
                y: view.getFloat32(potiTableIdx + 0x04),
                z: view.getFloat32(potiTableIdx + 0x08),
                setting1: view.getUint16(potiTableIdx + 0x0C),
                setting2: view.getUint16(potiTableIdx + 0x0E),
            });
            potiTableIdx += 0x10;
        }

        poti.push({ index: i, setting1, setting2, points });
    }

    return { gobj, poti };
}

const scaleFactor = 0.1;
const editorOverlayAreaHalfExtent = 5000 * scaleFactor;
const posMtx = mat4.fromScaling(mat4.create(), [scaleFactor, scaleFactor, scaleFactor]);
const previewDummyDriverAssetPath = './Preview/fk_lb_driver_model.brres';
const previewDummyKartAssetPath = './Preview/fk_lb_kart_model.brres';

const FIdx2Rad = MathConstants.TAU / 0xFF;
const defaultRouteTangent = vec3.fromValues(0, 0, 1);

type RouteMotionMode = 'loop' | 'pingpong' | 'restart';

interface RouteMotionStep {
    fromIndex: number;
    toIndex: number;
    fromPoint: POTIPoint;
    toPoint: POTIPoint;
    fromPosition: vec3;
    toPosition: vec3;
    tangent: vec3;
    length: number;
    speed: number;
    startFrame: number;
    travelFrames: number;
    waitFrames: number;
}

interface RouteMotionPose {
    position: vec3;
    tangent: vec3;
    fromIndex: number;
    pointIndex: number;
    pointSetting1: number;
    pointSetting2: number;
    moving: boolean;
    phaseInWaitFrames: number;
    waitFrames: number;
    segmentT: number;
    fromPointSetting1: number;
    fromPointSetting2: number;
}

interface RoutePathStep {
    fromIndex: number;
    toIndex: number;
    fromPoint: POTIPoint;
    toPoint: POTIPoint;
    fromPosition: vec3;
    toPosition: vec3;
    tangent: vec3;
    length: number;
    startDistance: number;
}

interface RoutePathSample {
    position: vec3;
    tangent: vec3;
    fromIndex: number;
    toIndex: number;
    segmentT: number;
}

function computeGobjModelMatrix(dst: mat4, gobj: GOBJ): void {
    computeModelMatrixSRT(dst, gobj.scaleX, gobj.scaleY, gobj.scaleZ, gobj.rotationX, gobj.rotationY, gobj.rotationZ, gobj.translationX, gobj.translationY, gobj.translationZ);
    mat4.mul(dst, posMtx, dst);
}

function getGobjPosition(dst: vec3, gobj: GOBJ): vec3 {
    return vec3.set(dst, gobj.translationX, gobj.translationY, gobj.translationZ);
}

function getRoutePointPosition(dst: vec3, point: POTIPoint): vec3 {
    return vec3.set(dst, point.x, point.y, point.z);
}

function computeRouteYaw(tangent: vec3): number {
    if (Math.abs(tangent[0]) < 0.0001 && Math.abs(tangent[2]) < 0.0001)
        return 0;
    return Math.atan2(tangent[0], tangent[2]);
}

function positiveMod(v: number, d: number): number {
    return ((v % d) + d) % d;
}

function makeMotionMode(route: POTIRoute): RouteMotionMode {
    return route.setting2 === 1 ? 'pingpong' : 'loop';
}

function buildRouteSegment(fromPoint: POTIPoint, toPoint: POTIPoint, fromIndex: number, toIndex: number) {
    const fromPosition = getRoutePointPosition(vec3.create(), fromPoint);
    const toPosition = getRoutePointPosition(vec3.create(), toPoint);
    const tangent = vec3.sub(vec3.create(), toPosition, fromPosition);
    const length = vec3.length(tangent);
    if (length > 0.0001)
        vec3.scale(tangent, tangent, 1 / length);
    else
        vec3.copy(tangent, defaultRouteTangent);
    return { fromIndex, toIndex, fromPoint, toPoint, fromPosition, toPosition, tangent, length };
}

function sliceRoute(route: POTIRoute, startIndex: number, endIndex: number): POTIRoute {
    const clampedStart = Math.max(0, Math.min(route.points.length - 1, startIndex));
    const clampedEnd = Math.max(clampedStart, Math.min(route.points.length - 1, endIndex));
    return {
        index: route.index,
        setting1: route.setting1,
        setting2: route.setting2,
        points: route.points.slice(clampedStart, clampedEnd + 1),
    };
}

function getRresChr0(rres: BRRES.RRES, name: string): BRRES.CHR0 | null {
    return rres.chr0.find((chr0) => chr0.name === name) ?? null;
}

function getRresPat0(rres: BRRES.RRES, name: string): BRRES.PAT0 | null {
    return rres.pat0.find((pat0) => pat0.name === name) ?? null;
}

function getRresSrt0(rres: BRRES.RRES, name: string): BRRES.SRT0 | null {
    return rres.srt0.find((srt0) => srt0.name === name) ?? null;
}

class RouteMotionTimeline {
    public readonly steps: RouteMotionStep[] = [];
    public readonly totalFrames: number;
    public readonly pathSteps: RoutePathStep[] = [];
    public readonly pathLength: number;
    private readonly firstPointPosition = vec3.create();

    constructor(
        public readonly route: POTIRoute,
        public readonly mode: RouteMotionMode,
        getSegmentSpeed: (fromPoint: POTIPoint, toPoint: POTIPoint, fromIndex: number, toIndex: number, stepIndex: number) => number,
        getWaitFrames: (point: POTIPoint, pointIndex: number) => number = () => 0,
    ) {
        if (route.points.length > 0)
            getRoutePointPosition(this.firstPointPosition, route.points[0]);

        let distanceCursor = 0;
        for (let i = 0; i < route.points.length - 1; i++) {
            const segment = buildRouteSegment(route.points[i], route.points[i + 1], i, i + 1);
            this.pathSteps.push({ ...segment, startDistance: distanceCursor });
            distanceCursor += segment.length;
        }
        this.pathLength = distanceCursor;

        if (route.points.length <= 1) {
            this.totalFrames = 0;
            return;
        }

        const pointSequence: number[] = [];
        for (let i = 0; i < route.points.length; i++)
            pointSequence.push(i);
        if (mode === 'loop') {
            pointSequence.push(0);
        } else if (mode === 'pingpong') {
            for (let i = route.points.length - 2; i >= 0; i--)
                pointSequence.push(i);
        }

        let frameCursor = 0;
        for (let i = 0; i < pointSequence.length - 1; i++) {
            const fromIndex = pointSequence[i];
            const toIndex = pointSequence[i + 1];
            const fromPoint = route.points[fromIndex];
            const toPoint = route.points[toIndex];
            const { fromPosition, toPosition, tangent, length } = buildRouteSegment(fromPoint, toPoint, fromIndex, toIndex);

            const speed = Math.max(0.001, getSegmentSpeed(fromPoint, toPoint, fromIndex, toIndex, i));
            const travelFrames = length / speed;
            const waitFrames = Math.max(0, getWaitFrames(toPoint, toIndex));
            this.steps.push({ fromIndex, toIndex, fromPoint, toPoint, fromPosition, toPosition, tangent, length, speed, startFrame: frameCursor, travelFrames, waitFrames });
            frameCursor += travelFrames + waitFrames;
        }

        this.totalFrames = frameCursor;
    }

    public frameAtPoint(pointIndex: number): number {
        if (pointIndex <= 0)
            return 0;
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            if (step.toIndex === pointIndex)
                return step.startFrame + step.travelFrames;
        }
        return 0;
    }

    public estimateFrameForPosition(position: vec3): number {
        if (this.steps.length === 0)
            return 0;

        let bestDistanceSq = Number.POSITIVE_INFINITY;
        let bestFrame = 0;
        const projection = vec3.create();
        const segment = vec3.create();
        const delta = vec3.create();

        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            vec3.sub(segment, step.toPosition, step.fromPosition);
            const lengthSq = vec3.squaredLength(segment);
            let t = 0;
            if (lengthSq > 0.0001) {
                vec3.sub(delta, position, step.fromPosition);
                t = Math.max(0, Math.min(1, vec3.dot(delta, segment) / lengthSq));
            }

            vec3.lerp(projection, step.fromPosition, step.toPosition, t);
            const distanceSq = vec3.squaredDistance(position, projection);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestFrame = step.startFrame + step.travelFrames * t;
            }
        }

        return bestFrame;
    }

    public samplePath(progress: number): RoutePathSample {
        if (this.route.points.length === 0 || this.pathSteps.length === 0 || this.pathLength <= 0) {
            return {
                position: vec3.clone(this.firstPointPosition),
                tangent: vec3.clone(defaultRouteTangent),
                fromIndex: 0,
                toIndex: 0,
                segmentT: 0,
            };
        }

        const clampedProgress = Math.max(0, Math.min(1, progress));
        let targetDistance = this.pathLength * clampedProgress;

        for (let i = 0; i < this.pathSteps.length; i++) {
            const step = this.pathSteps[i];
            const stepEndDistance = step.startDistance + step.length;
            if (i !== this.pathSteps.length - 1 && targetDistance > stepEndDistance)
                continue;

            const localDistance = Math.max(0, Math.min(step.length, targetDistance - step.startDistance));
            const t = step.length > 0.0001 ? localDistance / step.length : 0;
            return {
                position: vec3.lerp(vec3.create(), step.fromPosition, step.toPosition, t),
                tangent: vec3.clone(step.tangent),
                fromIndex: step.fromIndex,
                toIndex: step.toIndex,
                segmentT: t,
            };
        }

        const lastStep = this.pathSteps[this.pathSteps.length - 1];
        return {
            position: vec3.clone(lastStep.toPosition),
            tangent: vec3.clone(lastStep.tangent),
            fromIndex: lastStep.fromIndex,
            toIndex: lastStep.toIndex,
            segmentT: 1,
        };
    }

    public evaluate(frame: number): RouteMotionPose {
        if (this.route.points.length === 0) {
            return {
                position: vec3.create(),
                tangent: vec3.clone(defaultRouteTangent),
                fromIndex: 0,
                pointIndex: 0,
                pointSetting1: 0,
                pointSetting2: 0,
                moving: false,
                phaseInWaitFrames: 0,
                waitFrames: 0,
                segmentT: 0,
                fromPointSetting1: 0,
                fromPointSetting2: 0,
            };
        }

        if (this.steps.length === 0 || this.totalFrames <= 0) {
            const point = this.route.points[0];
            return {
                position: vec3.clone(this.firstPointPosition),
                tangent: vec3.clone(defaultRouteTangent),
                fromIndex: 0,
                pointIndex: 0,
                pointSetting1: point.setting1,
                pointSetting2: point.setting2,
                moving: false,
                phaseInWaitFrames: 0,
                waitFrames: 0,
                segmentT: 0,
                fromPointSetting1: point.setting1,
                fromPointSetting2: point.setting2,
            };
        }

        const localFrame = positiveMod(frame, this.totalFrames);
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            const stepFrame = localFrame - step.startFrame;
            if (stepFrame < 0)
                continue;

            if (step.travelFrames > 0 && stepFrame <= step.travelFrames) {
                const t = Math.max(0, Math.min(1, stepFrame / step.travelFrames));
                return {
                    position: vec3.lerp(vec3.create(), step.fromPosition, step.toPosition, t),
                    tangent: vec3.clone(step.tangent),
                    fromIndex: step.fromIndex,
                    pointIndex: step.toIndex,
                    pointSetting1: step.toPoint.setting1,
                    pointSetting2: step.toPoint.setting2,
                    moving: true,
                    phaseInWaitFrames: 0,
                    waitFrames: step.waitFrames,
                    segmentT: t,
                    fromPointSetting1: step.fromPoint.setting1,
                    fromPointSetting2: step.fromPoint.setting2,
                };
            }

            if (stepFrame <= step.travelFrames + step.waitFrames || i === this.steps.length - 1) {
                return {
                    position: vec3.clone(step.toPosition),
                    tangent: vec3.clone(step.tangent),
                    fromIndex: step.fromIndex,
                    pointIndex: step.toIndex,
                    pointSetting1: step.toPoint.setting1,
                    pointSetting2: step.toPoint.setting2,
                    moving: false,
                    phaseInWaitFrames: Math.max(0, stepFrame - step.travelFrames),
                    waitFrames: step.waitFrames,
                    segmentT: 1,
                    fromPointSetting1: step.toPoint.setting1,
                    fromPointSetting2: step.toPoint.setting2,
                };
            }
        }

        const lastStep = this.steps[this.steps.length - 1];
        return {
            position: vec3.clone(lastStep.toPosition),
            tangent: vec3.clone(lastStep.tangent),
            fromIndex: lastStep.fromIndex,
            pointIndex: lastStep.toIndex,
            pointSetting1: lastStep.toPoint.setting1,
            pointSetting2: lastStep.toPoint.setting2,
            moving: false,
            phaseInWaitFrames: 0,
            waitFrames: lastStep.waitFrames,
            segmentT: 1,
            fromPointSetting1: lastStep.toPoint.setting1,
            fromPointSetting2: lastStep.toPoint.setting2,
        };
    }
}

class CourseBGRenderer implements BaseObject {
    public visible = true;
    public modelMatrix = mat4.create();

    constructor(public modelInstance: MDL0ModelInstance) {
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.modelInstance.bindLightSetting(lightSetting);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
    }
}

abstract class GobjPreviewRenderer implements BaseObject {
    public visible = true;
    public modelMatrix = mat4.create();

    constructor(public gobj: GOBJ) {
        computeGobjModelMatrix(this.modelMatrix, gobj);
    }

    public abstract getModelInstances(): MDL0ModelInstance[];

    public setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        const oldBase = mat4.create();
        const nextBase = mat4.create();
        computeGobjModelMatrix(oldBase, this.gobj);
        this.gobj.translationX = translation.x;
        this.gobj.translationY = translation.y;
        this.gobj.translationZ = translation.z;
        this.gobj.rotationX = rotation.x * MathConstants.DEG_TO_RAD;
        this.gobj.rotationY = rotation.y * MathConstants.DEG_TO_RAD;
        this.gobj.rotationZ = rotation.z * MathConstants.DEG_TO_RAD;
        this.gobj.scaleX = scale.x;
        this.gobj.scaleY = scale.y;
        this.gobj.scaleZ = scale.z;
        computeGobjModelMatrix(nextBase, this.gobj);

        const inverseOldBase = mat4.invert(mat4.create(), oldBase);
        if (inverseOldBase === null) {
            mat4.copy(this.modelMatrix, nextBase);
            return;
        }
        const localAdjustment = mat4.mul(mat4.create(), this.modelMatrix, inverseOldBase);
        mat4.mul(this.modelMatrix, localAdjustment, nextBase);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (const modelInstance of this.getModelInstances())
            modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (const modelInstance of this.getModelInstances())
            modelInstance.setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        for (const modelInstance of this.getModelInstances())
            modelInstance.bindLightSetting(lightSetting);
    }

    public destroy(device: GfxDevice): void {
    }
}

class SimpleObjectRenderer extends GobjPreviewRenderer {
    constructor(public modelInstance: MDL0ModelInstance, gobj: GOBJ) {
        super(gobj);
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return [this.modelInstance];
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }
}

class MultiObjectRenderer extends GobjPreviewRenderer {
    constructor(public modelInstances: MDL0ModelInstance[], gobj: GOBJ) {
        super(gobj);
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return this.modelInstances;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        for (const modelInstance of this.modelInstances) {
            mat4.copy(modelInstance.modelMatrix, this.modelMatrix);
            modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}

class RoutedMultiModelRenderer extends GobjPreviewRenderer {
    protected readonly scratchPosition = vec3.create();
    protected readonly timeline: RouteMotionTimeline;
    protected initialFrame: number;
    private routeYawOffset: number;

    constructor(
        public modelInstances: MDL0ModelInstance[],
        gobj: GOBJ,
        timeline: RouteMotionTimeline,
        private readonly alignYaw: boolean,
        private readonly extraYaw: number = 0,
        private readonly extraYOffset: number = 0,
        initialFrame: number | null = null,
    ) {
        super(gobj);
        this.timeline = timeline;
        this.initialFrame = initialFrame ?? timeline.estimateFrameForPosition(getGobjPosition(vec3.create(), gobj));
        this.recomputeReference();
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return this.modelInstances;
    }

    protected getPose(viewerInput: Viewer.ViewerRenderInput, frameOffset = 0): RouteMotionPose {
        const frame = viewerInput.time * 0.06 + this.initialFrame + frameOffset;
        return this.timeline.evaluate(frame);
    }

    protected updateModelState(pose: RouteMotionPose, viewerInput: Viewer.ViewerRenderInput): void {
    }

    protected recomputeReference(): void {
        const initialPose = this.timeline.evaluate(this.initialFrame);
        const initialRouteYaw = this.alignYaw ? computeRouteYaw(initialPose.tangent) : 0;
        this.routeYawOffset = this.gobj.rotationY - initialRouteYaw;
    }

    public override setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        super.setEditorTransform(translation, rotation, scale);
        this.recomputeReference();
    }

    protected updateModelMatrixFromPose(pose: RouteMotionPose): void {
        vec3.copy(this.scratchPosition, pose.position);
        this.scratchPosition[1] += this.extraYOffset;
        const yaw = this.alignYaw ? computeRouteYaw(pose.tangent) + this.routeYawOffset + this.extraYaw : this.gobj.rotationY + this.extraYaw;
        computeModelMatrixSRT(
            this.modelMatrix,
            this.gobj.scaleX,
            this.gobj.scaleY,
            this.gobj.scaleZ,
            this.gobj.rotationX,
            yaw,
            this.gobj.rotationZ,
            this.scratchPosition[0],
            this.scratchPosition[1],
            this.scratchPosition[2],
        );
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const pose = this.getPose(viewerInput);
        this.updateModelMatrixFromPose(pose);
        this.updateModelState(pose, viewerInput);
        for (const modelInstance of this.modelInstances) {
            mat4.copy(modelInstance.modelMatrix, this.modelMatrix);
            modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}

class RoutedSingleModelRenderer extends RoutedMultiModelRenderer {
    constructor(public modelInstance: MDL0ModelInstance, gobj: GOBJ, timeline: RouteMotionTimeline, alignYaw: boolean, extraYaw: number = 0, extraYOffset: number = 0, initialFrame: number | null = null) {
        super([modelInstance], gobj, timeline, alignYaw, extraYaw, extraYOffset, initialFrame);
    }
}

class RoutedCarRenderer extends RoutedMultiModelRenderer {
    private readonly lightAnimationController = new AnimationController(60);
    private readonly leftBlinkPAT0: BRRES.PAT0 | null;
    private readonly rightBlinkPAT0: BRRES.PAT0 | null;
    private boundBlinkPAT0: BRRES.PAT0 | null = null;

    constructor(
        private readonly lightInstance: MDL0ModelInstance,
        modelInstances: MDL0ModelInstance[],
        rres: BRRES.RRES,
        gobj: GOBJ,
        timeline: RouteMotionTimeline,
        initialFrame: number,
    ) {
        super(modelInstances, gobj, timeline, true, 0, 0, initialFrame);
        this.leftBlinkPAT0 = getRresPat0(rres, 'K_car_light_left');
        this.rightBlinkPAT0 = getRresPat0(rres, 'K_car_light');
    }

    protected override updateModelState(pose: RouteMotionPose, viewerInput: Viewer.ViewerRenderInput): void {
        this.lightAnimationController.setTimeInMilliseconds(viewerInput.time);
        let nextPat0: BRRES.PAT0 | null = null;
        if (pose.fromPointSetting1 === 1)
            nextPat0 = this.leftBlinkPAT0;
        else if (pose.fromPointSetting1 === 2)
            nextPat0 = this.rightBlinkPAT0;

        if (this.boundBlinkPAT0 !== nextPat0) {
            this.lightInstance.bindPAT0(nextPat0 !== null ? this.lightAnimationController : null, nextPat0);
            this.boundBlinkPAT0 = nextPat0;
        }
    }
}

class RoutedCrabRenderer extends RoutedSingleModelRenderer {
    private readonly animationController = new AnimationController(60);
    private readonly waitCHR0: BRRES.CHR0 | null;
    private readonly walkCHR0: BRRES.CHR0 | null;
    private boundCHR0: BRRES.CHR0 | null = null;
    private readonly animationScale: number;

    constructor(modelInstance: MDL0ModelInstance, rres: BRRES.RRES, gobj: GOBJ, timeline: RouteMotionTimeline) {
        super(modelInstance, gobj, timeline, true, gobj.objectArg1 === 0 ? -Math.PI / 2 : Math.PI / 2);
        this.waitCHR0 = getRresChr0(rres, 'wait');
        this.walkCHR0 = getRresChr0(rres, gobj.objectArg1 === 0 ? 'walk_l' : 'walk_r');
        this.animationScale = Math.max(0.35, Math.min(3, gobj.objectArg0 / 10));
    }

    protected override updateModelState(pose: RouteMotionPose, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInFrames(viewerInput.time * 0.06 * this.animationScale);
        const nextChr0 = pose.moving ? this.walkCHR0 : this.waitCHR0;
        if (this.boundCHR0 !== nextChr0 && nextChr0 !== null) {
            this.modelInstance.bindCHR0(this.animationController, nextChr0);
            this.boundCHR0 = nextChr0;
        }
    }
}

class RoutedKuriboRenderer extends RoutedSingleModelRenderer {
    private readonly animationController = new AnimationController(60);
    private readonly walkForwardCHR0: BRRES.CHR0 | null;
    private readonly walkBackwardCHR0: BRRES.CHR0 | null;
    private boundCHR0: BRRES.CHR0 | null = null;
    private readonly animationScale: number;

    constructor(modelInstance: MDL0ModelInstance, rres: BRRES.RRES, gobj: GOBJ, timeline: RouteMotionTimeline) {
        super(modelInstance, gobj, timeline, true);
        this.walkForwardCHR0 = getRresChr0(rres, 'walk_l');
        this.walkBackwardCHR0 = getRresChr0(rres, 'walk_r');
        this.animationScale = Math.max(0.25, Math.min(4, gobj.objectArg2 > 0 ? gobj.objectArg2 / 30 : 1));
    }

    protected override updateModelState(pose: RouteMotionPose, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInFrames(viewerInput.time * 0.06 * this.animationScale);
        const forward = pose.fromIndex <= pose.pointIndex;
        const nextChr0 = forward ? this.walkForwardCHR0 : this.walkBackwardCHR0;
        if (this.boundCHR0 !== nextChr0 && nextChr0 !== null) {
            this.modelInstance.bindCHR0(this.animationController, nextChr0);
            this.boundCHR0 = nextChr0;
        }
    }
}

class RoutedDossunRenderer extends RoutedSingleModelRenderer {
    private readonly animationController = new AnimationController(60);
    private readonly wakeUpCHR0: BRRES.CHR0 | null;
    private readonly pat0: BRRES.PAT0 | null;
    private readonly mode: number;
    private readonly liftHeight: number;
    private readonly startDelayFrames: number;

    constructor(modelInstance: MDL0ModelInstance, rres: BRRES.RRES, gobj: GOBJ, timeline: RouteMotionTimeline, startDelayFrames: number = 0) {
        super(modelInstance, gobj, timeline, gobj.objectArg1 !== 3);
        this.wakeUpCHR0 = getRresChr0(rres, 'wake_up');
        this.pat0 = getRresPat0(rres, 'dossun');
        this.mode = gobj.objectArg1;
        this.liftHeight = Math.max(220, gobj.objectArg0 * 6);
        this.startDelayFrames = startDelayFrames;
        if (this.pat0 !== null)
            this.modelInstance.bindPAT0(this.animationController, this.pat0);
        if (this.wakeUpCHR0 !== null)
            this.modelInstance.bindCHR0(this.animationController, this.wakeUpCHR0);
    }

    protected override getPose(viewerInput: Viewer.ViewerRenderInput, frameOffset = 0): RouteMotionPose {
        const elapsedFrames = viewerInput.time * 0.06 + frameOffset;
        if (elapsedFrames < this.startDelayFrames)
            return this.timeline.evaluate(this.initialFrame);
        return this.timeline.evaluate(elapsedFrames - this.startDelayFrames + this.initialFrame);
    }

    protected override updateModelState(pose: RouteMotionPose, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        if (this.mode !== 1 || pose.waitFrames <= 0)
            return;

        const downFrames = Math.min(18, pose.waitFrames);
        const upFrames = Math.min(20, Math.max(0, pose.waitFrames - downFrames));
        const flatFrames = Math.max(0, pose.waitFrames - downFrames - upFrames);
        let lift = this.liftHeight;
        if (pose.phaseInWaitFrames <= downFrames) {
            const t = downFrames > 0 ? pose.phaseInWaitFrames / downFrames : 1;
            lift = this.liftHeight * (1 - t);
        } else if (pose.phaseInWaitFrames <= downFrames + flatFrames) {
            lift = 0;
        } else {
            const t = upFrames > 0 ? (pose.phaseInWaitFrames - downFrames - flatFrames) / upFrames : 1;
            lift = this.liftHeight * t;
        }
        this.modelMatrix[13] += lift * scaleFactor;
    }
}

class RoutedDossunPairRenderer extends GobjPreviewRenderer {
    private readonly animationController = new AnimationController(60);
    private readonly pat0: BRRES.PAT0 | null;
    private readonly wakeUpCHR0: BRRES.CHR0 | null;
    private readonly scratchPosition = vec3.create();
    private readonly splitAxis = vec3.create();
    private readonly point0 = vec3.create();
    private readonly point1 = vec3.create();
    private readonly point2 = vec3.create();
    private readonly initialTangent = vec3.create();
    private readonly splitDistance: number;
    private readonly liftHeight: number;
    private readonly phase0Frames: number;
    private readonly phase1Frames: number;
    private readonly phase2Frames: number;
    private readonly phase3Frames: number;
    private readonly cycleFrames: number;
    private routeYawOffset = 0;

    constructor(
        private readonly modelInstances: MDL0ModelInstance[],
        rres: BRRES.RRES,
        gobj: GOBJ,
        route: POTIRoute,
        private readonly startDelayFrames: number,
        sleepFrames: number,
    ) {
        super(gobj);

        const p0 = route.points[0];
        const p1 = route.points[1] ?? route.points[0];
        const p2 = route.points[2] ?? route.points[route.points.length - 1] ?? route.points[0];
        getRoutePointPosition(this.point0, p0);
        getRoutePointPosition(this.point1, p1);
        getRoutePointPosition(this.point2, p2);
        vec3.sub(this.initialTangent, this.point1, this.point0);
        if (vec3.length(this.initialTangent) > 0.0001)
            vec3.normalize(this.initialTangent, this.initialTangent);
        else
            vec3.copy(this.initialTangent, defaultRouteTangent);

        const routeSpeed = Math.max(1, gobj.objectArg0);
        this.phase0Frames = Math.max(1, vec3.distance(this.point0, this.point1) / routeSpeed);
        this.phase1Frames = Math.max(1, vec3.distance(this.point1, this.point2) / routeSpeed);
        this.phase2Frames = Math.max(12, sleepFrames);
        this.phase3Frames = Math.max(1, vec3.distance(this.point2, this.point0) / routeSpeed);
        this.cycleFrames = this.phase0Frames + this.phase1Frames + this.phase2Frames + this.phase3Frames;

        const rawSplitAxis = vec3.fromValues(Math.cos(gobj.rotationY), 0, -Math.sin(gobj.rotationY));
        if (vec3.length(rawSplitAxis) > 0.0001)
            vec3.normalize(this.splitAxis, rawSplitAxis);
        else
            vec3.set(this.splitAxis, 1, 0, 0);

        this.splitDistance = Math.max(1200, Math.min(4000, vec3.distance(this.point1, this.point2) * 0.25));
        this.liftHeight = Math.max(220, gobj.objectArg0 * 6);
        this.recomputeReference();

        this.pat0 = getRresPat0(rres, 'dossun');
        this.wakeUpCHR0 = getRresChr0(rres, 'wake_up');
        for (const modelInstance of this.modelInstances) {
            if (this.pat0 !== null)
                modelInstance.bindPAT0(this.animationController, this.pat0);
            if (this.wakeUpCHR0 !== null)
                modelInstance.bindCHR0(this.animationController, this.wakeUpCHR0);
        }
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return this.modelInstances;
    }

    private recomputeReference(): void {
        this.routeYawOffset = this.gobj.rotationY - computeRouteYaw(this.initialTangent);
    }

    public override setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        super.setEditorTransform(translation, rotation, scale);
        this.recomputeReference();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const elapsedFrames = viewerInput.time * 0.06;
        let cycleFrame = 0;
        if (elapsedFrames >= this.startDelayFrames)
            cycleFrame = positiveMod(elapsedFrames - this.startDelayFrames, this.cycleFrames);

        let center = this.point0;
        let splitT = 0;
        let activeLiftT = 1;

        if (cycleFrame < this.phase0Frames) {
            const t = cycleFrame / this.phase0Frames;
            center = vec3.lerp(vec3.create(), this.point0, this.point1, t);
        } else if (cycleFrame < this.phase0Frames + this.phase1Frames) {
            const t = (cycleFrame - this.phase0Frames) / this.phase1Frames;
            center = vec3.lerp(vec3.create(), this.point1, this.point2, t);
            splitT = easeInOutSine(t);
        } else if (cycleFrame < this.phase0Frames + this.phase1Frames + this.phase2Frames) {
            center = this.point2;
            splitT = 1;
            const waitFrame = cycleFrame - this.phase0Frames - this.phase1Frames;
            const downFrames = Math.min(18, this.phase2Frames);
            const upFrames = Math.min(20, Math.max(0, this.phase2Frames - downFrames));
            const flatFrames = Math.max(0, this.phase2Frames - downFrames - upFrames);
            if (waitFrame <= downFrames) {
                activeLiftT = 1 - (downFrames > 0 ? waitFrame / downFrames : 1);
            } else if (waitFrame <= downFrames + flatFrames) {
                activeLiftT = 0;
            } else {
                const t = upFrames > 0 ? (waitFrame - downFrames - flatFrames) / upFrames : 1;
                activeLiftT = t;
            }
        } else {
            const t = (cycleFrame - this.phase0Frames - this.phase1Frames - this.phase2Frames) / this.phase3Frames;
            center = vec3.lerp(vec3.create(), this.point2, this.point0, t);
            splitT = 1 - easeInOutSine(t);
        }

        const splitOffset = this.splitDistance * splitT;
        const yaw = cycleFrame < this.phase0Frames
            ? computeRouteYaw(this.initialTangent) + this.routeYawOffset
            : computeRouteYaw(this.initialTangent) + Math.PI + this.routeYawOffset;
        const cameraSide = vec3.dot(
            vec3.sub(vec3.create(), vec3.fromValues(viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]), center),
            this.splitAxis,
        );
        const activeSign = cameraSide >= 0 ? 1 : -1;
        const signs = [-1, 1];
        for (let i = 0; i < this.modelInstances.length; i++) {
            const sign = signs[i] ?? 1;
            vec3.scaleAndAdd(this.scratchPosition, center, this.splitAxis, splitOffset * sign);
            const lift = this.liftHeight * (sign === activeSign ? activeLiftT : 1);
            computeModelMatrixSRT(
                this.modelMatrix,
                this.gobj.scaleX,
                this.gobj.scaleY,
                this.gobj.scaleZ,
                this.gobj.rotationX,
                yaw,
                this.gobj.rotationZ,
                this.scratchPosition[0],
                this.scratchPosition[1] + lift,
                this.scratchPosition[2],
            );
            mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
            mat4.copy(this.modelInstances[i].modelMatrix, this.modelMatrix);
            this.modelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}

function easeInOutSine(t: number): number {
    return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
}

class RoutedItemboxGroupRenderer extends GobjPreviewRenderer {
    private readonly scratchPosition = vec3.create();

    constructor(
        gobj: GOBJ,
        private readonly timeline: RouteMotionTimeline,
        private readonly primaryInstances: MDL0ModelInstance[],
        private readonly phaseFrameStep: number,
        private readonly yOffset: number,
        private readonly startDelayFrames: number = 0,
    ) {
        super(gobj);
        this.recomputeReference();
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return [...this.primaryInstances];
    }

    private recomputeReference(): void {
    }

    public override setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        super.setEditorTransform(translation, rotation, scale);
        this.recomputeReference();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const baseFrame = viewerInput.time * 0.06 - this.startDelayFrames;
        for (let i = 0; i < this.primaryInstances.length; i++) {
            const localFrame = baseFrame - i * this.phaseFrameStep;
            if (localFrame < 0)
                continue;

            const pose = this.timeline.evaluate(localFrame);
            vec3.copy(this.scratchPosition, pose.position);
            this.scratchPosition[1] += this.yOffset;
            computeModelMatrixSRT(
                this.modelMatrix,
                this.gobj.scaleX,
                this.gobj.scaleY,
                this.gobj.scaleZ,
                this.gobj.rotationX,
                this.gobj.rotationY,
                this.gobj.rotationZ,
                this.scratchPosition[0],
                this.scratchPosition[1],
                this.scratchPosition[2],
            );
            mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);

            const primary = this.primaryInstances[i];
            mat4.copy(primary.modelMatrix, this.modelMatrix);
            primary.prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}

class RoutedSinItemboxRenderer extends GobjPreviewRenderer {
    private readonly scratchPosition = vec3.create();

    constructor(
        public modelInstance: MDL0ModelInstance,
        gobj: GOBJ,
        private readonly timeline: RouteMotionTimeline,
        private readonly cycleFrames: number,
        private readonly startDelayFrames: number,
        private readonly yOffset: number,
    ) {
        super(gobj);
        this.recomputeReference();
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return [this.modelInstance];
    }

    private evaluatePath(frame: number): RoutePathSample {
        if (frame < this.startDelayFrames)
            return this.timeline.samplePath(0);

        const localFrame = positiveMod(frame - this.startDelayFrames, this.cycleFrames);
        const phase = localFrame / this.cycleFrames;
        const forwardRatio = this.timeline.route.setting2 === 1 ? 0.5 : 0.65;
        if (phase < forwardRatio) {
            return this.timeline.samplePath(easeInOutSine(phase / Math.max(0.0001, forwardRatio)));
        }

        const sample = this.timeline.samplePath(1 - easeInOutSine((phase - forwardRatio) / Math.max(0.0001, 1 - forwardRatio)));
        sample.tangent = vec3.scale(vec3.create(), sample.tangent, -1);
        return sample;
    }

    private recomputeReference(): void {
    }

    public override setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        super.setEditorTransform(translation, rotation, scale);
        this.recomputeReference();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const sample = this.evaluatePath(viewerInput.time * 0.06);
        vec3.copy(this.scratchPosition, sample.position);
        this.scratchPosition[1] += this.yOffset;
        computeModelMatrixSRT(
            this.modelMatrix,
            this.gobj.scaleX,
            this.gobj.scaleY,
            this.gobj.scaleZ,
            this.gobj.rotationX,
            this.gobj.rotationY,
            this.gobj.rotationZ,
            this.scratchPosition[0],
            this.scratchPosition[1],
            this.scratchPosition[2],
        );
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }
}

class RoutedItemboxLineRenderer extends GobjPreviewRenderer {
    private readonly scratchPosition = vec3.create();

    constructor(
        gobj: GOBJ,
        private readonly blockTimeline: RouteMotionTimeline,
        private readonly itemTimeline: RouteMotionTimeline,
        private readonly blockInstances: MDL0ModelInstance[],
        private readonly itemInstances: MDL0ModelInstance[],
        private readonly pressInstance: MDL0ModelInstance,
        private readonly phaseFrameStep: number,
        private readonly startDelayFrames: number,
    ) {
        super(gobj);
        this.recomputeReference();
    }

    public override getModelInstances(): MDL0ModelInstance[] {
        return [...this.blockInstances, ...this.itemInstances, this.pressInstance];
    }

    private recomputeReference(): void {
    }

    public override setEditorTransform(translation: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
        super.setEditorTransform(translation, rotation, scale);
        this.recomputeReference();
    }

    private computePlacementMatrix(position: vec3, yOffset: number): void {
        vec3.copy(this.scratchPosition, position);
        this.scratchPosition[1] += yOffset;
        computeModelMatrixSRT(
            this.modelMatrix,
            this.gobj.scaleX,
            this.gobj.scaleY,
            this.gobj.scaleZ,
            this.gobj.rotationX,
            this.gobj.rotationY,
            this.gobj.rotationZ,
            this.scratchPosition[0],
            this.scratchPosition[1],
            this.scratchPosition[2],
        );
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const baseFrame = viewerInput.time * 0.06 - this.startDelayFrames;
        const blockFrames = Math.max(1, this.blockTimeline.totalFrames);
        const itemFrames = Math.max(1, this.itemTimeline.totalFrames);
        const cycleFrames = blockFrames + itemFrames;

        for (let i = 0; i < this.blockInstances.length; i++) {
            const localFrame = baseFrame - i * this.phaseFrameStep;
            if (localFrame < 0)
                continue;

            const cycleFrame = positiveMod(localFrame, cycleFrames);
            if (cycleFrame < blockFrames) {
                const pose = this.blockTimeline.evaluate(cycleFrame);
                this.computePlacementMatrix(pose.position, 0);
                mat4.copy(this.blockInstances[i].modelMatrix, this.modelMatrix);
                this.blockInstances[i].prepareToRender(device, renderInstManager, viewerInput);
            } else {
                const pose = this.itemTimeline.evaluate(cycleFrame - blockFrames);
                this.computePlacementMatrix(pose.position, 20);
                mat4.copy(this.itemInstances[i].modelMatrix, this.modelMatrix);
                this.itemInstances[i].prepareToRender(device, renderInstManager, viewerInput);
            }
        }

        const pressPoint = this.blockTimeline.route.points[this.blockTimeline.route.points.length - 1];
        const pressPosition = getRoutePointPosition(vec3.create(), pressPoint);
        this.computePlacementMatrix(pressPosition, 0);
        mat4.copy(this.pressInstance.modelMatrix, this.modelMatrix);
        this.pressInstance.prepareToRender(device, renderInstManager, viewerInput);
    }
}

class EditorStartPreviewRenderer implements BaseObject {
    public visible = true;
    public modelMatrix = mat4.create();

    constructor(public driverInstance: MDL0ModelInstance, public kartInstances: MDL0ModelInstance[], public slotIndex: number) {
    }

    public setTransform(position: { x: number; y: number; z: number; }, rotation: { x: number; y: number; z: number; }): void {
        computeModelMatrixSRT(this.modelMatrix, 1, 1, 1, rotation.x * MathConstants.DEG_TO_RAD, rotation.y * MathConstants.DEG_TO_RAD, rotation.z * MathConstants.DEG_TO_RAD, position.x, position.y, position.z);
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.driverInstance.setVertexColorsEnabled(v);
        for (let i = 0; i < this.kartInstances.length; i++)
            this.kartInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.driverInstance.setTexturesEnabled(v);
        for (let i = 0; i < this.kartInstances.length; i++)
            this.kartInstances[i].setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.driverInstance.bindLightSetting(lightSetting);
        for (let i = 0; i < this.kartInstances.length; i++)
            this.kartInstances[i].bindLightSetting(lightSetting);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const bodyInstance = this.kartInstances.find((instance) => instance.mdl0Model.mdl0.name === 'body') ?? this.kartInstances[0];
        mat4.copy(bodyInstance.modelMatrix, this.modelMatrix);
        bodyInstance.prepareToRender(device, renderInstManager, viewerInput);

        for (let i = 0; i < this.kartInstances.length; i++) {
            const kartInstance = this.kartInstances[i];
            if (kartInstance === bodyInstance)
                continue;

            const modelName = kartInstance.mdl0Model.mdl0.name;
            if (modelName === 'shadow')
                continue;

            const attachmentMatrix = this.findKartAttachmentMatrix(bodyInstance, modelName);
            mat4.copy(kartInstance.modelMatrix, attachmentMatrix ?? this.modelMatrix);
            kartInstance.prepareToRender(device, renderInstManager, viewerInput);
        }

        mat4.copy(this.driverInstance.modelMatrix, this.modelMatrix);
        this.driverInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
    }

    private findKartAttachmentMatrix(bodyInstance: MDL0ModelInstance, modelName: string): mat4 | null {
        const attachmentNames = kartModelAttachmentNames.get(modelName) ?? [modelName];
        for (let i = 0; i < attachmentNames.length; i++) {
            const node = bodyInstance.mdl0Model.mdl0.nodes.find((candidate) => candidate.name === attachmentNames[i]);
            if (node !== undefined)
                return bodyInstance.getNodeToWorldMatrixReference(node.mtxId);
        }
        return null;
    }
}

const kartModelAttachmentNames = new Map<string, string[]>([
    ['handle', ['handle', 'handle_all', 'handle_drive']],
    ['swingarm', ['swingarm', 'r_sus']],
    ['tire_f', ['tire_f', 'f_sus', 'tire']],
    ['tire_r', ['tire_r', 'r_sus', 'swingarm']],
    ['tire_r1', ['tire_r1', 'r_sus', 'swingarm']],
]);

class Aurora extends SimpleObjectRenderer {
    private nodeIndices: number[] = [];

    constructor(modelInstance: MDL0ModelInstance, gobj: GOBJ) {
        super(modelInstance, gobj);

        // Nintendo is really cool lol
        for (let i = 0; i < 37; i++) {
            const nodeName = 'joint' + (i + 2);
            this.nodeIndices.push(this.modelInstance.mdl0Model.mdl0.nodes.findIndex((node) => node.name === nodeName)!);
        }
    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        // Update joints.
        // TODO(jstpierre): Do in a less ugly way lol

        const timeInFrames = (viewerInput.time / 1000) * 60;
        const jointDist = 416.66000366;
        const freq = 40.74366379;

        for (let i = 0; i < this.nodeIndices.length; i++) {
            const nodeIndex = this.nodeIndices[i];
            const node = this.modelInstance.mdl0Model.mdl0.nodes[nodeIndex];
            const dst = node.modelMatrix;

            const thetaA = (((timeInFrames / 60) - 30) / 60);
            const theta = Math.min(1.0 + (thetaA * thetaA), 4);
            const waveFade = (MathConstants.TAU * jointDist * i) / 15000;
            const wave2 = Math.sin(FIdx2Rad * (freq * ((waveFade * theta) + ((Math.PI * timeInFrames) / 50.0))));

            dst[12] = (i + 2) * jointDist;
            dst[13] = waveFade * wave2 * 80;
            dst[14] = 0;
        }

        super.prepareToRender(device, renderInstManager, viewerInput);
    }
}

async function loadSZS(buffer: ArrayBufferSlice): Promise<U8.U8Archive> {
    return U8.parse(await Yaz0.decompress(buffer));
}

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private static createModelInstanceFromRRES(renderer: MarioKartWiiRenderer, rres: BRRES.RRES, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        const mdl0Model = assertExists(modelCache.modelCache.get(objectName));
        const mdl0Instance = new MDL0ModelInstance(renderer.textureHolder, mdl0Model, objectName);
        mdl0Instance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres, null);
        return mdl0Instance;
    }

    private static spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ, routes: POTIRoute[]): void {
        const getRRES = (objectName: string): BRRES.RRES => {
            const arcPath = `./${objectName}.brres`;
            const file = arc.findFileData(arcPath) ?? renderer.commonCache.findFileData(arcPath);
            renderer.modelCache.ensureRRES(device, renderer, arcPath, file);
            return assertExists(renderer.modelCache.rresCache.get(arcPath));
        };

        const createModelInstance = (rresName: string, mdl0Name: string = rresName): MDL0ModelInstance => {
            return this.createModelInstanceFromRRES(renderer, getRRES(rresName), mdl0Name);
        };

        const spawnSimpleObject = (rresName: string, mdl0Name: string = rresName): SimpleObjectRenderer => {
            const b = createModelInstance(rresName, mdl0Name);
            const obj = new SimpleObjectRenderer(b, gobj);
            renderer.baseObjects.push(obj);
            return obj;
        };

        const spawnCompositeObject = (instances: MDL0ModelInstance[]): MultiObjectRenderer => {
            const obj = new MultiObjectRenderer(instances, gobj);
            renderer.baseObjects.push(obj);
            return obj;
        };

        const getRoute = (): POTIRoute | null => {
            if (gobj.routeId === 0xFFFF)
                return null;
            return routes[gobj.routeId] ?? null;
        };

        const getRouteStartFrame = (timeline: RouteMotionTimeline, route: POTIRoute, routeStartPoint: number): number => {
            if (routeStartPoint >= 0 && routeStartPoint < route.points.length)
                return timeline.frameAtPoint(routeStartPoint);
            return timeline.estimateFrameForPosition(getGobjPosition(vec3.create(), gobj));
        };

        const createTimeline = (
            route: POTIRoute,
            mode: RouteMotionMode,
            getSegmentSpeed: (fromPoint: POTIPoint, toPoint: POTIPoint, fromIndex: number, toIndex: number, stepIndex: number) => number,
            getWaitFrames: (point: POTIPoint, pointIndex: number) => number = () => 0,
        ): RouteMotionTimeline => {
            return new RouteMotionTimeline(route, mode, getSegmentSpeed, getWaitFrames);
        };

        const createTimedTimeline = (
            route: POTIRoute,
            mode: RouteMotionMode,
            totalTravelFrames: number,
            getPerPointFrames: ((point: POTIPoint) => number) | null = null,
        ): RouteMotionTimeline => {
            const unitTimeline = new RouteMotionTimeline(route, mode, () => 1);
            const totalLength = unitTimeline.steps.reduce((sum, step) => sum + step.length, 0);
            const baseSpeed = totalLength > 0 ? totalLength / Math.max(1, totalTravelFrames) : 1;
            return new RouteMotionTimeline(route, mode, (fromPoint) => {
                if (getPerPointFrames !== null && fromPoint.setting1 > 0 && totalLength > 0)
                    return totalLength / Math.max(1, getPerPointFrames(fromPoint));
                return baseSpeed;
            });
        };

        const spawnGenericObject = (): boolean => {
            const candidates = getObjFlowResourceNames(obj)
                .map((resource) => resource.replace(/\.brres$/i, ''))
                .filter((resource) => resource.length > 0);
            for (const resourceName of candidates) {
                try {
                    const rres = getRRES(resourceName);
                    const mdl0Name = rres.mdl0.find((model) => model.name === objName)?.name ?? rres.mdl0[0]?.name;
                    if (!mdl0Name)
                        continue;
                    spawnSimpleObject(resourceName, mdl0Name);
                    return true;
                } catch {
                }
            }
            return false;
        };

        const obj = renderer.commonCache.objFlow.objects[gobj.objectId];
        if (obj === undefined)
            return;

        const objName = obj.name;

        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }
        const clampIndex = (value: number, count: number): number => Math.max(0, Math.min(count - 1, value));

        if (objName === `Psea`) {
            const b1 = spawnSimpleObject(`Psea`, `Psea1sand`);
            const b2 = spawnSimpleObject(`Psea`, `Psea2dark`);
            const b3 = spawnSimpleObject(`Psea`, `Psea3nami`);
            const b4 = spawnSimpleObject(`Psea`, `Psea4tex`);
            const b5 = spawnSimpleObject(`Psea`, `Psea5spc`);
        } else if (objName === `lensFX`) {
            // Lens flare effect -- runtime determined, not a BRRES.
        } else if (objName === `sound_Mii`) {
            // sound generator
        } else if (objName === `skyship`) {
            spawnSimpleObject(`skyship`);
        } else if (objName === `itembox`) {
            const b = spawnSimpleObject(`itembox`);
            b.modelMatrix[13] += 20;
        } else if (objName === `sun`) {
            // TODO(jstpierre): Sun doesn't show up? Need to figure out what this is...
            spawnSimpleObject(`sun`);
        } else if (objName === `KmoonZ`) {
            spawnSimpleObject(`KmoonZ`);
        } else if (objName === `sunDS`) {
            spawnSimpleObject(`sunDS`);
        } else if (objName === `coin`) {
            const b = spawnSimpleObject(`coin`);
            b.modelMatrix[13] += 15;
            // pull it out the ground, doesn't spin still
        } else if (objName === `MashBalloonGC`) {
            spawnSimpleObject(`MashBalloonGC`);
        } else if (objName === `WLwallGC`) {
            spawnSimpleObject(`WLwallGC`);
        } else if (objName === `CarA1`) {
            spawnSimpleObject(`CarA1`);
        } else if (objName === `basabasa`) {
            spawnSimpleObject(`basabasa`);
        } else if (objName === `HeyhoShipGBA`) {
            spawnSimpleObject(`HeyhoShipGBA`);
        //} else if (objName === `kart_truck`) {
        //    spawnObject(`K_truck`);
        } else if (objName === `car_body`) {
            const rres = getRRES(`K_car_body`);
            const colorModelNames = ['K_car_b', 'K_car_r', 'K_car_y'] as const;
            const colorModelName = colorModelNames[clampIndex(gobj.objectArg3, colorModelNames.length)] ?? colorModelNames[0];
            const shadowInstance = createModelInstance(`K_car_body`, `K_car_body-shadow`);
            const bodyInstance = createModelInstance(`K_car_body`, colorModelName);
            const tireInstance = createModelInstance(`K_car_body`, `K_car_tire`);
            const lightInstance = createModelInstance(`K_car_body`, `K_car_light`);
            const carInstances = [shadowInstance, bodyInstance, tireInstance, lightInstance];
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, 'loop', (fromPoint) => {
                    const speed = fromPoint.setting2 === 1 ? gobj.objectArg2 : gobj.objectArg1;
                    return Math.max(1, speed);
                });
                const initialFrame = getRouteStartFrame(timeline, route, gobj.objectArg0);
                renderer.baseObjects.push(new RoutedCarRenderer(lightInstance, carInstances, rres, gobj, timeline, initialFrame));
            } else {
                spawnCompositeObject(carInstances);
            }
        } else if (objName === `skyship`) {
            spawnSimpleObject(`skyship`);
        } else if (objName === `penguin_s`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg0), (point) => point.setting1);
                renderer.baseObjects.push(new RoutedSingleModelRenderer(createModelInstance(`penguin_s`), gobj, timeline, true));
            } else {
                spawnSimpleObject(`penguin_s`);
            }
            // wiki says they should be creating a mirrored one below it, for the fake reflection but it isnt
        } else if (objName === `penguin_m`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg0), (point) => point.setting1);
                renderer.baseObjects.push(new RoutedSingleModelRenderer(createModelInstance(`penguin_m`), gobj, timeline, true));
            } else {
                spawnSimpleObject(`penguin_m`);
            }
        } else if (objName === `penguin_l`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg0), (point) => point.setting1);
                renderer.baseObjects.push(new RoutedSingleModelRenderer(createModelInstance(`penguin_l`), gobj, timeline, true));
            } else {
                spawnSimpleObject(`penguin_l`);
            }
        } else if (objName === `castleballoon1`) {
            spawnSimpleObject(`castleballoon1`);
        } else if (objName === `dossunc`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const rres = getRRES(`dossun`);
                const startDelayFrames = Math.max(0, gobj.objectArg2 - 240);
                if (gobj.objectArg1 === 2 && route.points.length >= 3) {
                    const pairInstances = [createModelInstance(`dossun`), createModelInstance(`dossun`)];
                    renderer.baseObjects.push(new RoutedDossunPairRenderer(pairInstances, rres, gobj, route, startDelayFrames, Math.max(12, gobj.objectArg3)));
                } else {
                    const timeline = createTimeline(
                        route,
                        makeMotionMode(route),
                        () => Math.max(1, gobj.objectArg0),
                        () => gobj.objectArg1 === 1 ? Math.max(12, gobj.objectArg3) : 0,
                    );
                    renderer.baseObjects.push(new RoutedDossunRenderer(createModelInstance(`dossun`), rres, gobj, timeline, startDelayFrames));
                }
            } else {
                spawnSimpleObject(`dossun`);
            }
        } else if (objName === `boble`) {
            spawnSimpleObject(`boble`);
        } else if (objName === `K_bomb_car`) {
            const bombInstances = [
                createModelInstance(`K_bomb_car`, `K_bomb_car-shadow`),
                createModelInstance(`K_bomb_car`, `K_bomb_car`),
                createModelInstance(`K_bomb_car`, `K_bomb_tire00`),
                createModelInstance(`K_bomb_car`, `Kbomneji`),
            ];
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, 'loop', (fromPoint) => {
                    const speed = fromPoint.setting2 === 1 ? gobj.objectArg2 : gobj.objectArg1;
                    return Math.max(1, speed);
                });
                const initialFrame = getRouteStartFrame(timeline, route, gobj.objectArg0);
                renderer.baseObjects.push(new RoutedMultiModelRenderer(bombInstances, gobj, timeline, true, 0, 0, initialFrame));
            } else {
                spawnCompositeObject(bombInstances);
            }
        //} else if (objName === `hanachan`) {
        //    spawnObject(`hanachan`);
            // only shows up as his head
        } else if (objName === `seagull`) {
            spawnSimpleObject(`seagull`);
        } else if (objName === `moray`) {
            spawnSimpleObject(`moray`);
        } else if (objName === `crab`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const rres = getRRES(`crab`);
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg0), (point) => point.setting1);
                renderer.baseObjects.push(new RoutedCrabRenderer(createModelInstance(`crab`), rres, gobj, timeline));
            } else {
                spawnSimpleObject(`crab`);
            }
        } else if (objName === `CarA2`) {
            spawnSimpleObject(`CarA2`);
        } else if (objName === `CarA3`) {
            spawnSimpleObject(`CarA3`);
        } else if (objName === `Hwanwan`) {
            const b = spawnSimpleObject(`wanwan`);
            scaleMatrix(b.modelMatrix, b.modelMatrix, 4);
            b.modelMatrix[13] += 125;
            // scales up and out of the ground to look closer to ingame
        } else if (objName === `Twanwan`) {
            const b = spawnSimpleObject(`Twanwan`);
            b.modelMatrix[13] += 150;
            // offset a bit so he fits into the pipe nicer.
        } else if (objName === `cruiserR`) {
            spawnSimpleObject(`cruiser`);
        } else if (objName === `bird`) {
            spawnSimpleObject(`bird`);
        } else if (objName === `dokan_sfc`) {
            spawnSimpleObject(`dokan_sfc`);
        } else if (objName === `castletree1`) {
            spawnSimpleObject(`castletree1`);
        } else if (objName === `castletree1c`) {
            spawnSimpleObject(`castletree1`);
        } else if (objName === `castletree2`) {
            spawnSimpleObject(`castletree2`);
        } else if (objName === `castleflower1`) {
            spawnSimpleObject(`castleflower1`);
        } else if (objName === `mariotreeGC`) {
            spawnSimpleObject(`mariotreeGC`);
        } else if (objName === `mariotreeGCc`) {
            spawnSimpleObject(`mariotreeGC`);
        } else if (objName === `donkytree1GC`) {
            spawnSimpleObject(`donkytree1GC`);
        } else if (objName === `donkytree2GC`) {
            spawnSimpleObject(`donkytree2GC`);
        } else if (objName === `peachtreeGC`) {
            spawnSimpleObject(`peachtreeGC`);
        } else if (objName === `peachtreeGCc`) {
            spawnSimpleObject(`peachtreeGC`);
        } else if (objName === `obakeblockSFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `WLarrowGC`) {
            spawnSimpleObject(`WLarrowGC`);
        } else if (objName === `WLscreenGC`) {
            spawnSimpleObject(`WLscreenGC`);
        } else if (objName === `WLdokanGC`) {
            spawnSimpleObject(`WLdokanGC`);
        } else if (objName === `MarioGo64c`) {
            spawnSimpleObject(`MarioGo64`);
        } else if (objName === `PeachHunsuiGC`) {
            spawnSimpleObject(`PeachHunsuiGC`);
        } else if (objName === `kinokoT1`) {
            spawnSimpleObject(`kinokoT1`);
        } else if (objName === `pylon01`) {
            const b = spawnSimpleObject(`pylon01`);
            const rres = getRRES(`pylon01`);
            b.modelInstance.bindCLR0(animFrame(gobj.objectArg0), assertExists(rres.clr0.find((clr0) => clr0.name === `pylon01`)));
        } else if (objName === `PalmTree`) {
            spawnSimpleObject(`PalmTree`);
        } else if (objName === `parasol`) {
            spawnSimpleObject(`parasol`);
        } else if (objName === `cruiser`) {
            spawnSimpleObject(`cruiser`);
        } else if (objName === `K_sticklift00`) {
            spawnSimpleObject(`K_sticklift00`);
        } else if (objName === `heyho2`) {
            spawnSimpleObject(`heyho2`);
        } else if (objName === `HeyhoTreeGBAc`) {
            spawnSimpleObject(`HeyhoTreeGBA`);
        } else if (objName === `truckChimSmk`) {
            spawnSimpleObject(`truckChimSmk`);
        } else if (objName === `MiiObj01`) {
            // Don't spawn the MiiObj's as they have placeholder textures for faces that don't look good.
            // spawnObject(`MiiObj01`);
        } else if (objName === `MiiObj02`) {
            // spawnObject(`MiiObj02`);
        } else if (objName === `MiiObj03`) {
            // spawnObject(`MiiObj03`);
        } else if (objName === `gardentreeDS`) {
            spawnSimpleObject(`gardentreeDS`);
        } else if (objName === `gardentreeDSc`) {
            spawnSimpleObject(`gardentreeDS`);
        } else if (objName === `FlagA1`) {
            spawnSimpleObject(`FlagA1`);
        } else if (objName === `FlagA2`) {
            spawnSimpleObject(`FlagA2`);
        } else if (objName === `FlagB1`) {
            spawnSimpleObject(`FlagB1`);
        } else if (objName === `FlagB2`) {
            spawnSimpleObject(`FlagB2`);
        } else if (objName === `FlagA3`) {
            spawnSimpleObject(`FlagA3`);
        } else if (objName === `DKtreeA64`) {
            spawnSimpleObject(`DKtreeA64`);
        } else if (objName === `DKtreeA64c`) {
            spawnSimpleObject(`DKtreeA64`);
        } else if (objName === `DKtreeB64`) {
            spawnSimpleObject(`DKtreeB64`);
        } else if (objName === `DKtreeB64c`) {
            spawnSimpleObject(`DKtreeB64`);
        } else if (objName === `TownTreeDSc`) {
            spawnSimpleObject(`TownTreeDS`);
        } else if (objName === `Piston`) {
            spawnSimpleObject(`Piston`);
        } else if (objName === `oilSFC`) {
            spawnSimpleObject(`oilSFC`);
        } else if (objName === `mii_balloon`) {
            spawnSimpleObject(`mii_balloon`);
        } else if (objName === `windmill`) {
            spawnSimpleObject(`windmill`);
        } else if (objName === `dossun`) {
            spawnSimpleObject(`dossun`);
        } else if (objName === `TownTreeDS`) {
            spawnSimpleObject(`TownTreeDS`);
        } else if (objName === `Ksticketc`) {
            spawnSimpleObject(`Ksticketc`);
        } else if (objName === `monte_a`) {
            spawnSimpleObject(`monte_a`);
        } else if (objName === `MiiStatueM1`) {
            spawnSimpleObject(`MiiStatueM1`);
        } else if (objName === `ShMiiObj01`) {
            spawnSimpleObject(`ShMiiObj01`);
        } else if (objName === `ShMiiObj02`) {
            spawnSimpleObject(`ShMiiObj02`);
        } else if (objName === `ShMiiObj03`) {
            spawnSimpleObject(`ShMiiObj03`);
        } else if (objName === `miiposter`) {
            spawnSimpleObject(`miiposter`);
        } else if (objName === `dk_miiobj00`) {
            spawnSimpleObject(`dk_miiobj00`);
        } else if (objName === `light_house`) {
            spawnSimpleObject(`light_house`);
        } else if (objName === `r_parasol`) {
            spawnSimpleObject(`r_parasol`);
        } else if (objName === `obakeblock2SFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `obakeblock3SFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `koopaFigure`) {
            spawnSimpleObject(`koopaFigure`);
        } else if (objName === `pukupuku`) {
            spawnSimpleObject(`pukupuku`);
        } else if (objName === `karehayama`) {
            spawnSimpleObject(`karehayama`);
        } else if (objName === `EarthRing`) {
            spawnSimpleObject(`EarthRing`);
        } else if (objName === `SpaceSun`) {
            spawnSimpleObject(`SpaceSun`);
        } else if (objName === `StarRing`) {
            spawnSimpleObject(`StarRing`);
        } else if (objName === `M_obj_kanban`) {
            spawnSimpleObject(`M_obj_kanban`);
        } else if (objName === `MiiStatueL1`) {
            spawnSimpleObject(`MiiStatueL1`);
        } else if (objName === `MiiStatueD1`) {
            spawnSimpleObject(`MiiStatueD1`);
        } else if (objName === `MiiSphinxY1`) {
            spawnSimpleObject(`MiiSphinxY1`);
        } else if (objName === `MiiSphinxY2`) {
            spawnSimpleObject(`MiiSphinxY2`);
        } else if (objName === `FlagA5`) {
            spawnSimpleObject(`FlagA5`);
        } else if (objName === `CarB`) {
            spawnSimpleObject(`CarB`);
        } else if (objName === `group_monte_a`) {
            spawnSimpleObject(`group_monte_a`);
        } else if (objName === `MiiStatueL2`) {
            spawnSimpleObject(`MiiStatueL2`);
        } else if (objName === `MiiStatueD2`) {
            spawnSimpleObject(`MiiStatueD2`);
        } else if (objName === `MiiStatueP1`) {
            spawnSimpleObject(`MiiStatueP1`);
        } else if (objName === `SentakuDS`) {
            spawnSimpleObject(`SentakuDS`);
        } else if (objName === `fks_screen_wii`) {
            spawnSimpleObject(`fks_screen_wii`);
        } else if (objName === `KoopaFigure64`) {
            spawnSimpleObject(`KoopaFigure64`);
        } else if (objName === `b_teresa`) {
            spawnSimpleObject(`b_teresa`);
        } else if (objName === `MiiKanban`) {
            spawnSimpleObject(`MiiKanban`);
        } else if (objName === `BGteresaSFC`) {
            spawnSimpleObject(`BGteresaSFC`);
        } else if (objName === `kuribo`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const rres = getRRES(`kuribo`);
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg1));
                renderer.baseObjects.push(new RoutedKuriboRenderer(createModelInstance(`kuribo`), rres, gobj, timeline));
            } else {
                const b = spawnSimpleObject(`kuribo`);
                const rres = getRRES(`kuribo`);
                b.modelInstance.bindCHR0(renderer.animationController, assertExists(rres.chr0.find((chr0) => chr0.name === 'walk_l')));
            }
        } else if (objName === `sin_itembox`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, 'restart', () => 1);
                renderer.baseObjects.push(new RoutedSinItemboxRenderer(createModelInstance(`itembox`), gobj, timeline, Math.max(1, gobj.objectArg0), gobj.objectArg4, 20));
            } else {
                const b = spawnSimpleObject(`itembox`);
                b.modelMatrix[13] += 20;
            }
        } else if (objName === `f_itembox`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const breakPointIndex = route.points.findIndex((point) => point.setting2 === 1);
                const activeRoute = breakPointIndex >= 1 ? sliceRoute(route, 0, breakPointIndex) : route;
                const timeline = createTimeline(activeRoute, 'restart', (fromPoint) => Math.max(1, fromPoint.setting1 || gobj.objectArg0));
                const initialFrame = getRouteStartFrame(timeline, activeRoute, gobj.objectArg4);
                renderer.baseObjects.push(new RoutedSingleModelRenderer(createModelInstance(`itembox`), gobj, timeline, false, 0, 20, initialFrame));
            } else {
                const b = spawnSimpleObject(`itembox`);
                b.modelMatrix[13] += 20;
            }
        } else if (objName === `w_itembox`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const count = Math.max(1, Math.min(32, gobj.objectArg6 || 1));
                const timeline = createTimeline(route, 'restart', (fromPoint) => Math.max(1, fromPoint.setting1 || gobj.objectArg0));
                const instances = Array.from({ length: count }, () => createModelInstance(`itembox`));
                renderer.baseObjects.push(new RoutedItemboxGroupRenderer(gobj, timeline, instances, Math.max(1, gobj.objectArg5), 20, gobj.objectArg4));
            } else {
                const b = spawnSimpleObject(`itembox`);
                b.modelMatrix[13] += 20;
            }
        } else if (objName === `w_itemboxline`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const pressPointIndex = route.points.findIndex((point) => point.setting2 === 1);
                const itemPointIndex = route.points.findIndex((point) => point.setting2 === 2);
                const count = Math.max(1, Math.min(32, gobj.objectArg6 || 1));
                if (pressPointIndex >= 1) {
                    const blockRoute = sliceRoute(route, 0, pressPointIndex);
                    const itemRoute = sliceRoute(route, itemPointIndex >= 0 ? itemPointIndex : pressPointIndex, route.points.length - 1);
                    const blockTimeline = createTimeline(blockRoute, 'restart', (fromPoint) => Math.max(1, fromPoint.setting1 || route.setting1 || gobj.objectArg0));
                    const itemTimeline = createTimeline(itemRoute, 'restart', (fromPoint) => Math.max(1, fromPoint.setting1 || gobj.objectArg0));
                    const blockInstances = Array.from({ length: count }, () => createModelInstance(`Block`, `Block`));
                    const itemInstances = Array.from({ length: count }, () => createModelInstance(`itembox`));
                    const pressInstance = createModelInstance(`Press`, `Press`);
                    renderer.baseObjects.push(new RoutedItemboxLineRenderer(gobj, blockTimeline, itemTimeline, blockInstances, itemInstances, pressInstance, Math.max(1, gobj.objectArg5), gobj.objectArg4));
                } else {
                    spawnSimpleObject(`Block`, `Block`);
                }
            } else {
                spawnSimpleObject(`Block`, `Block`);
            }
        } else if (objName === `choropu`) {
            spawnSimpleObject(`choropu`);
        } else if (objName === `cow`) {
            spawnSimpleObject(`cow`);
        } else if (objName === `pakkun_f`) {
            spawnSimpleObject(`pakkun_f`);
        } else if (objName === `WLfirebarGC`) {
            spawnSimpleObject(`WLfirebarGC`);
        } else if (objName === `wanwan`) {
            spawnSimpleObject(`wanwan`);
        } else if (objName === `poihana`) {
            const b = spawnSimpleObject(`poihana`);
            b.modelMatrix[13] += 25; // pull him out of the ground
        } else if (objName === `DKrockGC`) {
            spawnSimpleObject(`DKrockGC`);
        } else if (objName === `sanbo`) {
            const route = getRoute();
            if (route !== null && route.points.length >= 2) {
                const timeline = createTimeline(route, makeMotionMode(route), () => Math.max(1, gobj.objectArg0 || route.setting1 || 1));
                renderer.baseObjects.push(new RoutedSingleModelRenderer(createModelInstance(`sanbo`), gobj, timeline, true));
            } else {
                spawnSimpleObject(`sanbo`);
            }
        } else if (objName === `choropu2`) {
            spawnSimpleObject(`choropu`);
        } else if (objName === `TruckWagon`) {
            spawnSimpleObject(`TruckWagon`);
        } else if (objName === `heyho`) {
            spawnSimpleObject(`heyho`);
        } else if (objName === `Press`) {
            spawnSimpleObject(`Press`);
        } else if (objName === `WLfireringGC`) {
            spawnSimpleObject(`WLfirebarGC`);
        } else if (objName === `pakkun_dokan`) {
            spawnSimpleObject(`pakkun_dokan`);
        //} else if (objName === `begoman_spike`) {
        //    spawnSimpleObject(`begoman_spike`);
        } else if (objName === `FireSnake`) {
            spawnSimpleObject(`FireSnake`);
        } else if (objName === `koopaFirebar`) {
            spawnSimpleObject(`koopaFirebar`);
        } else if (objName === `Epropeller`) {
            spawnSimpleObject(`Epropeller`);
        } else if (objName === `FireSnake_v`) {
            spawnSimpleObject(`FireSnake`);
        } else if (objName === `puchi_pakkun`) {
            spawnSimpleObject(`puchi_pakkun`);
        //} else if (objName === `kinoko_ud`) {
        //    spawnObject(`kinoko`);
        } else if (objName === `kinoko_bend`) {
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_r`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_r`);
            } else {
                throw "whoops";
            }
        } else if (objName === `VolcanoRock1`) {
            spawnSimpleObject(`VolcanoRock1`);
        } else if (objName === `bulldozer_left`) {
            spawnSimpleObject(`bulldozer_left`);
        } else if (objName === `bulldozer_right`) {
            spawnSimpleObject(`bulldozer_right`);
        } else if (objName === `kinoko_nm`) {
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_g`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_g`);
            } else {
                throw "whoops";
            }
        } else if (objName === `Crane`) {
            spawnSimpleObject(`Crane`);
        } else if (objName === `VolcanoPiece`) {
            spawnSimpleObject(`VolcanoPiece1`, `VolcanoPiece${gobj.objectArg0}`);
        } else if (objName === `FlamePole`) {
            spawnSimpleObject(`FlamePole`);
        } else if (objName === `TwistedWay`) {
            spawnSimpleObject(`TwistedWay`);
        } else if (objName === `TownBridgeDSc`) {
            spawnSimpleObject(`TownBridgeDS`);
        } else if (objName === `DKship64`) {
            spawnSimpleObject(`DKship64`);
        } else if (objName === `DKturibashiGCc`) {
            spawnSimpleObject(`DKturibashiGC`);
        } else if (objName === `aurora`) {
            const aurora = new Aurora(createModelInstance(`aurora`), gobj);
            renderer.baseObjects.push(aurora);
        } else if (objName === `venice_saku`) {
            spawnSimpleObject(`venice_saku`);
        } else if (objName === `casino_roulette`) {
            spawnSimpleObject(`casino_roulette`);
        } else if (objName === `dc_sandcone`) {
            spawnSimpleObject(`dc_sandcone`);
        } else if (objName === `venice_hasi `) {
            spawnSimpleObject(`venice_hasi`);
        } else if (objName === `bblock`) {
            spawnSimpleObject(`bblock1`);
        } else if (objName === `ami`) {
            spawnSimpleObject(`ami`);
        } else if (objName === `RM_ring1`) {
            const ringNames = ['RM_ring1', 'RM_ring2', 'RM_ring3'];
            const ringName = ringNames[gobj.objectArg0 - 1];
            const b = spawnSimpleObject(`RM_ring1`, ringName);
            const rres = getRRES(`RM_ring1`);
            b.modelInstance.bindRRESAnimations(renderer.animationController, rres, ringName);
            b.modelInstance.bindCLR0(null, null);
        //} else if (objName === `FlamePole_v`) {
        //    spawnObject(`FlamePole_v`);
        } else if (objName === `InsekiA`) {
            spawnSimpleObject(`InsekiA`);
        } else if (objName === `InsekiB`) {
            spawnSimpleObject(`InsekiB`);
        //} else if (objName === `FlamePole_v_big`) {
        //    spawnObject(`FlamePole_v_big`);
        } else if (objName === `Mdush`) {
            spawnSimpleObject(`Mdush`);
        } else if (objName === `DonkyCannonGC`) {
            spawnSimpleObject(`DonkyCannonGC`);
        } else if (objName === `BeltEasy`) {
            spawnSimpleObject(`BeltEasy`);
        } else if (objName === `BeltCrossing`) {
            spawnSimpleObject(`BeltCrossing`);
        } else if (objName === `BeltCurveA`) {
            spawnSimpleObject(`BeltCurveA`);
        } else if (objName === `escalator`) {
            spawnSimpleObject(`escalator`);
        } else if (objName === `DonkyCannon_wii`) {
            spawnSimpleObject(`DonkyCannon_wii`);
        } else if (objName === `escalator_group`) {
            const left = spawnSimpleObject(`escalator`);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-1450, 250, -600]);
            const right = spawnSimpleObject(`escalator`);
            mat4.translate(right.modelMatrix, right.modelMatrix, [1450, 250, -600]);
        } else if (objName === `tree_cannon`) {
            spawnSimpleObject(`tree_cannon`);
        } else if (objName === `group_enemy_b`) {
            spawnSimpleObject(`group_enemy_b`);
        } else if (objName === `group_enemy_c`) {
            spawnSimpleObject(`group_enemy_c`);
        //} else if (objName === `taimatsu`) {
        //    spawnObject(`taimatsu`);
        } else if (objName === `truckChimSmkW`) {
            spawnSimpleObject(`truckChimSmkW`);
        } else if (objName === `dkmonitor`) {
            spawnSimpleObject(`dkmonitor`);
        } else if (objName === `group_enemy_a`) {
            spawnSimpleObject(`group_enemy_a`);
        } else if (objName === `FlagB3`) {
            spawnSimpleObject(`FlagB3`);
        } else if (objName === `spot`) {
            spawnSimpleObject(`spot`);
        } else if (objName === `FlagB4`) {
            spawnSimpleObject(`FlagB4`);
        } else if (objName === `group_enemy_e`) {
            spawnSimpleObject(`group_enemy_e`);
        } else if (objName === `group_monte_L`) {
            spawnSimpleObject(`group_monte_a`);
        } else if (objName === `group_enemy_f`) {
            spawnSimpleObject(`group_enemy_f`);
        //} else if (objName === `FallBsB`) {
        //    spawnObject(`FallBsB`);
        //} else if (objName === `volsmk`) {
        //    spawnObject(`volsmk`);
        } else if (objName === `ridgemii00`) {
            spawnSimpleObject(`ridgemii00`);
        } else if (objName === `Flash_L`) {
            // particle effect; unsupported
        } else if (objName === `MiiSignNoko`) {
            const b = spawnSimpleObject(`MiiSignNoko`);
            const rres = getRRES(`MiiSignNoko`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (objName === `UtsuboDokan`) {
            spawnSimpleObject(`UtsuboDokan`);
        } else if (objName === `Spot64`) {
            spawnSimpleObject(`Spot64`);
        //} else if (objName === `Fall_MH`) {
        //    spawnObject(`Fall_MH`);
        //} else if (objName === `Fall_Y`) {
        //    spawnObject(`Fall_Y`);
        } else if (objName === `MiiStatueM2`) {
            spawnSimpleObject(`MiiStatueM2`);
        } else if (objName === `RhMiiKanban`) {
            spawnSimpleObject(`RhMiiKanban`);
        } else if (objName === `MiiStatueL3`) {
            spawnSimpleObject(`MiiStatueL3`);
        } else if (objName === `MiiSignWario`) {
            const b = spawnSimpleObject(`MiiSignWario`);
            const rres = getRRES(`MiiSignWario`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (objName === `MiiStatueBL1`) {
            spawnSimpleObject(`MiiStatueBL1`);
        } else if (objName === `MiiStatueBD1`) {
            spawnSimpleObject(`MiiStatueBD1`);
        //} else if (objName === `Kamifubuki`) {
        //    spawnSimpleObject(`Kamifubuki`);
        } else if (objName === `Crescent64`) {
            spawnSimpleObject(`Crescent64`);
        } else if (objName === `MiiSighKino`) {
            const b = spawnSimpleObject(`MiiSighKino`);
            const rres = getRRES(`MiiSighKino`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (objName === `MiiObjD01`) {
            spawnSimpleObject(`MiiObjD01`);
        } else if (objName === `MiiObjD02`) {
            spawnSimpleObject(`MiiObjD02`);
        } else if (objName === `MiiObjD03`) {
            spawnSimpleObject(`MiiObjD03`);
        } else if (objName === `mare_a`) {
            spawnSimpleObject(`mare_a`);
        } else if (objName === `mare_b`) {
            spawnSimpleObject(`mare_b`);
        //} else if (objName === `DKfalls`) {
        //    spawnObject(`DKfalls`);
        } else {
            if (!spawnGenericObject())
                console.warn(`Unimplemented object ${hexzero(gobj.objectId, 4)}`);
        }
    }

    public static async createSceneFromU8Archive(context: SceneContext, arc: U8.U8Archive): Promise<MarioKartWiiRenderer> {
        const commonCache = await context.dataShare.ensureObject(`MarioKartWii/CommonCache`, async () => {
            const buffer = await context.dataFetcher.fetchData(`MarioKartWii/Race/Common.szs`);
            const commonArc = await loadSZS(buffer);
            const extraArcs: U8.U8Archive[] = [];
            try {
                const extractedAssetBuffer = await context.dataFetcher.fetchData(`MarioKartWii/Race/Course/ExtractedAssets.u8`);
                extraArcs.push(U8.parse(extractedAssetBuffer));
            } catch {
            }
            try {
                const previewDummyBuffer = await context.dataFetcher.fetchData(`MarioKartWii/Race/PreviewDummies.u8`);
                extraArcs.push(U8.parse(previewDummyBuffer));
            } catch {
            }
            return new CommonCache(commonArc, extraArcs);
        });

        const device = context.device;
        const kmp = parseKMP(assertExists(arc.findFileData(`./course.kmp`)));
        console.log(arc, kmp);
        const renderer = new MarioKartWiiRenderer(context, commonCache, arc, arc.findFileData(`./posteffect/posteffect.blight`) === null);
        const modelCache = renderer.modelCache, cache = renderer.renderHelper.renderCache;

        const courseRRES = modelCache.ensureRRES(device, renderer, `./course_model.brres`, arc.findFileData(`./course_model.brres`));
        const courseInstance = new CourseBGRenderer(this.createModelInstanceFromRRES(renderer, courseRRES, 'course'));
        courseInstance.modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
        renderer.baseObjects.push(courseInstance);
        mat4.copy(courseInstance.modelMatrix, posMtx);

        const skyboxRRES = modelCache.ensureRRES(device, renderer, `./vrcorn_model.brres`, arc.findFileData(`./vrcorn_model.brres`));
        const skyboxInstance = new CourseBGRenderer(this.createModelInstanceFromRRES(renderer, skyboxRRES, 'vrcorn'));
        skyboxInstance.modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
        renderer.baseObjects.push(skyboxInstance);
        mat4.copy(skyboxInstance.modelMatrix, posMtx);

        for (let i = 0; i < kmp.gobj.length; i++) {
            try {
                this.spawnObjectFromKMP(device, renderer, arc, kmp.gobj[i], kmp.poti);
            } catch (error) {
                console.warn(`Failed to spawn scene object ${hexzero(kmp.gobj[i].objectId, 4)}`, error);
            }
        }

        const blightData = arc.findFileData(`./posteffect/posteffect.blight`);
        if (blightData !== null) {
            const blightRes = parseBLIGHT(blightData);
            const eggLightManager = new EggLightManager(blightRes);
            renderer.eggLightManager = eggLightManager;
        }

        const bblmData = arc.findFileData(`./posteffect/posteffect.bblm`);
        if (bblmData !== null) {
            const bblmRes = parseBBLM(bblmData);
            const eggBloom = new EggDrawPathBloom(device, cache, bblmRes);
            renderer.eggBloom = eggBloom;
        }

        const bdofData = arc.findFileData(`./posteffect/posteffect.bdof`);
        if (bdofData !== null) {
            const bdofRes = parseBDOF(bdofData);
            const eggDOF = new EggDrawPathDOF(device, cache, bdofRes);
            renderer.eggDOF = eggDOF;
            renderer.setEditorDOFMode('off');

            const warpTex = arc.findFileData(`./posteffect/posteffect.bti`);
            if (warpTex !== null) {
                const warpTexBTIData = new BTIData(device, cache, BTI.parse(warpTex, `posteffect.bti`).texture);
                context.destroyablePool.push(warpTexBTIData);
                warpTexBTIData.fillTextureMapping(eggDOF.getIndTextureMapping());
            }
        }

        return renderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const courseSZS = await context.dataFetcher.fetchData(`MarioKartWii/Race/Course/${this.id}.szs`);
        return MarioKartWiiSceneDesc.createSceneFromU8Archive(context, await loadSZS(courseSZS));
    }
}

export async function createMarioKartWiiSceneFromU8Archive(context: SceneContext, arc: U8.U8Archive) {
    return MarioKartWiiSceneDesc.createSceneFromU8Archive(context, arc);
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
// Courses named and organized by Starschulz
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartWiiSceneDesc('beginner_course', "Luigi Circuit"),
    new MarioKartWiiSceneDesc('farm_course', "Moo Moo Meadows"),
    new MarioKartWiiSceneDesc('kinoko_course', "Mushroom Gorge"),
    new MarioKartWiiSceneDesc('factory_course', "Toad's Factory"),
    "Flower Cup",
    new MarioKartWiiSceneDesc('castle_course', "Mario Circuit"),
    new MarioKartWiiSceneDesc('shopping_course', "Coconut Mall"),
    new MarioKartWiiSceneDesc('boardcross_course', "DK Summit"),
    new MarioKartWiiSceneDesc('truck_course', "Wario's Gold Mine"),
    "Star Cup",
    new MarioKartWiiSceneDesc('senior_course', "Daisy Circuit"),
    new MarioKartWiiSceneDesc('water_course', "Koopa Cape"),
    new MarioKartWiiSceneDesc('treehouse_course', "Maple Treeway"),
    new MarioKartWiiSceneDesc('volcano_course', "Grumble Volcano"),
    "Special Cup",
    new MarioKartWiiSceneDesc('desert_course', "Dry Dry Ruins"),
    new MarioKartWiiSceneDesc('ridgehighway_course', "Moonview Highway"),
    new MarioKartWiiSceneDesc('koopa_course', "Bowser's Castle"),
    new MarioKartWiiSceneDesc('rainbow_course', "Rainbow Road"),
    "Shell Cup",
    new MarioKartWiiSceneDesc('old_peach_gc', "GCN Peach Beach"),
    new MarioKartWiiSceneDesc('old_falls_ds', "DS Yoshi Falls"),
    new MarioKartWiiSceneDesc('old_obake_sfc', "SNES Ghost Valley 2"),
    new MarioKartWiiSceneDesc('old_mario_64', "N64 Mario Raceway"),
    "Banana Cup",
    new MarioKartWiiSceneDesc('old_sherbet_64', "N64 Sherbet Land"),
    new MarioKartWiiSceneDesc('old_heyho_gba', "GBA Shy Guy Beach"),
    new MarioKartWiiSceneDesc('old_town_ds', "DS Delfino Square"),
    new MarioKartWiiSceneDesc('old_waluigi_gc', "GCN Waluigi Stadium"),
    "Leaf Cup",
    new MarioKartWiiSceneDesc('old_desert_ds', "DS Desert Hills"),
    new MarioKartWiiSceneDesc('old_koopa_gba', "GBA Bowser Castle 3"),
    new MarioKartWiiSceneDesc('old_donkey_64', "N64 DK's Jungle Parkway"),
    new MarioKartWiiSceneDesc('old_mario_gc', "GCN Mario Circuit"),
    "Lightning Cup",
    new MarioKartWiiSceneDesc('old_mario_sfc', "SNES Mario Circuit 3"),
    new MarioKartWiiSceneDesc('old_garden_ds', "DS Peach Gardens"),
    new MarioKartWiiSceneDesc('old_donkey_gc', "GCN DK Mountain"),
    new MarioKartWiiSceneDesc('old_koopa_64', "N64 Bowser's Castle"),
    "Battle Courses",
    new MarioKartWiiSceneDesc('block_battle', "Block Plaza"),
    new MarioKartWiiSceneDesc('venice_battle', "Delfino Pier"),
    new MarioKartWiiSceneDesc('skate_battle', "Funky Stadium"),
    new MarioKartWiiSceneDesc('casino_battle', "Chain Chomp Wheel"),
    new MarioKartWiiSceneDesc('sand_battle', "Thwomp Desert"),
    new MarioKartWiiSceneDesc('old_battle4_sfc', "SNES Battle Course 4"),
    new MarioKartWiiSceneDesc('old_battle3_gba', "GBA Battle Course 3"),
    new MarioKartWiiSceneDesc('old_matenro_64', "N64 Skyscraper"),
    new MarioKartWiiSceneDesc('old_CookieLand_gc', "GCN Cookie Land"),
    new MarioKartWiiSceneDesc('old_House_ds', "DS Twilight House"),
    "Extra",
    new MarioKartWiiSceneDesc('ring_mission', "Galaxy Colosseum"),
    new MarioKartWiiSceneDesc('ending_demo', "Luigi Circuit (Credits)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
