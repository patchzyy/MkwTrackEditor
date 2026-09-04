
import * as BRRES from './brres.js';

import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import AnimationController from "../AnimationController.js";
import { Camera, computeViewSpaceDepthFromWorldSpaceAABB, texProjCameraSceneTex } from "../Camera.js";
import { Color, colorCopy } from '../Color.js';
import { drawWorldSpaceLine, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { AABB, IntersectionState } from "../Geometry.js";
import { GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers.js';
import { GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxTexture, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { arrayCopy } from '../gfx/platform/GfxPlatformObjUtil.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyBias, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout } from '../gx/gx_displaylist.js';
import * as GX from '../gx/gx_enum.js';
import * as GX_Material from '../gx/gx_material.js';
import { ColorKind, createInputLayout, DrawParams, GXMaterialHelperGfx, GXTextureHolder, GXTextureMapping, loadedDataCoalescerComboGfx, loadTextureFromMipChain, MaterialParams, translateTexFilterGfx, translateWrapModeGfx } from "../gx/gx_render.js";
import { calcMipChain } from '../gx/gx_texture.js';
import { CalcBillboardFlags, calcBillboardMatrix, computeNormalMatrix, getMatrixAxisY, texEnvMtx } from '../MathHelpers.js';
import { assert, assertExists, nArray } from '../util.js';
import { ViewerRenderInput } from "../viewer.js";

export class RRESTextureHolder extends GXTextureHolder {
    public addRRESTextures(device: GfxDevice, rres: BRRES.RRES): void {
        for (let i = 0; i < rres.tex0.length; i++)
            this.addTexture(device, rres.tex0[i]);
    }
}

class InstanceStateData {
    public jointToWorldMatrixVisibility: IntersectionState[] = [];
    public jointToWorldMatrixArray: mat4[] = [];
    public jointToWorldMatrixAttribs: BRRES.BillboardMode[] = [];
    public drawViewMatrixArray: mat4[] = [];
    public lightSetting: BRRES.LightSetting | null = null;
}

export class ResFileData {
    public mdl0: MDL0Model[] = [];
    public tex0: GfxTexture[] = [];

    constructor(renderCache: GfxRenderCache, public rres: BRRES.RRES) {
        const device = renderCache.device;
        for (let i = 0; i < rres.mdl0.length; i++) {
            const modelData = new MDL0Model(device, renderCache, rres.mdl0[i]);
            this.mdl0.push(modelData);
        }

        for (let i = 0; i < rres.tex0.length; i++) {
            const mipChain = calcMipChain(rres.tex0[i], rres.tex0[i].mipCount);
            const texture = loadTextureFromMipChain(device, mipChain);
            this.tex0.push(texture.gfxTexture);
        }
    }

    public getTexture(name: string): GfxTexture | null {
        for (let i = 0; i < this.rres.tex0.length; i++)
            if (this.rres.tex0[i].name === name)
                return this.tex0[i];
        return null;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.mdl0.length; i++)
            this.mdl0[i].destroy(device);
        for (let i = 0; i < this.tex0.length; i++)
            device.destroyTexture(this.tex0[i]);
    }
}

const matrixScratch = mat4.create();
class MaterialData {
    public textureMappings: GXTextureMapping[];

    constructor(cache: GfxRenderCache, public material: BRRES.MDL0_MaterialEntry, public materialHacks?: GX_Material.GXMaterialHacks) {
        this.textureMappings = nArray(8, () => new GXTextureMapping());

        for (let i = 0; i < this.textureMappings.length; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const isNoMip = sampler.minFilter === GX.TexFilter.LINEAR || sampler.minFilter === GX.TexFilter.NEAR;
            const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
            const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

            // In RRES, the minLOD / maxLOD are in the texture, not the sampler.

            const gfxSampler = cache.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter, mipFilter, magFilter,
                minLOD: 0,
                maxLOD: isNoMip ? 0 : 100,
            });

            this.textureMappings[i].gfxSampler = gfxSampler;
        }
    }

    public bindResFile(resFile: ResFileData): void {
        for (let i = 0; i < 8; i++) {
            if (this.textureMappings[i].gfxTexture)
                continue;

            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const texture = resFile.getTexture(sampler.name);
            if (texture !== null)
                this.textureMappings[i].gfxTexture = texture;
        }
    }

    public bindTextureHolder(textureHolder: GXTextureHolder): void {
        for (let i = 0; i < 8; i++) {
            if (this.textureMappings[i].gfxTexture)
                continue;

            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            textureHolder.fillTextureMapping(this.textureMappings[i], sampler.name);
        }
    }
}

class ShapeData {
    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache, private loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData, public vertexBuffers: GfxVertexBufferDescriptor[], public indexBuffer: GfxIndexBufferDescriptor) {
        this.inputLayout = createInputLayout(cache, this.loadedVertexLayout);
    }
}

export class MDL0Model {
    public shapeData: ShapeData[] = [];
    public materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;
    // Editor extension: remembered so a material replaced later can be re-bound to the same
    // texture source the model was originally loaded against.
    private boundResFile: ResFileData | null = null;
    private boundTextureHolder: GXTextureHolder | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, public mdl0: BRRES.MDL0, private materialHacks?: GX_Material.GXMaterialHacks) {
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.mdl0.shapes.map((shape) => shape.loadedVertexData));

        for (let i = 0; i < this.mdl0.shapes.length; i++) {
            const shape = this.mdl0.shapes[i];
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[i];
            this.shapeData.push(new ShapeData(cache, shape.loadedVertexLayout, shape.loadedVertexData, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer));
        }

        for (let i = 0; i < this.mdl0.materials.length; i++) {
            const material = this.mdl0.materials[i];
            this.materialData.push(new MaterialData(cache, material, this.materialHacks));
        }
    }

    public bindResFile(resFile: ResFileData): void {
        this.boundResFile = resFile;
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].bindResFile(resFile);
    }

    public bindTextureHolder(textureHolder: GXTextureHolder): void {
        this.boundTextureHolder = textureHolder;
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].bindTextureHolder(textureHolder);
    }

    /**
     * Editor extension: swaps one material's uploaded state for a freshly parsed MDL0 material
     * entry, without touching the vertex buffers or the rest of the model.
     *
     * Only the `MaterialData` is replaced here — the per-instance `MaterialInstance`s that already
     * reference the old one keep their copy of the old `GXMaterial` until
     * `MDL0ModelInstance.replaceMaterial` is called for the same index. Samplers and programs come
     * from the shared `GfxRenderCache`, which owns and dedupes them, so the discarded
     * `MaterialData` needs no destroy.
     */
    public replaceMaterial(device: GfxDevice, cache: GfxRenderCache, index: number, entry: BRRES.MDL0_MaterialEntry): boolean {
        if (index < 0 || index >= this.materialData.length)
            return false;
        const materialData = new MaterialData(cache, entry, this.materialHacks);
        if (this.boundResFile !== null)
            materialData.bindResFile(this.boundResFile);
        if (this.boundTextureHolder !== null)
            materialData.bindTextureHolder(this.boundTextureHolder);
        this.materialData[index] = materialData;
        this.mdl0.materials[index] = entry;
        return true;
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
    }
}

const bboxScratch = new AABB();
const drawParams = new DrawParams();
const editorOverrideScratch = mat4.create();

// Editor extension: lets a host application hide, transform or split an individual draw
// call without touching the rest of the model. Used by the MKW track editor's Model mode.
export interface ShapeInstanceEditorComponentDraw {
    indexBuffer: GfxIndexBufferDescriptor;
    indexCount: number;
    /** Extra world-space matrix applied on top of the shape's node matrix. */
    extraWorldMatrix: mat4 | null;
    hidden: boolean;
}

/** An additional copy of a shape, drawn again somewhere else. */
export interface ShapeInstanceEditorCopyDraw {
    /** null draws the shape's own index ranges; otherwise just one connected component. */
    indexBuffer: GfxIndexBufferDescriptor | null;
    indexCount: number;
    /** Extra world-space matrix applied on top of the shape's node matrix. */
    extraWorldMatrix: mat4;
}

export interface ShapeInstanceEditorOverride {
    hidden: boolean;
    /** Extra world-space matrix applied on top of the shape's node matrix. */
    extraWorldMatrix: mat4 | null;
    /** When set, the shape is drawn as N separate index ranges instead of its own draws. */
    componentDraws: ShapeInstanceEditorComponentDraw[] | null;
    /**
     * Extra copies of this shape. Duplicating a mesh in the editor costs one more draw call and
     * no extra vertex data, and the copies survive the original being hidden or deleted.
     */
    copyDraws: ShapeInstanceEditorCopyDraw[] | null;
}

class ShapeInstance {
    public sortKeyBias = 0;
    public editorOverride: ShapeInstanceEditorOverride | null = null;

    constructor(public shape: BRRES.MDL0_ShapeEntry, public shapeData: ShapeData, public sortVizNode: BRRES.MDL0_NodeEntry, public materialInstance: MaterialInstance) {
    }

    private fillEditorPosMtx(dst: mat4, extraWorldMatrix: mat4 | null, camera: Camera, instanceStateData: InstanceStateData): void {
        if (extraWorldMatrix === null) {
            mat4.copy(dst, instanceStateData.drawViewMatrixArray[this.shape.mtxIdx]);
            return;
        }
        mat4.mul(editorOverrideScratch, extraWorldMatrix, instanceStateData.jointToWorldMatrixArray[this.shape.mtxIdx]);
        mat4.mul(dst, camera.viewMatrix, editorOverrideScratch);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, depth: number, camera: Camera, instanceStateData: InstanceStateData): void {
        const materialInstance = this.materialInstance;

        if (!materialInstance.visible || !materialInstance.materialHelper.valid)
            return;

        const editorOverride = this.editorOverride;
        const editorHidden = editorOverride !== null && editorOverride.hidden;
        const editorCopies = editorOverride !== null && editorOverride.copyDraws !== null && editorOverride.copyDraws.length > 0
            ? editorOverride.copyDraws
            : null;
        // A hidden shape still draws its copies: "duplicate it, then delete the original" has to
        // leave the copy standing.
        if (editorHidden && editorCopies === null)
            return;

        const template = renderInstManager.pushTemplate();
        template.sortKey = materialInstance.sortKey;
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.sortKey = setSortKeyBias(template.sortKey, this.sortKeyBias);
        template.setVertexInput(this.shapeData.inputLayout, this.shapeData.vertexBuffers, this.shapeData.indexBuffer);

        materialInstance.setOnRenderInst(renderInstManager.gfxRenderCache, template);

        const usesSkinning = this.shape.mtxIdx < 0;
        assert(usesSkinning === materialInstance.usesSkinning);

        if (!usesSkinning)
            materialInstance.fillMaterialParams(template, instanceStateData, this.shape.mtxIdx, null, camera);

        // Editor extension: draw the shape as independent connected components so each one
        // can carry its own transform / visibility.
        if (editorCopies !== null && !usesSkinning)
            this.drawEditorCopies(renderInstManager, editorCopies, camera, instanceStateData);

        if (editorHidden) {
            renderInstManager.popTemplate();
            return;
        }

        if (editorOverride !== null && editorOverride.componentDraws !== null && !usesSkinning) {
            for (let p = 0; p < editorOverride.componentDraws.length; p++) {
                const componentDraw = editorOverride.componentDraws[p];
                if (componentDraw.hidden || componentDraw.indexCount === 0)
                    continue;
                drawParams.clear();
                this.fillEditorPosMtx(drawParams.u_PosMtx[0], componentDraw.extraWorldMatrix ?? editorOverride.extraWorldMatrix, camera, instanceStateData);
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.shapeData.inputLayout, this.shapeData.vertexBuffers, componentDraw.indexBuffer);
                materialInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
                renderInst.setDrawCount(componentDraw.indexCount, 0);
                renderInstManager.submitRenderInst(renderInst);
            }
            renderInstManager.popTemplate();
            return;
        }

        drawParams.clear();
        for (let p = 0; p < this.shape.loadedVertexData.draws.length; p++) {
            const draw = this.shape.loadedVertexData.draws[p];

            let instVisible = false;
            if (usesSkinning) {
                for (let j = 0; j < draw.posMatrixTable.length; j++) {
                    const posNrmMatrixIdx = draw.posMatrixTable[j];

                    // Leave existing matrix.
                    if (posNrmMatrixIdx === 0xFFFF)
                        continue;

                    mat4.copy(drawParams.u_PosMtx[j], instanceStateData.drawViewMatrixArray[posNrmMatrixIdx]);

                    if (instanceStateData.jointToWorldMatrixVisibility[j] !== IntersectionState.Outside)
                        instVisible = true;
                }
            } else {
                instVisible = true;
                this.fillEditorPosMtx(drawParams.u_PosMtx[0], editorOverride !== null ? editorOverride.extraWorldMatrix : null, camera, instanceStateData);
            }

            if (!instVisible)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            materialInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);

            if (usesSkinning)
                materialInstance.fillMaterialParams(renderInst, instanceStateData, this.shape.mtxIdx, draw, camera);

            renderInst.setDrawCount(draw.indexCount, draw.indexOffset);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    /** Editor extension: re-draws the shape once per copy, each with its own world matrix. */
    private drawEditorCopies(renderInstManager: GfxRenderInstManager, copies: ShapeInstanceEditorCopyDraw[], camera: Camera, instanceStateData: InstanceStateData): void {
        const materialInstance = this.materialInstance;
        for (let i = 0; i < copies.length; i++) {
            const copy = copies[i];
            drawParams.clear();
            this.fillEditorPosMtx(drawParams.u_PosMtx[0], copy.extraWorldMatrix, camera, instanceStateData);

            if (copy.indexBuffer !== null) {
                if (copy.indexCount === 0)
                    continue;
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setVertexInput(this.shapeData.inputLayout, this.shapeData.vertexBuffers, copy.indexBuffer);
                materialInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
                renderInst.setDrawCount(copy.indexCount, 0);
                renderInstManager.submitRenderInst(renderInst);
                continue;
            }

            for (let p = 0; p < this.shape.loadedVertexData.draws.length; p++) {
                const draw = this.shape.loadedVertexData.draws[p];
                const renderInst = renderInstManager.newRenderInst();
                materialInstance.materialHelper.allocateDrawParamsDataOnInst(renderInst, drawParams);
                renderInst.setDrawCount(draw.indexCount, draw.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            }
        }
    }
}

function mat4SwapTranslationColumns(m: mat4): void {
    const tx = m[12];
    m[12] = m[8];
    m[8] = tx;
    const ty = m[13];
    m[13] = m[9];
    m[9] = ty;
}

function colorChannelCopy(o: Readonly<GX_Material.ColorChannelControl>): GX_Material.ColorChannelControl {
    const { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction } = o;
    return { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction };
}

function lightChannelCopy(o: Readonly<GX_Material.LightChannelControl>): GX_Material.LightChannelControl {
    const colorChannel = colorChannelCopy(o.colorChannel);
    const alphaChannel = colorChannelCopy(o.alphaChannel);
    return { colorChannel, alphaChannel };
}

function findAnimationData_PAT0(pat0: BRRES.PAT0, materialName: string, texMapID: GX.TexMapID) {
    const matData = pat0.matAnimations.find((m) => m.materialName === materialName);
    if (matData === undefined)
        return null;

    const texData = matData.texAnimations[texMapID];
    if (texData === undefined)
        return null;

    return texData;
}

const materialParams = new MaterialParams();

/**
 * Course fog, as the Mario Kart Wii scene reads it out of `posteffect/posteffect.bfg`.
 *
 * `startZ`/`endZ` are distances from the camera in *scene* units (the MKWii scene draws the
 * course at 0.1x, so a KMP-unit distance has to be scaled before it gets here). This is real
 * per-material GX fog: the values end up in `ub_MaterialParams`' `FogBlock` and the generated
 * fragment shader mixes towards `Color`. Nothing is drawn as a screen-space pass.
 */
export interface RRESFogSettings {
    /** GX fog type. `GX.FogType.NONE` is not a valid member here — pass `null` instead. */
    type: GX.FogType;
    startZ: number;
    endZ: number;
    color: Color;
}

/**
 * Fills the A/B/C terms of a `FogBlock`.
 *
 * This is `GX_Material.fogBlockSet`'s perspective case, with two deliberate differences:
 *
 * - It tolerates an infinite far plane. noclip's viewer installs one (`Camera.setClipPlanes(5)`
 *   leaves `far === Infinity`), which trips `fogBlockSet`'s `assert(Number.isFinite(farZ))`.
 *   The terms used here are that function's limit as `far` goes to infinity: `A -> near / range`
 *   and `B -> 1`, which is exactly right for the reversed infinite projection the viewer builds.
 * - It always uses the perspective mapping, even for the `ORTHO_*` fog types. The viewport camera
 *   is always perspective, so the perspective depth mapping is the correct one; the ortho types
 *   still select their own fog *curve*, because the shader masks the type with 0x07 and the two
 *   families share those low bits.
 */
function fillFogBlockParams(dst: GX_Material.FogBlock, fog: RRESFogSettings, camera: Camera): void {
    const near = camera.near;
    const far = camera.far;
    // A zero-width band is a division by zero. Collapse it to a hair's width so the fog reads as
    // a hard cut at startZ rather than as NaN, which would blank the pixel.
    const range = fog.endZ - fog.startZ;
    const denom = Math.abs(range) < 1e-5 ? (range < 0 ? -1e-5 : 1e-5) : range;

    if (Number.isFinite(far)) {
        dst.A = (far * near) / ((far - near) * denom);
        dst.B = far / (far - near);
    } else {
        dst.A = near / denom;
        dst.B = 1.0;
    }
    dst.C = fog.startZ / denom;
    dst.AdjCenter = 0;
}

class MaterialInstance {
    private srt0Animators: (BRRES.SRT0TexMtxAnimator | null)[] = [];
    private pat0Animators: (BRRES.PAT0TexAnimator | null)[] = [];
    private clr0Animators: (BRRES.CLR0ColorAnimator | null)[] = [];
    public materialHelper: GXMaterialHelperGfx;
    public sortKey: number = 0;
    /** Editor extension: the last layer `setSortKeyLayer` was given, before the translucent bit. */
    public sortKeyLayer: number = GfxRendererLayer.OPAQUE;
    public visible = true;
    public usesSkinning = false;
    private fogSettings: RRESFogSettings | null = null;

    /** Editor extension: the fog this instance was last given, so a replacement can inherit it. */
    public getFogSettings(): RRESFogSettings | null {
        return this.fogSettings;
    }

    constructor(private modelInstance: MDL0ModelInstance, public materialData: MaterialData) {
        const material = this.materialData.material;

        // Create a copy of the GX material, so we can patch in custom channel controls without affecting the original.
        const gxMaterial = Object.assign({}, material.gxMaterial);
        gxMaterial.lightChannels = arrayCopy(gxMaterial.lightChannels, lightChannelCopy);
        gxMaterial.useTexMtxIdx = nArray(8, () => false);
        // `Object.assign` is shallow, so `ropInfo` would still be the MDL0 material's own object,
        // shared with every other instance of this model. Fog is set per instance, so copy it.
        gxMaterial.ropInfo = Object.assign({}, gxMaterial.ropInfo);

        this.materialHelper = new GXMaterialHelperGfx(gxMaterial, materialData.materialHacks);
        const layer = this.materialData.material.translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setUsesSkinning(v: boolean): void {
        if (this.usesSkinning === v)
            return;

        this.usesSkinning = v;
        let changed = false;
        for (let i = 0; i < this.materialData.material.texSrts.length; i++) {
            const mapMode = this.materialData.material.texSrts[i].mapMode;
            if (mapMode === BRRES.MapMode.ENV_CAMERA || mapMode === BRRES.MapMode.ENV_SPEC || mapMode === BRRES.MapMode.ENV_LIGHT) {
                this.materialHelper.material.useTexMtxIdx![i] = this.usesSkinning;
                changed = true;
            }
        }

        if (changed)
            this.materialHelper.createProgram();
    }

    public setSortKeyLayer(layer: number): void {
        // Editor extension: remembered so a replacement instance can be put on the same layer.
        this.sortKeyLayer = layer;
        if (this.materialData.material.translucent)
            layer |= GfxRendererLayer.TRANSLUCENT;
        this.sortKey = makeSortKey(layer);
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(materialHacks);
    }

    /**
     * Turns GX fog on (or off, with `null`) for this material.
     *
     * Whether the material has a fog block at all is baked into the generated shader and into the
     * size of `ub_MaterialParams`, so changing the fog *type* has to invalidate the material —
     * the same dance `fillMaterialParamsData` does when a light set appears or disappears.
     * Changing only the distances or the colour is free: those are uniforms.
     */
    public setFogSettings(fog: RRESFogSettings | null): void {
        this.fogSettings = fog;
        const type = fog !== null ? fog.type : GX.FogType.NONE;
        const material = this.materialHelper.material;
        if (material.ropInfo.fogType === type)
            return;
        material.ropInfo.fogType = type;
        material.hasFogBlock = undefined;
        this.materialHelper.invalidateMaterial();
    }

    public bindSRT0(animationController: AnimationController | null, srt0: BRRES.SRT0 | null): void {
        if (srt0 !== null) {
            const material = this.materialData.material;
            for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++) {
                const srtAnimator = BRRES.bindSRT0Animator(assertExists(animationController), srt0, material.name, i);
                if (srtAnimator)
                    this.srt0Animators[i] = srtAnimator;
            }
        } else {
            for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++)
                this.srt0Animators[i] = null;
        }
    }

    public bindPAT0(animationController: AnimationController | null, pat0: BRRES.PAT0 | null): void {
        if (pat0 !== null) {
            const material = this.materialData.material;
            for (let i = 0; i < 8; i++) {
                const pat0Data = findAnimationData_PAT0(pat0, material.name, i);
                if (pat0Data === null)
                    continue;

                const patAnimator = new BRRES.PAT0TexAnimator(assertExists(animationController), pat0, pat0Data, this.modelInstance);
                this.pat0Animators[i] = patAnimator;
            }
        } else {
            for (let i = 0; i < 8; i++)
                this.pat0Animators[i] = null;
        }
    }

    public bindCLR0(animationController: AnimationController | null, clr0: BRRES.CLR0 | null): void {
        if (clr0 !== null) {
            const material = this.materialData.material;
            for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++) {
                const clrAnimator = BRRES.bindCLR0Animator(assertExists(animationController), clr0, material.name, i);
                if (clrAnimator)
                    this.clr0Animators[i] = clrAnimator;
            }
        } else {
            for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++)
                this.clr0Animators[i] = null;
        }
    }

    public calcIndTexMatrix(dst: mat4, indIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.IND0 + indIdx;

        let a: number, b: number, c: number, d: number, tx: number, ty: number, scale: number;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx]!.calcIndTexMtx(dst);
            a = dst[0], c = dst[4], tx = dst[12], scale = 1.0;
            b = dst[1], d = dst[5], ty = dst[13];
        } else {
            const mtx = material.indTexMatrices[indIdx];
            a = mtx[0], c = mtx[1], tx = mtx[2], scale = mtx[3];
            b = mtx[4], d = mtx[5], ty = mtx[6];
        }

        mat4.set(dst,
            a,     b,  0, 0,
            c,     d,  0, 0,
            tx,    ty, 0, 0,
            scale, 0,  0, 0,
        );
    }

    public calcTexAnimMatrix(dst: mat4, texIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.TEX0 + texIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx]!.calcTexMtx(dst);
        } else {
            mat4.copy(dst, material.texSrts[texMtxIdx].srtMtx);
        }
    }

    private calcTexMatrix(materialParams: MaterialParams, texIdx: number, camera: Camera): void {
        const material = this.materialData.material;
        const texSrt = material.texSrts[texIdx];
        const flipY = materialParams.m_TextureMapping[texIdx].flipY;
        const flipYScale = flipY ? -1.0 : 1.0;
        const dstPost = materialParams.u_PostTexMtx[texIdx];

        // Fast path.
        if (texSrt.mapMode === BRRES.MapMode.TEXCOORD) {
            this.calcTexAnimMatrix(dstPost, texIdx);
            return;
        }

        if (texSrt.mapMode === BRRES.MapMode.PROJECTION) {
            texProjCameraSceneTex(dstPost, camera.projectionMatrix, flipYScale);

            // Apply effect matrix.
            mat4.mul(dstPost, texSrt.effectMtx, dstPost);

            // XXX(jstpierre): ZSS hack. Reference camera 31 is set up by the game to be an overhead
            // camera for clouds. Kill it until we can emulate the camera system in this game...
            // XXX(jstpierre): Klonoa uses camera 1 for clouds.
            if (texSrt.refCamera === 31 || texSrt.refCamera === 1) {
                dstPost[0] = 0;
                dstPost[5] = 0;
            }
        } else if (texSrt.mapMode === BRRES.MapMode.ENV_CAMERA) {
            mat4.set(dstPost,
                0.5, 0.0, 0.0, 0.0,
                0.0, -0.5 * flipYScale, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.5, 0.5, 1.0, 1.0,
            );

            // Apply effect matrix.
            mat4.mul(dstPost, texSrt.effectMtx, dstPost);
        } else {
            mat4.identity(dstPost);
        }

        // Calculate SRT.
        this.calcTexAnimMatrix(matrixScratch, texIdx);

        // SRT matrices have translation in fourth component, but we want our matrix to have translation
        // in third component. Swap.
        mat4SwapTranslationColumns(matrixScratch);

        mat4.mul(dstPost, matrixScratch, dstPost);
    }

    private calcColor(materialParams: MaterialParams, i: ColorKind, fallbackColor: Color, a: BRRES.AnimatableColor | -1): void {
        const dst = materialParams.u_Color[i];
        let color: Color;
        if (this.modelInstance && this.modelInstance.colorOverrides[i]) {
            color = this.modelInstance.colorOverrides[i];
        } else {
            color = fallbackColor;
        }

        if (this.clr0Animators[a]) {
            this.clr0Animators[a]!.calcColor(dst, color);
        } else {
            colorCopy(dst, color);
        }
    }

    private fillMaterialParamsData(materialParams: MaterialParams, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, draw: LoadedVertexDraw | null = null, camera: Camera): void {
        const material = this.materialData.material;

        for (let i = 0; i < 8; i++) {
            const m = materialParams.m_TextureMapping[i];
            m.reset();

            const sampler = material.samplers[i];
            if (!sampler)
                continue;

            const animator = this.pat0Animators[i];
            if (animator) {
                animator.fillTextureMapping(m);
                m.gfxSampler = this.materialData.textureMappings[i].gfxSampler;
            } else {
                m.copy(this.materialData.textureMappings[i]);
            }

            m.lodBias = sampler.lodBias;
        }

        // Fill in our environment mapped texture matrices.
        for (let i = 0; i < 10; i++) {
            let texMtxIdx: number;
            if (draw !== null) {
                texMtxIdx = draw.texMatrixTable[i];

                // Don't bother computing a normal matrix if the matrix is unused.
                if (texMtxIdx === 0xFFFF)
                    continue;
            } else {
                texMtxIdx = posNrmMatrixIdx;
            }

            computeNormalMatrix(materialParams.u_TexMtx[i], instanceStateData.drawViewMatrixArray[texMtxIdx]);
        }

        for (let i = 0; i < 8; i++)
            this.calcTexMatrix(materialParams, i, camera);
        for (let i = 0; i < 3; i++)
            this.calcIndTexMatrix(materialParams.u_IndTexMtx[i], i);

        this.calcColor(materialParams, ColorKind.MAT0, material.colorMatRegs[0], BRRES.AnimatableColor.MAT0);
        this.calcColor(materialParams, ColorKind.MAT1, material.colorMatRegs[1], BRRES.AnimatableColor.MAT1);
        this.calcColor(materialParams, ColorKind.AMB0, material.colorAmbRegs[0], BRRES.AnimatableColor.AMB0);
        this.calcColor(materialParams, ColorKind.AMB1, material.colorAmbRegs[1], BRRES.AnimatableColor.AMB1);

        this.calcColor(materialParams, ColorKind.K0, material.colorConstants[0], BRRES.AnimatableColor.K0);
        this.calcColor(materialParams, ColorKind.K1, material.colorConstants[1], BRRES.AnimatableColor.K1);
        this.calcColor(materialParams, ColorKind.K2, material.colorConstants[2], BRRES.AnimatableColor.K2);
        this.calcColor(materialParams, ColorKind.K3, material.colorConstants[3], BRRES.AnimatableColor.K3);

        this.calcColor(materialParams, ColorKind.CPREV, material.colorRegisters[0], -1);
        this.calcColor(materialParams, ColorKind.C0, material.colorRegisters[1], BRRES.AnimatableColor.C0);
        this.calcColor(materialParams, ColorKind.C1, material.colorRegisters[2], BRRES.AnimatableColor.C1);
        this.calcColor(materialParams, ColorKind.C2, material.colorRegisters[3], BRRES.AnimatableColor.C2);

        const lightSetting = instanceStateData.lightSetting;
        if (lightSetting !== null) {
            const lightSet = lightSetting.lightSet[this.materialData.material.lightSetIdx];
            if (lightSet !== undefined) {
                lightSet.calcLights(materialParams.u_Lights, lightSetting, camera.viewMatrix);
                lightSet.calcAmbColorCopy(materialParams.u_Color[ColorKind.AMB0], lightSetting);
                if (lightSet.calcLightSetLitMask(this.materialHelper.material.lightChannels, lightSetting)) {
                    this.materialHelper.material.hasLightsBlock = undefined;
                    this.materialHelper.invalidateMaterial();
                }
            }
        }

        // Course fog. The A/B/C terms depend on the camera's clip planes, so they are recomputed
        // per draw rather than cached on the settings object.
        if (this.fogSettings !== null) {
            fillFogBlockParams(materialParams.u_FogBlock, this.fogSettings, camera);
            colorCopy(materialParams.u_FogBlock.Color, this.fogSettings.color);
        }
    }

    public setOnRenderInst(cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(cache, renderInst);
    }

    public fillMaterialParams(renderInst: GfxRenderInst, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, draw: LoadedVertexDraw | null, camera: Camera): void {
        this.fillMaterialParamsData(materialParams, instanceStateData, posNrmMatrixIdx, draw, camera);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }
}

function Calc_BILLBOARD_STD(m: mat4, nodeMatrix: ReadonlyMat4): void {
    return calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
}

function Calc_BILLBOARD_PERSP_STD(m: mat4, nodeMatrix: ReadonlyMat4): void {
    return calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZSphere);
}

const scratchVec3 = vec3.create();
const scratchMatrixInv1 = mat4.create();
function GetModelLocalAxisY(v: vec3, parentNodeMatrix: ReadonlyMat4 | null, nodeMatrix: ReadonlyMat4, scratchMatrix: mat4 = scratchMatrixInv1): void {
    if (parentNodeMatrix !== null) {
        mat4.invert(scratchMatrix, parentNodeMatrix);
        mat4.mul(scratchMatrix, parentNodeMatrix, nodeMatrix);
        getMatrixAxisY(v, scratchMatrix);
    } else {
        getMatrixAxisY(v, nodeMatrix);
    }
    vec3.normalize(v, v);
}

function Calc_BILLBOARD_ROT(m: mat4, nodeMatrix: ReadonlyMat4, parentNodeMatrix: ReadonlyMat4 | null, vy: vec3 = scratchVec3): void {
    GetModelLocalAxisY(vy, parentNodeMatrix, nodeMatrix);
    calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane, vy);
}

function Calc_BILLBOARD_PERSP_ROT(m: mat4, nodeMatrix: ReadonlyMat4, parentNodeMatrix: ReadonlyMat4 | null, vy: vec3 = scratchVec3): void {
    GetModelLocalAxisY(vy, parentNodeMatrix, nodeMatrix);
    return calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZSphere, vy);
}

function Calc_BILLBOARD_Y(m: mat4, nodeMatrix: ReadonlyMat4): void {
    return calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseZPlane);
}

function Calc_BILLBOARD_PERSP_Y(m: mat4, nodeMatrix: ReadonlyMat4): void {
    return calcBillboardMatrix(m, nodeMatrix, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseZSphere);
}

const matrixScratchArray = nArray(1, () => mat4.create());
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

function getRequiredJointMatrixCount(mdl0: BRRES.MDL0): number {
    let count = mdl0.numWorldMtx;

    for (let i = 0; i < mdl0.nodes.length; i++)
        count = Math.max(count, mdl0.nodes[i].mtxId + 1);

    for (let i = 0; i < mdl0.sceneGraph.nodeTreeOps.length; i++) {
        const op = mdl0.sceneGraph.nodeTreeOps[i];
        if (op.op === BRRES.ByteCodeOp.NODEDESC) {
            count = Math.max(count, op.parentMtxId + 1);
        } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
            count = Math.max(count, op.fromMtxId + 1, op.toMtxId + 1);
        }
    }

    for (let i = 0; i < mdl0.sceneGraph.nodeMixOps.length; i++) {
        const op = mdl0.sceneGraph.nodeMixOps[i];
        if (op.op === BRRES.ByteCodeOp.NODEMIX) {
            count = Math.max(count, op.dstMtxId + 1);
            for (let j = 0; j < op.blendMtxIds.length; j++)
                count = Math.max(count, op.blendMtxIds[j] + 1);
        } else if (op.op === BRRES.ByteCodeOp.EVPMTX) {
            count = Math.max(count, op.mtxId + 1);
        }
    }

    return count;
}

function getRequiredViewMatrixCount(mdl0: BRRES.MDL0): number {
    let count = Math.max(mdl0.numViewMtx, mdl0.mtxIdToNodeId.length);

    for (let i = 0; i < mdl0.shapes.length; i++) {
        const mtxIdx = mdl0.shapes[i].mtxIdx;
        if (mtxIdx >= 0)
            count = Math.max(count, mtxIdx + 1);
    }

    return count;
}

export class MDL0ModelInstance {
    public shapeInstances: ShapeInstance[] = [];
    public materialInstances: MaterialInstance[] = [];
    /** Editor extension: the MDL0 material index behind `materialInstances[i]`. */
    public materialInstanceMatIds: number[] = [];

    private chr0NodeAnimator: BRRES.CHR0NodesAnimator | null = null;
    private vis0NodeAnimator: BRRES.VIS0NodesAnimator | null = null;
    private instanceStateData = new InstanceStateData();
    private fogSettings: RRESFogSettings | null = null;

    private debugBones = false;

    public colorOverrides: Color[] = [];

    public name: string;
    public modelMatrix: mat4 = mat4.create();
    public visible: boolean = true;
    public isSkybox: boolean = false; // TODO(jstpierre): Move to a simpler wrapper
    public passMask: number = 1; // TODO(jstpierre): Remove altogether

    constructor(public textureHolder: GXTextureHolder | null, public mdl0Model: MDL0Model, public namePrefix: string = '') {
        this.name = `${namePrefix}/${mdl0Model.mdl0.name}`;

        if (textureHolder !== null)
            this.mdl0Model.bindTextureHolder(textureHolder);

        this.instanceStateData.jointToWorldMatrixArray = nArray(getRequiredJointMatrixCount(mdl0Model.mdl0), () => mat4.create());
        this.instanceStateData.drawViewMatrixArray = nArray(getRequiredViewMatrixCount(mdl0Model.mdl0), () => mat4.create());
        while (matrixScratchArray.length < this.instanceStateData.jointToWorldMatrixArray.length)
            matrixScratchArray.push(mat4.create());

        this.execDrawOpList(this.mdl0Model.mdl0.sceneGraph.drawOpaOps, false);
        this.execDrawOpList(this.mdl0Model.mdl0.sceneGraph.drawXluOps, true);
    }

    public getNodeToWorldMatrixReference(nodeMtxIdx : number): mat4 {
        if (nodeMtxIdx >= this.instanceStateData.jointToWorldMatrixArray.length || nodeMtxIdx < 0) {
            throw "Invalid Node";
        }
        return this.instanceStateData.jointToWorldMatrixArray[nodeMtxIdx];
    }

    public setSortKeyLayer(layer: number): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setSortKeyLayer(layer);
    }

    /**
     * Editor extension: rebuilds the `MaterialInstance`s for one MDL0 material index against
     * whatever `MDL0Model.replaceMaterial` most recently uploaded, and repoints the shapes that
     * drew with the old one.
     *
     * A `MaterialInstance` copies the material's `GXMaterial` at construction, so editing the MDL0
     * entry alone changes nothing on screen — the instance has to be rebuilt. Everything the
     * instance carries that is not derived from the material (draw layer, visibility, skinning,
     * fog) is copied across; animations are re-bound by the caller, because the SRT0/PAT0/CLR0
     * animators live on the instance and only the scene knows which ones are enabled.
     *
     * Returns the number of instances that were replaced.
     */
    public replaceMaterial(index: number): number {
        const materialData = this.mdl0Model.materialData[index];
        if (materialData === undefined)
            return 0;
        let replaced = 0;
        for (let i = 0; i < this.materialInstances.length; i++) {
            if (this.materialInstanceMatIds[i] !== index)
                continue;
            const previous = this.materialInstances[i];
            if (previous.materialData === materialData)
                continue;
            const next = new MaterialInstance(this, materialData);
            next.visible = previous.visible;
            next.setSortKeyLayer(previous.sortKeyLayer);
            for (let j = 0; j < this.shapeInstances.length; j++) {
                const shapeInstance = this.shapeInstances[j];
                if (shapeInstance.materialInstance !== previous)
                    continue;
                shapeInstance.materialInstance = next;
                next.setUsesSkinning(shapeInstance.shape.mtxIdx < 0);
            }
            const fog = previous.getFogSettings();
            if (fog !== null)
                next.setFogSettings(materialData.material.fogIdx >= 0 ? fog : null);
            this.materialInstances[i] = next;
            replaced++;
        }
        return replaced;
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableVertexColors: !v });
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableTextures: !v });
    }

    /**
     * Applies course fog to the materials this model marks as fogged, and turns it off on the
     * rest. Which materials those are is the BRRES's own decision: `MDL0_MaterialEntry.fogIdx`
     * is `-1` on a material the artist excluded from fog (the sky dome, self-lit signage) and
     * `>= 0` on one that receives it, which is exactly how the console decides.
     *
     * Cheap to call every frame: it returns immediately unless the settings object changed, and
     * a settings object only changes when `posteffect.bfg` does.
     */
    public setFogSettings(fog: RRESFogSettings | null): void {
        if (this.fogSettings === fog)
            return;
        this.fogSettings = fog;
        for (let i = 0; i < this.materialInstances.length; i++) {
            const instance = this.materialInstances[i];
            instance.setFogSettings(instance.materialData.material.fogIdx >= 0 ? fog : null);
        }
    }

    public bindCHR0(animationController: AnimationController, chr0: BRRES.CHR0): void {
        this.chr0NodeAnimator = BRRES.bindCHR0Animator(animationController, chr0, this.mdl0Model.mdl0.nodes);
    }

    /**
     * Editor extension: the bound CHR0 animator, or null. A host that needs the *animated* joint
     * matrices on the CPU — the Model Studio's mesh picker, which has to hit the character where
     * it is drawn and not where it was bound — has to run the same node walk this instance runs,
     * and that walk needs this.
     */
    public getCHR0Animator(): BRRES.CHR0NodesAnimator | null {
        return this.chr0NodeAnimator;
    }

    public bindVIS0(animationController: AnimationController, vis0: BRRES.VIS0): void {
        this.vis0NodeAnimator = BRRES.bindVIS0Animator(animationController, vis0, this.mdl0Model.mdl0.nodes);
    }

    /**
     * Binds {@param srt0} (texture animations) to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindSRT0(animationController: AnimationController | null, srt0: BRRES.SRT0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(animationController: AnimationController | null, pat0: BRRES.PAT0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindPAT0(animationController, pat0);
    }

    public bindCLR0(animationController: AnimationController | null, clr0: BRRES.CLR0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCLR0(animationController, clr0);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.instanceStateData.lightSetting = lightSetting;
    }

    /**
     * Binds all animations in {@param rres} that are named {@param name} to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * @param rres An {@param RRES} archive with animations to search through.
     * @param name The name of animations to search for. By default, this uses the name of the {@member mdl0Model}
     * used to construct this model instance, as Nintendo appears to use this convention a lot in their games.
     * You can also pass {@constant null} in order to match all animations in the archive.
     */
    public bindRRESAnimations(animationController: AnimationController, rres: BRRES.RRES, name: string | null = this.mdl0Model.mdl0.name): void {
        for (let i = 0; i < rres.chr0.length; i++)
            if (rres.chr0[i].name === name || name === null)
                this.bindCHR0(animationController, rres.chr0[i]);

        for (let i = 0; i < rres.srt0.length; i++)
            if (rres.srt0[i].name === name || name === null)
                this.bindSRT0(animationController, rres.srt0[i]);

        for (let i = 0; i < rres.clr0.length; i++)
            if (rres.clr0[i].name === name || name === null)
                this.bindCLR0(animationController, rres.clr0[i]);

        for (let i = 0; i < rres.pat0.length; i++)
            if (rres.pat0[i].name === name || name === null)
                this.bindPAT0(animationController, rres.pat0[i]);

        for (let i = 0; i < rres.vis0.length; i++)
            if (rres.vis0[i].name === name || name === null)
                this.bindVIS0(animationController, rres.vis0[i]);
    }

    public setColorOverride(i: ColorKind, color: Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    private isAnyShapeVisible(): boolean {
        for (let i = 0; i < this.instanceStateData.jointToWorldMatrixVisibility.length; i++)
            if (this.instanceStateData.jointToWorldMatrixVisibility[i] !== IntersectionState.Outside)
                return true;
        return false;
    }

    private calcView(camera: Camera): void {
        if (this.isSkybox) {
            this.modelMatrix[12] = camera.worldMatrix[12];
            this.modelMatrix[13] = camera.worldMatrix[13];
            this.modelMatrix[14] = camera.worldMatrix[14];
        }

        const numViewMtx = this.instanceStateData.drawViewMatrixArray.length;
        for (let i = 0; i < numViewMtx; i++) {
            const nodeToWorldMatrix = this.instanceStateData.jointToWorldMatrixArray[i];
            const dstDrawMatrix = this.instanceStateData.drawViewMatrixArray[i];

            mat4.mul(dstDrawMatrix, camera.viewMatrix, nodeToWorldMatrix);

            // nodeId should exist for non-envelope matrix IDs.
            const nodeId = this.mdl0Model.mdl0.mtxIdToNodeId[i];
            const node = nodeId >= 0 ? this.mdl0Model.mdl0.nodes[nodeId] : null;

            // Billboard is not supported for skinned meshes.
            if (node !== null) {
                // attribs should exist for non-envelope matrix IDs.
                const billboardMode = this.instanceStateData.jointToWorldMatrixAttribs[i];

                const hasBillboardAncestor = !!(node.flags & BRRES.NodeFlags.REFER_BB_ANCESTOR);
                // TODO(jstpierre): Nodes under the influence of a billboarded parent
                // assert(!hasBillboardAncestor);

                if (billboardMode !== BRRES.BillboardMode.NONE) {
                    const parentNodeId = node.parentNodeId;
                    const parentNodeToWorldMatrix = parentNodeId >= 0 ? this.instanceStateData.jointToWorldMatrixArray[parentNodeId] : null;

                    if (billboardMode === BRRES.BillboardMode.BILLBOARD) {
                        Calc_BILLBOARD_STD(dstDrawMatrix, dstDrawMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_BILLBOARD) {
                        Calc_BILLBOARD_PERSP_STD(dstDrawMatrix, dstDrawMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.ROT) {
                        Calc_BILLBOARD_ROT(dstDrawMatrix, dstDrawMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_ROT) {
                        Calc_BILLBOARD_PERSP_ROT(dstDrawMatrix, dstDrawMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.Y) {
                        Calc_BILLBOARD_Y(dstDrawMatrix, dstDrawMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_Y) {
                        Calc_BILLBOARD_PERSP_Y(dstDrawMatrix, dstDrawMatrix);
                    }
                }
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        let modelVisibility = this.visible ? IntersectionState.Intersection : IntersectionState.Outside;
        const mdl0 = this.mdl0Model.mdl0;
        const camera = viewerInput.camera;

        if (modelVisibility !== IntersectionState.Outside) {
            if (this.isSkybox) {
                modelVisibility = IntersectionState.Inside;
            } else if (mdl0.bbox !== null) {
                try {
                    // Frustum cull.
                    bboxScratch.transform(mdl0.bbox, this.modelMatrix);
                    if (!viewerInput.camera.frustum.contains(bboxScratch))
                        modelVisibility = IntersectionState.Outside;
                } catch {
                    modelVisibility = IntersectionState.Intersection;
                }
            }
        }

        if (modelVisibility !== IntersectionState.Outside) {
            this.execNodeTreeOpList(mdl0.sceneGraph.nodeTreeOps, viewerInput.camera, modelVisibility);
            this.execNodeMixOpList(mdl0.sceneGraph.nodeMixOps);

            if (!this.isAnyShapeVisible())
                modelVisibility = IntersectionState.Outside;
        }

        let depth = -1;
        if (modelVisibility !== IntersectionState.Outside) {
            const rootJoint = mdl0.nodes[0];
            if (rootJoint.bbox !== null) {
                try {
                    bboxScratch.transform(rootJoint.bbox, this.modelMatrix);
                    depth = Math.max(computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, bboxScratch), 0);
                } catch {
                    depth = Math.max(depth, 0);
                }
            } else {
                depth = Math.max(depth, 0);
            }
        }

        if (depth < 0)
            return;

        this.calcView(camera);

        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeInstance = this.shapeInstances[i];
            const shapeVisibility = (this.vis0NodeAnimator !== null ? this.vis0NodeAnimator.calcVisibility(shapeInstance.sortVizNode.id) : shapeInstance.sortVizNode.visible);
            if (!shapeVisibility)
                continue;

            shapeInstance.prepareToRender(renderInstManager, depth, camera, this.instanceStateData);
        }
    }

    private execDrawOpList(opList: BRRES.DrawOp[], translucent: boolean): void {
        const mdl0 = this.mdl0Model.mdl0;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            const materialData = this.mdl0Model.materialData[op.matId];
            const materialInstance = new MaterialInstance(this, materialData);
            this.materialInstances.push(materialInstance);
            // Editor extension: `materialInstances` is per draw op, not per material, so the MDL0
            // material index each one came from is recorded for `replaceMaterial`.
            this.materialInstanceMatIds.push(op.matId);

            const node = mdl0.nodes[op.nodeId];
            const shape = this.mdl0Model.mdl0.shapes[op.shpId];
            const shapeData = this.mdl0Model.shapeData[op.shpId];
            const shapeInstance = new ShapeInstance(shape, shapeData, node, materialInstance);
            if (translucent)
                shapeInstance.sortKeyBias = i;

            const usesSkinning = shape.mtxIdx < 0;
            materialInstance.setUsesSkinning(usesSkinning);

            this.shapeInstances.push(shapeInstance);
        }
    }

    private execNodeTreeOpList(opList: BRRES.NodeTreeOp[], camera: Camera, rootVisibility: IntersectionState): void {
        const mdl0 = this.mdl0Model.mdl0;

        mat4.copy(this.instanceStateData.jointToWorldMatrixArray[0], this.modelMatrix);
        this.instanceStateData.jointToWorldMatrixVisibility[0] = rootVisibility;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = mdl0.nodes[op.nodeId];
                const parentMtxId = op.parentMtxId;
                const dstMtxId = node.mtxId;

                let modelMatrix;
                if (this.chr0NodeAnimator !== null && this.chr0NodeAnimator.calcModelMtx(matrixScratch, op.nodeId)) {
                    modelMatrix = matrixScratch;
                } else {
                    modelMatrix = node.modelMatrix;
                }
                mat4.mul(this.instanceStateData.jointToWorldMatrixArray[dstMtxId], this.instanceStateData.jointToWorldMatrixArray[parentMtxId], modelMatrix);

                if (rootVisibility !== IntersectionState.Outside) {
                    if (rootVisibility === IntersectionState.Inside || node.bbox === null) {
                        this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = IntersectionState.Inside;
                    } else {
                        try {
                            bboxScratch.transform(node.bbox, this.instanceStateData.jointToWorldMatrixArray[dstMtxId]);
                            this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = camera.frustum.intersect(bboxScratch);
                        } catch {
                            this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = IntersectionState.Inside;
                        }
                    }
                } else {
                    this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = IntersectionState.Outside;
                }

                this.instanceStateData.jointToWorldMatrixAttribs[dstMtxId] = node.billboardMode;

                if (this.debugBones) {
                    const ctx = getDebugOverlayCanvas2D();

                    vec3.zero(scratchVec3a);
                    vec3.transformMat4(scratchVec3a, scratchVec3a, this.instanceStateData.jointToWorldMatrixArray[parentMtxId]);
                    vec3.zero(scratchVec3b);
                    vec3.transformMat4(scratchVec3b, scratchVec3b, this.instanceStateData.jointToWorldMatrixArray[dstMtxId]);

                    drawWorldSpaceLine(ctx, camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b);
                }
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const srcMtxId = op.fromMtxId;
                const dstMtxId = op.toMtxId;
                mat4.copy(this.instanceStateData.jointToWorldMatrixArray[dstMtxId], this.instanceStateData.jointToWorldMatrixArray[srcMtxId]);
                this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = this.instanceStateData.jointToWorldMatrixVisibility[srcMtxId];
                this.instanceStateData.jointToWorldMatrixAttribs[dstMtxId] = this.instanceStateData.jointToWorldMatrixAttribs[srcMtxId];
            }
        }
    }

    private execNodeMixOpList(opList: BRRES.NodeMixOp[]): void {
        const jointToWorldMatrixArray = this.instanceStateData.jointToWorldMatrixArray;
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEMIX) {
                const dst = jointToWorldMatrixArray[op.dstMtxId];
                for (let k = 0; k < 16; k++)
                    dst[k] = 0;

                for (let j = 0; j < op.blendMtxIds.length; j++)
                    mat4.multiplyScalarAndAdd(dst, dst, matrixScratchArray[op.blendMtxIds[j]], op.weights[j]);
            } else if (op.op === BRRES.ByteCodeOp.EVPMTX) {
                const node = this.mdl0Model.mdl0.nodes[op.nodeId];
                mat4.mul(matrixScratchArray[op.mtxId], jointToWorldMatrixArray[op.mtxId], node.inverseBindPose);
            }
        }
    }
}
