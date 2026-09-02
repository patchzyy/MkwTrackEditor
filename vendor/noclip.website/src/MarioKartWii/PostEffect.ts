
// EGG PostEffects

import { mat4, vec2, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Camera } from "../Camera.js";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA8, colorScale, OpaqueBlack } from "../Color.js";
import { copyMegaState, fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForClearValue, reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/GfxShaderLibrary.js";
import { fillColor, fillMatrix4x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxClipSpaceNearZ, GfxCompareMode, GfxDevice, GfxFormat, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID, GfxrResolveTextureID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { GXShaderLibrary } from "../gx/gx_material.js";
import { DeviceProgram } from "../Program.js";
import { assert, assertExists, nArray, readString } from "../util.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";
import { GXTextureMapping } from "../gx/gx_render.js";

//#region Bloom

interface BBLM {
    thresholdAmount: number;
    thresholdColor: Color;
    compositeColor: Color;
    blurFlags: number;
    blur0Radius: number;
    blur0Intensity: number;
    blur1Radius: number;
    blur1Intensity: number;
    compositeBlendMode: number;
    blur1NumPasses: number;
    bokehColorScale0: number;
    bokehColorScale1: number;
}

export function parseBBLM(buffer: ArrayBufferSlice): BBLM {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PBLM');
    const fileSize = view.getUint32(0x04);
    const version = view.getUint8(0x08);
    assert(version === 1);

    const thresholdAmount = view.getFloat32(0x10);
    const thresholdColor = colorNewFromRGBA8(view.getUint32(0x14));
    const compositeColor = colorNewFromRGBA8(view.getUint32(0x18));
    const blurFlags = view.getUint16(0x1C);
    const blur0Radius = view.getFloat32(0x20);
    const blur0Intensity = view.getFloat32(0x24);
    const blur1Radius = view.getFloat32(0x40);
    const blur1Intensity = view.getFloat32(0x44);
    const compositeBlendMode = view.getUint8(0x80);
    const blur1NumPasses = view.getUint8(0x81);
    const bokehColorScale0 = view.getFloat32(0x9C);
    const bokehColorScale1 = view.getFloat32(0xA0);

    return {
        thresholdAmount, thresholdColor, compositeColor, blurFlags,
        blur0Radius, blur0Intensity, blur1Radius, blur1Intensity,
        compositeBlendMode, blur1NumPasses, bokehColorScale0, bokehColorScale1,
    };
}

class FullscreenBlitProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

class EggBloomBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    vec4 u_ThresholdColor;
    vec4 u_CompositeColor;
    vec4 u_CompositeColorScale;
};
`;

    public override vert = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;
}

class EggBloomThresholdProgram extends EggBloomBaseProgram {
    public override frag: string = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${GXShaderLibrary.GXIntensity}
${GXShaderLibrary.TevOverflow}

in vec2 v_TexCoord;

void main() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor.rgb = c.rgb * (2.0 * (saturate(vec3(GXIntensity(c.rgb)) - u_ThresholdColor.rgb)));
    gl_FragColor.a = 1.0;
}
`;
}

class EggBloomBlurProgram extends EggBloomBaseProgram {
    constructor(tapCount: number, numPasses: number, intensity: number, radius: number)  {
        super();

        const intensityPerTap = intensity / tapCount * 8;

        let funcs = '';
        let code = '';
        for (let i = 0; i < numPasses; i++) {
            const passTapCount = (i + 1) * tapCount;
            const funcName = `BlurPass${i}`;
            funcs += GXShaderLibrary.generateBlurFunction(funcName, passTapCount, glslGenerateFloat(radius), glslGenerateFloat(intensityPerTap));
            code += `
    c += saturate(${funcName}(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect));`;
        }

        this.frag = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${funcs}

in vec2 v_TexCoord;

void main() {
    vec2 t_Size = vec2(textureSize(SAMPLER_2D(u_Texture), 0));
    vec2 t_Aspect = vec2(1.0) / t_Size;

    vec3 c = vec3(0.0);
${code}
    gl_FragColor.rgb = saturate(c);
    gl_FragColor.a = 1.0;
}
`;
    }
}

class EggBloomCombineProgram extends EggBloomBaseProgram {
    constructor(numPasses: number)  {
        super();

        const passTextureName = ['u_Texture', 'u_Texture2'];
        let code = ``;
        for (let i = 0; i < numPasses; i++) {
            code += `
    c += saturate(texture(SAMPLER_2D(${passTextureName[i]}), v_TexCoord).rgb) * u_CompositeColor.rgb * u_CompositeColorScale[${i}];`;
        }

        this.frag = `
${EggBloomBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}

in vec2 v_TexCoord;

void main() {
    vec3 c = vec3(0.0);
    ${code}
    gl_FragColor.rgb = saturate(c);
    gl_FragColor.a = 1.0;
}
`;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 2 }];

export class EggDrawPathBloom {
    private thresholdColor = colorNewCopy(OpaqueBlack);
    private blitProgram: GfxProgram;
    private thresholdProgram: GfxProgram;
    private blur0Program: GfxProgram;
    private blur1Program: GfxProgram;
    private compositeColor = colorNewCopy(OpaqueBlack);
    private compositeColorScale0: number;
    private compositeColorScale1: number;
    private compositeProgram: GfxProgram;
    private compositeMegaState = copyMegaState(fullscreenMegaState);

    private textureMapping: GXTextureMapping[] = nArray(2, () => new GXTextureMapping());

    constructor(device: GfxDevice, cache: GfxRenderCache, private pblm: BBLM) {
        // Threshold settings.
        const thresholdColorScale = ((pblm.thresholdAmount * 219.0 + 16.0) | 0) / 255.0;
        colorScale(this.thresholdColor, pblm.thresholdColor, thresholdColorScale);
        if (!!(pblm.blurFlags & 0x10))
            this.thresholdColor.a = 0.0;

        colorCopy(this.compositeColor, pblm.compositeColor);
        this.compositeColorScale0 = pblm.bokehColorScale0;
        this.compositeColorScale1 = pblm.bokehColorScale1;

        const blurNumSamples = 8;
        const blur0Program = new EggBloomBlurProgram(blurNumSamples, 1, pblm.blur0Intensity, pblm.blur0Radius);
        const blur1Program = new EggBloomBlurProgram(blurNumSamples, pblm.blur1NumPasses, pblm.blur1Intensity, pblm.blur1Radius);

        const numPasses = (pblm.blurFlags & 1) ? 2 : 1;
        const combineProgram = new EggBloomCombineProgram(numPasses);

        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;
        this.textureMapping[1].gfxSampler = linearSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
        this.thresholdProgram = cache.createProgram(new EggBloomThresholdProgram());
        this.blur0Program = cache.createProgram(blur0Program);
        this.blur1Program = cache.createProgram(blur1Program);
        this.compositeProgram = cache.createProgram(combineProgram);

        const blendModeTable = [
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.One, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.OneMinusDst, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.One },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha },
            { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.Dst, blendDstFactor: GfxBlendFactor.One },
        ];
        setAttachmentStateSimple(this.compositeMegaState, blendModeTable[pblm.compositeBlendMode]);
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 12);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillColor(d, offs, this.thresholdColor);
        offs += fillColor(d, offs, this.compositeColor);
        offs += fillVec4(d, offs, this.compositeColorScale0, this.compositeColorScale1);
    }

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private target8ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    public pushPassesBloom(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        this.target2ColorDesc.setDimensions(mainColorTargetDesc.width >>> 1, mainColorTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);
        this.target8ColorDesc.setDimensions(this.target4ColorDesc.width >>> 1, this.target4ColorDesc.height >>> 1, 1);

        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Bloom 1/2 Buffer');
        const downsample4ColorTargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Bloom 1/4 Buffer');
        const downsample8ColorTargetID = builder.createRenderTargetID(this.target8ColorDesc, 'Bloom 1/8 Buffer');

        const cache = renderInstManager.gfxRenderCache;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.setDrawCount(3);

        this.textureMapping[0].gfxTexture = null;
        this.textureMapping[1].gfxTexture = null;

        builder.pushDebugGroup('Bloom');
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Threshold & Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);

            pass.attachResolveTexture(mainResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsample2ColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample2ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 0');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur0Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsample4ColorTargetID);

        const downsample4ColorResolveTextureID = builder.resolveRenderTarget(downsample4ColorTargetID);
        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Downsample 1/8');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);

            pass.attachResolveTexture(downsample4ColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4ColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Blur 1');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample8ColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blur1Program);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsample8ColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Bloom Composite');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const downsample8ColorResolveTextureID = builder.resolveRenderTarget(downsample8ColorTargetID);
            pass.attachResolveTexture(downsample4ColorResolveTextureID);
            pass.attachResolveTexture(downsample8ColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.compositeProgram);
                renderInst.setMegaStateFlags(this.compositeMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4ColorResolveTextureID);
                this.textureMapping[1].gfxTexture = scope.getResolveTextureForID(downsample8ColorResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.popDebugGroup();
    }
}

//#endregion

//#region DOF

interface BDOF {
    flags: number;
    blurAlpha: readonly [number, number];
    drawMode: number;
    blurDrawAmount: number;
    depthCurveType: number;
    focusCenter: number;
    focusRange: number;
    blurRadius: number;
    indTexTransSScroll: number;
    indTexTransTScroll: number;
    indTexIndScaleS: number;
    indTexIndScaleT: number;
    indTexScaleS: number;
    indTexScaleT: number;
}

export function parseBDOF(buffer: ArrayBufferSlice): BDOF {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PDOF');
    const fileSize = view.getUint32(0x04);
    const version = view.getUint8(0x08);
    assert(version === 0);

    const flags = view.getUint16(0x10);
    const blurAlpha0 = view.getUint8(0x12);
    const blurAlpha1 = view.getUint8(0x13);
    const blurAlpha = [blurAlpha0, blurAlpha1] as const;
    const drawMode = view.getUint8(0x14);
    const blurDrawAmount = view.getUint8(0x15);
    const depthCurveType = view.getUint8(0x16);
    const focusCenter = view.getFloat32(0x18);
    const focusRange = view.getFloat32(0x1C);
    const blurRadius = view.getFloat32(0x24);
    const indTexTransSScroll = view.getFloat32(0x28);
    const indTexTransTScroll = view.getFloat32(0x2C);
    const indTexIndScaleS = view.getFloat32(0x30);
    const indTexIndScaleT = view.getFloat32(0x34);
    const indTexScaleS = view.getFloat32(0x38);
    const indTexScaleT = view.getFloat32(0x3C);

    return {
        flags, blurAlpha, drawMode, blurDrawAmount, depthCurveType, focusCenter, focusRange, blurRadius,
        indTexTransSScroll, indTexTransTScroll, indTexIndScaleS, indTexIndScaleT, indTexScaleS, indTexScaleT,
     };
}

class EggDOFBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
${GfxShaderLibrary.MatrixLibrary}

uniform sampler2D u_Texture;
uniform sampler2D u_Texture2;

layout(std140) uniform ub_Params {
    Mat2x4 u_IndTexMat;
    vec4 u_Misc0;
};

#define u_FocusZClipSpace (u_Misc0.x)
#define u_IndTexIndScale  (u_Misc0.yz)
`;

    public override vert = `
${EggDOFBaseProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;
}

class EggDOFMode2BlurProgram extends EggDOFBaseProgram {
    constructor(tapCount: number, radius: number)  {
        super();

        const intensityPerTap = 1.0 / tapCount;

        this.frag = `
${EggDOFBaseProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}
${GXShaderLibrary.generateBlurFunction(`BlurPass0`, tapCount, glslGenerateFloat(radius), glslGenerateFloat(intensityPerTap))}

in vec2 v_TexCoord;

void main() {
    vec2 t_Size = vec2(textureSize(SAMPLER_2D(u_Texture), 0));
    vec2 t_Aspect = vec2(1.0) / t_Size;

    gl_FragColor.rgb = saturate(BlurPass0(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect));
    gl_FragColor.a = 1.0;
}
`;
    }
}

class EggDOFDrawMode2CombineProgram extends EggDOFBaseProgram {
    constructor(useIndWarpTex: boolean) {
        super();
        this.setDefineBool('USE_IND_WARP_TEX', useIndWarpTex);

        this.vert = `
${EggDOFBaseProgram.BindingsDefinition}
${GfxShaderLibrary.makeFullscreenVS(`u_FocusZClipSpace`)}
`;

        this.frag = `
${EggDOFBaseProgram.BindingsDefinition}
    
in vec2 v_TexCoord;

void main() {
    vec2 t_TexCoord = v_TexCoord;

#ifdef USE_IND_WARP_TEX
    // Handcoded indtex pipeline...
    vec2 t_WarpTexCoord = UnpackMatrix(u_IndTexMat) * vec4(v_TexCoord, 0.0, 1.0);
    vec2 t_IndTexOffs = ((255.0 * texture(SAMPLER_2D(u_Texture2), t_WarpTexCoord).ba) - 128.0) * u_IndTexIndScale;
    t_TexCoord += t_IndTexOffs;
#endif

    gl_FragColor.rgb = texture(SAMPLER_2D(u_Texture), t_TexCoord).rgb;
    gl_FragColor.a = 1.0;
}
`;
    }
}
    
enum DOFDrawMode {
    DrawMode0,
    DrawMode1,
    DrawMode2,
}

const scratchVec3 = vec3.create();
export class EggDrawPathDOF {
    private drawMode: DOFDrawMode;
    private focusCenter: number;
    private focusRange: number;
    private blurTapCount: number;
    private blurScale = 1.0;
    private indTexMat = mat4.create();
    private indTexIndScale = vec2.create();
    private indTexScrollSpeed = vec2.create();
    private blitProgram: GfxProgram;
    private drawMode2BlurProgram: GfxProgram;
    private drawMode2CombineProgram: GfxProgram;
    private textureMapping = nArray(2, () => new GXTextureMapping());

    constructor(device: GfxDevice, private cache: GfxRenderCache, private pdof: BDOF) {
        this.drawMode = pdof.drawMode;
        this.focusCenter = pdof.focusCenter;
        this.focusRange = pdof.focusRange;

        this.indTexMat[0] = pdof.indTexScaleS;
        this.indTexMat[5] = pdof.indTexScaleT;
        if (gfxDeviceNeedsFlipY(device))
            this.indTexMat[5] *= -1;
        vec2.set(this.indTexScrollSpeed, pdof.indTexTransSScroll, pdof.indTexTransTScroll);
        vec2.set(this.indTexIndScale, pdof.indTexIndScaleS, pdof.indTexIndScaleT);

        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());

        const blurTapCountTable = [4, 2];
        this.blurTapCount = assertExists(blurTapCountTable[pdof.blurDrawAmount]);
        this.drawMode2BlurProgram = this.cache.createProgram(new EggDOFMode2BlurProgram(this.blurTapCount, pdof.blurRadius));

        const useIndWarpTex = !!(pdof.flags & 0x02);
        this.drawMode2CombineProgram = cache.createProgram(new EggDOFDrawMode2CombineProgram(useIndWarpTex));
    }

    public setBlurScale(scale: number): void {
        const nextScale = Math.max(0.0, scale);
        if (this.blurScale === nextScale)
            return;
        this.blurScale = nextScale;
        this.drawMode2BlurProgram = this.cache.createProgram(new EggDOFMode2BlurProgram(this.blurTapCount, this.pdof.blurRadius * this.blurScale));
    }

    public updateScroll(t: number): void {
        this.indTexMat[12] = this.indTexScrollSpeed[0] * t;
        this.indTexMat[13] = this.indTexScrollSpeed[1] * t * -1;
    }

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);

    private pushPassesDOF_DrawMode2(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, camera: Camera, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        const mainColorTargetDesc = builder.getRenderTargetDescription(mainColorTargetID);

        this.target2ColorDesc.setDimensions(mainColorTargetDesc.width >>> 1, mainColorTargetDesc.height >>> 1, 1);
        const downsample2ColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, `DOF 1/2 Buffer`);
        const blurColorTargetID = builder.createRenderTargetID(this.target2ColorDesc, `DOF 1/2 Blur Buffer`);

        const cache = renderInstManager.gfxRenderCache;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(bindingLayouts);

        // Allocate parameter buffer.
        {
            let offs = renderInst.allocateUniformBuffer(0, 12);
            const d = renderInst.mapUniformBufferF32(0);

            // For dumb reasons, noclip scales everything by 0.1, blergh
            // TODO(jstpierre): Fix this
            const focusZ = (this.focusCenter + this.focusRange * 0.5) * 0.1;

            // Compute the clip-space target Z
            vec3.set(scratchVec3, 0, 0, -focusZ);
            vec3.transformMat4(scratchVec3, scratchVec3, camera.projectionMatrix);
            const focusZClipSpace = scratchVec3[2];

            offs += fillMatrix4x2(d, offs, this.indTexMat);

            // Game hardcodes a shift of -6, and also scales relative to the screen size.
            // TODO(jstpierre): Figure out where this extra factor of 2 comes from. I can't find it...
            const indTexShift = 1/64 * (1/2);
            const indTexIndScaleS = (this.indTexIndScale[0] / 832.0) * indTexShift;
            const indTexIndScaleT = (this.indTexIndScale[1] / 456.0) * indTexShift * -1;
            offs += fillVec4(d, offs, focusZClipSpace, indTexIndScaleS, indTexIndScaleT);
        }

        renderInst.setDrawCount(3);

        this.textureMapping[0].gfxTexture = null;

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2ColorTargetID);

            pass.attachResolveTexture(mainResolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(downsample2ColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, blurColorTargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample2ColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.drawMode2BlurProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
        builder.pushDebugThumbnail(blurColorTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('DOF Combine');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const resolveTextureID = builder.resolveRenderTarget(blurColorTargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.drawMode2CombineProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                renderInst.setMegaStateFlags({ depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual) });
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
    }

    public pushPassesDOF(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, camera: Camera, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, mainResolveTextureID: GfxrResolveTextureID): void {
        if (this.drawMode === DOFDrawMode.DrawMode2)
            this.pushPassesDOF_DrawMode2(builder, renderInstManager, camera, mainColorTargetID, mainDepthTargetID, mainResolveTextureID);
    }

    public getIndTextureMapping(): GXTextureMapping {
        return this.textureMapping[1];
    }
}

//#endregion

//#region Fog

/**
 * `posteffect.bfg` — the course fog table. The game uploads one of these four entries with
 * `GXSetFog`; `fogType` uses the GX fog-type numbering (see `gx_enum.FogType`).
 */
export interface BFGEntry {
    fogType: number;
    startZ: number;
    endZ: number;
    color: Color;
    fadeSpeed: number;
}

const BFG_ENTRY_SIZE = 0x1c;

export function parseBFG(buffer: ArrayBufferSlice): BFGEntry[] {
    const view = buffer.createDataView();
    const entries: BFGEntry[] = [];
    const count = Math.min(4, (buffer.byteLength / BFG_ENTRY_SIZE) | 0);
    for (let i = 0; i < count; i++) {
        const base = i * BFG_ENTRY_SIZE;
        entries.push({
            fogType: view.getInt32(base + 0x00),
            startZ: view.getFloat32(base + 0x04),
            endZ: view.getFloat32(base + 0x08),
            // The alpha byte is not part of the GX fog colour, so it is deliberately dropped.
            color: colorNewFromRGBA8((view.getUint32(base + 0x0c) & 0xffffff00) | 0xff),
            fadeSpeed: view.getFloat32(base + 0x14),
        });
    }
    return entries;
}

/** GX fog functions, keyed by `fogType & 0x07`. */
function generateFogFuncGLSL(fogType: number): string | null {
    switch (fogType & 0x07) {
    case 0x02: return `t_FogZ`;
    case 0x04: return `1.0 - exp2(-8.0 * t_FogZ)`;
    case 0x05: return `1.0 - exp2(-8.0 * t_FogZ * t_FogZ)`;
    case 0x06: return `1.0 - exp2(-8.0 * (1.0 - t_FogZ))`;
    case 0x07: return `1.0 - exp2(-8.0 * (1.0 - t_FogZ) * (1.0 - t_FogZ))`;
    default: return null;
    }
}

class EggFogProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_TextureFramebufferDepth;

layout(std140) uniform ub_Params {
    vec4 u_FogColor;
    vec4 u_Misc0;
    vec4 u_Misc1;
};

// Reconstructs view distance from the depth sample: 1/dist is affine in the stored depth
// value for any projective depth mapping, so the two coefficients are fitted on the CPU.
#define u_DistA      (u_Misc0.x)
#define u_DistB      (u_Misc0.y)
#define u_FogStartZ  (u_Misc0.z)
#define u_FogEndZ    (u_Misc0.w)
#define u_ClearDepth (u_Misc1.x)
`;

    public override vert = `
${EggFogProgram.BindingsDefinition}
${GfxShaderLibrary.fullscreenVS}
`;

    constructor(fogFunc: string) {
        super();
        this.frag = `
${EggFogProgram.BindingsDefinition}
${GfxShaderLibrary.saturate}

in vec2 v_TexCoord;

void main() {
    float t_Depth = texelFetch(TEXTURE(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
    // Nothing was drawn here, so there is no surface to fog.
    if (abs(t_Depth - u_ClearDepth) < 0.000001)
        discard;

    float t_Denom = u_DistA * t_Depth + u_DistB;
    if (t_Denom <= 0.0)
        discard;
    float t_Dist = 1.0 / t_Denom;

    float t_FogZ = saturate((t_Dist - u_FogStartZ) / max(u_FogEndZ - u_FogStartZ, 0.00001));
    float t_Fog = saturate(${fogFunc});
    gl_FragColor = vec4(u_FogColor.rgb, t_Fog);
}
`;
    }
}

const scratchFogVec3 = vec3.create();
const fogBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

/**
 * Screen-space course fog.
 *
 * The Wii game calls `GXSetFog` per material from `posteffect.bfg`; noclip's BRRES materials are
 * built with fog disabled, so this reproduces it as a fullscreen blend over the main colour target
 * using the resolved depth buffer. It is only a preview aid — it never touches the track files.
 */
export class EggDrawPathFog {
    private program: GfxProgram | null = null;
    private programFogType = -1;
    private entry: BFGEntry | null = null;
    private enabled = true;
    private sceneScale: number;
    private megaState = copyMegaState(fullscreenMegaState);
    private textureMapping = nArray(1, () => new GXTextureMapping());
    private color = colorNewCopy(OpaqueBlack);

    constructor(device: GfxDevice, private cache: GfxRenderCache, sceneScale: number) {
        this.sceneScale = sceneScale;
        this.textureMapping[0].gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
        setAttachmentStateSimple(this.megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
    }

    /** Selects which of the four `posteffect.bfg` entries drives the preview. `null` disables it. */
    public setEntry(entry: BFGEntry | null): void {
        this.entry = entry;
        if (entry !== null)
            colorCopy(this.color, entry.color);
    }

    public getEntry(): BFGEntry | null {
        return this.entry;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    public getEnabled(): boolean {
        return this.enabled;
    }

    public isActive(): boolean {
        return this.enabled && this.entry !== null && generateFogFuncGLSL(this.entry.fogType) !== null && this.entry.endZ > this.entry.startZ;
    }

    private ensureProgram(fogType: number): GfxProgram | null {
        const fogFunc = generateFogFuncGLSL(fogType);
        if (fogFunc === null)
            return null;
        if (this.program === null || this.programFogType !== fogType) {
            this.program = this.cache.createProgram(new EggFogProgram(fogFunc));
            this.programFogType = fogType;
        }
        return this.program;
    }

    /** Depth-buffer value the given view-space distance projects to, in the device's convention. */
    private calcDepthForDistance(camera: Camera, distance: number): number {
        vec3.set(scratchFogVec3, 0, 0, -distance);
        const m = camera.projectionMatrix;
        const clipZ = m[10] * scratchFogVec3[2] + m[14];
        const clipW = m[11] * scratchFogVec3[2] + m[15];
        const ndcZ = clipW !== 0 ? clipZ / clipW : 0;
        return camera.clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne ? (ndcZ + 1) * 0.5 : ndcZ;
    }

    public pushPassesFog(builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, camera: Camera, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID): void {
        const entry = this.entry;
        if (!this.enabled || entry === null)
            return;
        const program = this.ensureProgram(entry.fogType);
        if (program === null || !(entry.endZ > entry.startZ))
            return;

        // 1/dist is affine in the stored depth, so two probes pin the mapping down exactly.
        const probe0 = 10, probe1 = 10000;
        const depth0 = this.calcDepthForDistance(camera, probe0);
        const depth1 = this.calcDepthForDistance(camera, probe1);
        const depthSpan = depth0 - depth1;
        if (!Number.isFinite(depthSpan) || Math.abs(depthSpan) < 1e-9)
            return;
        const distA = (1 / probe0 - 1 / probe1) / depthSpan;
        const distB = 1 / probe0 - distA * depth0;
        const clearDepth = reverseDepthForClearValue(1.0);

        const cache = renderInstManager.gfxRenderCache;
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setBindingLayouts(fogBindingLayouts);
        {
            let offs = renderInst.allocateUniformBuffer(0, 12);
            const d = renderInst.mapUniformBufferF32(0);
            offs += fillColor(d, offs, this.color);
            offs += fillVec4(d, offs, distA, distB, entry.startZ * this.sceneScale, entry.endZ * this.sceneScale);
            offs += fillVec4(d, offs, clearDepth, 0, 0, 0);
        }
        renderInst.setDrawCount(3);
        renderInst.setGfxProgram(program);
        renderInst.setMegaStateFlags(this.megaState);

        builder.pushPass((pass) => {
            pass.setDebugName('Course Fog');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const depthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            pass.attachResolveTexture(depthResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(depthResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(cache, passRenderer);
            });
        });
    }
}

//#endregion
