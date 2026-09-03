/**
 * Renders BRRES models to thumbnail images with noclip's real GX/TEV renderer.
 *
 * One shared offscreen WebGL2 canvas + GfxDevice is created lazily and reused for every
 * thumbnail; per-model GPU resources (models, textures) are destroyed right after the read
 * back so a content browser full of objects does not leak VRAM.
 *
 * This module statically imports the vendored noclip renderer, so it should only ever be
 * pulled in through a dynamic `import()` from the thumbnail service.
 */

import { mat4 } from 'gl-matrix';
import ArrayBufferSlice from '../../../vendor/noclip.website/src/ArrayBufferSlice';
import AnimationController from '../../../vendor/noclip.website/src/AnimationController';
import { Camera } from '../../../vendor/noclip.website/src/Camera';
import { colorNewFromRGBA } from '../../../vendor/noclip.website/src/Color';
import * as BRRES from '../../../vendor/noclip.website/src/rres/brres';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from '../../../vendor/noclip.website/src/rres/render';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../../../vendor/noclip.website/src/gx/gx_render';
import { calcMipChain, decodeTexture } from '../../../vendor/noclip.website/src/gx/gx_texture';
import { GfxFormat, makeTextureDescriptor2D, type GfxTexture } from '../../../vendor/noclip.website/src/gfx/platform/GfxPlatform';
import type { GXMaterialHacks } from '../../../vendor/noclip.website/src/gx/gx_material';
import {
  createSwapChainForWebGL2,
  GfxPlatformWebGL2Config,
} from '../../../vendor/noclip.website/src/gfx/platform/GfxPlatformWebGL2';
import { GfxrAttachmentSlot } from '../../../vendor/noclip.website/src/gfx/render/GfxRenderGraph';
import {
  AntialiasingMode,
  makeAttachmentClearDescriptor,
  makeBackbufferDescSimple,
} from '../../../vendor/noclip.website/src/gfx/helpers/RenderGraphHelpers';
import {
  GfxRendererLayer,
  GfxRenderInstList,
} from '../../../vendor/noclip.website/src/gfx/render/GfxRenderInstManager';
import {
  computeStudioFraming,
  expandBoundsByPoint,
  isUsableBounds,
  makeEmptyBounds,
  type Bounds3,
  type StudioFramingOptions,
} from './framing';
import { selectThumbnailModelNames } from './modelSelection';

export interface ThumbnailRenderOptions extends StudioFramingOptions {
  /** Output image edge length in CSS pixels. */
  size?: number;
  /** Render at `size * supersample` and downscale for cheap extra antialiasing. */
  supersample?: number;
  /**
   * Extra BRRES archives whose TEX0 entries should be made available to the model.
   * Common.szs objects frequently reference textures that live in a sibling archive.
   */
  extraTextureArchives?: Uint8Array[];
  /** Restrict rendering to these MDL0 names (default: chosen by `selectThumbnailModelNames`). */
  modelNames?: string[];
  /**
   * Name of the MDL0 that represents the object, usually the BRRES file's base name. When it
   * matches a model in the archive only that model is drawn, which is how the game picks the
   * presentation mesh out of `itembox` / `itembox-low` / `itembox-shadow`.
   */
  preferModelName?: string | null;
  /** Background colour behind the model. Alpha 0 keeps the tile background visible. */
  background?: { r: number; g: number; b: number; a: number };
}

export interface ThumbnailRenderResult {
  dataUrl: string;
  /** Fraction of the frame covered by the model; used to reject empty renders. */
  coverage: number;
  modelCount: number;
}

/**
 * Same lighting fudge noclip uses for Mario Kart Wii courses that ship without a BLIGHT.
 * It keeps unlit-looking materials readable without needing a scene light set.
 */
const thumbnailMaterialHacks: GXMaterialHacks = {
  lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

/**
 * Clear colour behind the model. Kept byte-identical to the `--surface-input` token the
 * content browser paints its thumbnail slots with (#0d1117), so the render and the tile it
 * sits in are the same colour and a letterboxed thumbnail has no visible frame.
 */
const DEFAULT_BACKGROUND = { r: 13 / 255, g: 17 / 255, b: 23 / 255, a: 1 };
const DEFAULT_SIZE = 128;
const DEFAULT_SUPERSAMPLE = 2;

type ThumbnailSwapChain = ReturnType<typeof createSwapChainForWebGL2>;

interface ThumbnailDevice {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  swapChain: ThumbnailSwapChain;
  device: ReturnType<ThumbnailSwapChain['getDevice']>;
  renderHelper: GXRenderHelperGfx;
  renderInstList: GfxRenderInstList;
  width: number;
  height: number;
}

let sharedDevice: ThumbnailDevice | null = null;
let deviceUnavailable = false;

export function isThumbnailRendererAvailable(): boolean {
  if (deviceUnavailable) return false;
  if (sharedDevice !== null) return true;
  return typeof document !== 'undefined';
}

export function destroyThumbnailDevice(): void {
  if (sharedDevice === null) return;
  try {
    sharedDevice.renderHelper.destroy();
  } catch {
    // The context may already be gone; nothing useful to do.
  }
  sharedDevice = null;
}

function ensureDevice(width: number, height: number): ThumbnailDevice | null {
  if (deviceUnavailable) return null;
  if (typeof document === 'undefined') {
    deviceUnavailable = true;
    return null;
  }

  if (sharedDevice === null) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
    if (gl === null) {
      deviceUnavailable = true;
      return null;
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      destroyThumbnailDevice();
    });

    const config = new GfxPlatformWebGL2Config();
    const swapChain = createSwapChainForWebGL2(gl, config);
    const device = swapChain.getDevice();
    sharedDevice = {
      canvas,
      gl,
      swapChain,
      device,
      renderHelper: new GXRenderHelperGfx(device),
      renderInstList: new GfxRenderInstList(),
      width: 0,
      height: 0,
    };
  }

  if (sharedDevice.width !== width || sharedDevice.height !== height) {
    sharedDevice.canvas.width = width;
    sharedDevice.canvas.height = height;
    sharedDevice.swapChain.configureSwapChain(width, height);
    sharedDevice.width = width;
    sharedDevice.height = height;
  }

  return sharedDevice;
}

/** Model-space bounding box of an MDL0, with fallbacks for models that omit theirs. */
export function computeMdl0Bounds(mdl0: BRRES.MDL0): Bounds3 | null {
  const fromModel = aabbToBounds(mdl0.bbox as AabbLike | null);
  if (isUsableBounds(fromModel)) return fromModel;

  // Fall back to the union of the node boxes placed by their bind pose.
  const nodeBounds = makeEmptyBounds();
  for (const node of mdl0.nodes) {
    const local = aabbToBounds(node.bbox as AabbLike | null);
    if (!isUsableBounds(local)) continue;
    addTransformedBox(nodeBounds, local, node.forwardBindPose);
  }
  if (isUsableBounds(nodeBounds)) return nodeBounds;

  // Last resort: the raw positions in the loaded vertex data. These are in bone-local space
  // so the framing is approximate, but it beats not drawing anything.
  const vertexBounds = makeEmptyBounds();
  for (const shape of mdl0.shapes) addShapePositionBounds(vertexBounds, shape);
  return isUsableBounds(vertexBounds) ? vertexBounds : null;
}

/**
 * The vendored `rres/brres.ts` declares its own minimal AABB with `minX`..`maxZ` fields, while
 * noclip's shared `Geometry.ts` AABB uses `min`/`max` vec3s. Accept either shape.
 */
interface AabbLike {
  readonly min?: ArrayLike<number>;
  readonly max?: ArrayLike<number>;
  readonly minX?: number;
  readonly minY?: number;
  readonly minZ?: number;
  readonly maxX?: number;
  readonly maxY?: number;
  readonly maxZ?: number;
}

function aabbToBounds(aabb: AabbLike | null | undefined): Bounds3 | null {
  if (aabb === null || aabb === undefined) return null;
  if (aabb.min !== undefined && aabb.max !== undefined) {
    return {
      min: [aabb.min[0], aabb.min[1], aabb.min[2]],
      max: [aabb.max[0], aabb.max[1], aabb.max[2]],
    };
  }
  if (aabb.minX === undefined || aabb.maxX === undefined) return null;
  return {
    min: [aabb.minX, aabb.minY ?? 0, aabb.minZ ?? 0],
    max: [aabb.maxX, aabb.maxY ?? 0, aabb.maxZ ?? 0],
  };
}

function addTransformedBox(dst: Bounds3, box: Bounds3, m: mat4): void {
  for (let corner = 0; corner < 8; corner++) {
    const x = (corner & 1 ? box.max : box.min)[0];
    const y = (corner & 2 ? box.max : box.min)[1];
    const z = (corner & 4 ? box.max : box.min)[2];
    expandBoundsByPoint(
      dst,
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    );
  }
}

function addShapePositionBounds(dst: Bounds3, shape: BRRES.MDL0_ShapeEntry): void {
  const layout = shape.loadedVertexLayout;
  const data = shape.loadedVertexData;
  const buffer = data?.vertexBuffers?.[0];
  const stride = layout?.vertexBufferStrides?.[0];
  // Attribute 9 is GX.Attr.POS in the loaded vertex layout.
  const offset = layout?.vertexAttributeOffsets?.[9];
  if (!buffer || !stride || offset === undefined || offset < 0) return;
  const view = new DataView(buffer);
  const vertexCount = Math.min(data.totalVertexCount ?? 0, Math.floor((view.byteLength - offset) / stride));
  for (let i = 0; i < vertexCount; i++) {
    const base = i * stride + offset;
    if (base + 12 > view.byteLength) break;
    expandBoundsByPoint(dst, view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true));
  }
}

/**
 * Render every model in `data` (plus any extra texture archives) to a PNG data URL.
 * Returns null when the renderer is unavailable or the archive has nothing drawable.
 */
export async function renderBrresThumbnail(
  data: Uint8Array,
  options: ThumbnailRenderOptions = {},
): Promise<ThumbnailRenderResult | null> {
  const size = Math.max(16, Math.round(options.size ?? DEFAULT_SIZE));
  const supersample = Math.max(1, Math.min(4, Math.round(options.supersample ?? DEFAULT_SUPERSAMPLE)));
  const renderSize = size * supersample;

  const shared = ensureDevice(renderSize, renderSize);
  if (shared === null) return null;
  if (shared.gl.isContextLost()) {
    destroyThumbnailDevice();
    return null;
  }

  let rres: BRRES.RRES;
  try {
    rres = BRRES.parse(toSlice(data));
  } catch {
    return null;
  }
  if (rres.mdl0.length === 0) return null;

  const { device, renderHelper, renderInstList } = shared;
  const textureHolder = new RRESTextureHolder();
  const ownedTextures: GfxTexture[] = [];
  const models: MDL0Model[] = [];
  const instances: MDL0ModelInstance[] = [];
  const animationController = new AnimationController(60);
  animationController.setTimeInMilliseconds(0);

  try {
    // Extra archives go in first so shared textures resolve, but the model's own TEX0
    // entries win for any name collision.
    for (const extra of options.extraTextureArchives ?? []) {
      try {
        await uploadRresTextures(device, BRRES.parse(toSlice(extra)), textureHolder, ownedTextures);
      } catch {
        // A bad sibling archive should never stop the main model from rendering.
      }
    }
    await uploadRresTextures(device, rres, textureHolder, ownedTextures);

    const wanted = new Set(
      options.modelNames ?? selectThumbnailModelNames(rres.mdl0.map((mdl0) => mdl0.name), options.preferModelName),
    );
    const bounds = makeEmptyBounds();
    for (const mdl0 of rres.mdl0) {
      if (!wanted.has(mdl0.name)) continue;
      let model: MDL0Model;
      try {
        model = new MDL0Model(device, renderHelper.renderCache, mdl0, thumbnailMaterialHacks);
      } catch {
        continue;
      }
      models.push(model);

      let instance: MDL0ModelInstance;
      try {
        instance = new MDL0ModelInstance(textureHolder, model, mdl0.name);
      } catch {
        continue;
      }
      instance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
      try {
        // Frame 0 of every SRT0/PAT0/CLR0/VIS0/CHR0 in the archive.
        instance.bindRRESAnimations(animationController, rres, null);
      } catch {
        // Animations are cosmetic here; a malformed one must not lose the thumbnail.
      }
      instances.push(instance);

      const modelBounds = computeMdl0Bounds(mdl0);
      if (modelBounds !== null) {
        expandBoundsByPoint(bounds, modelBounds.min[0], modelBounds.min[1], modelBounds.min[2]);
        expandBoundsByPoint(bounds, modelBounds.max[0], modelBounds.max[1], modelBounds.max[2]);
      }
    }

    if (instances.length === 0 || !isUsableBounds(bounds)) return null;

    const framing = computeStudioFraming(bounds, { ...options, aspect: 1 });
    const camera = new Camera();
    camera.clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
    camera.aspect = 1;
    camera.setPerspective(framing.fovY, 1, framing.near, framing.far);
    mat4.targetTo(
      camera.worldMatrix,
      [framing.eye[0], framing.eye[1], framing.eye[2]],
      [framing.target[0], framing.target[1], framing.target[2]],
      [framing.up[0], framing.up[1], framing.up[2]],
    );
    camera.worldMatrixUpdated();

    const background = options.background ?? DEFAULT_BACKGROUND;
    const clearDescriptor = makeAttachmentClearDescriptor(
      colorNewFromRGBA(background.r, background.g, background.b, background.a),
    );

    const viewerInput = {
      camera,
      time: 0,
      deltaTime: 0,
      backbufferWidth: renderSize,
      backbufferHeight: renderSize,
      onscreenTexture: shared.swapChain.getOnscreenTexture(),
      antialiasingMode: AntialiasingMode.MSAAx4,
      mouseLocation: { mouseX: -1, mouseY: -1 },
      debugConsole: null,
    } as unknown as Parameters<MDL0ModelInstance['prepareToRender']>[2];

    const colorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearDescriptor);
    const depthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearDescriptor);

    const builder = renderHelper.renderGraph.newGraphBuilder();
    const colorTargetID = builder.createRenderTargetID(colorDesc, 'Thumbnail Color');
    const depthTargetID = builder.createRenderTargetID(depthDesc, 'Thumbnail Depth');
    builder.pushPass((pass) => {
      pass.setDebugName('Thumbnail');
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, colorTargetID);
      pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, depthTargetID);
      pass.exec((passRenderer) => {
        renderInstList.drawOnPassRenderer(renderHelper.renderCache, passRenderer);
      });
    });
    builder.resolveRenderTargetToExternalTexture(colorTargetID, viewerInput.onscreenTexture);

    const template = renderHelper.pushTemplateRenderInst();
    // A thumbnail is a single one-off frame, so we cannot let draws be skipped while their
    // shaders compile in the background the way the live viewport does.
    template.setAllowSkippingIfPipelineNotReady(false);
    fillSceneParamsDataOnTemplate(template, viewerInput);
    renderHelper.renderInstManager.setCurrentList(renderInstList);
    for (const instance of instances) {
      mat4.identity(instance.modelMatrix);
      try {
        instance.prepareToRender(device, renderHelper.renderInstManager, viewerInput);
      } catch {
        // Skip models whose shape data we cannot process.
      }
    }
    renderHelper.prepareToRender();
    renderHelper.renderInstManager.popTemplate();

    builder.execute();
    renderInstList.reset();

    return readbackToDataUrl(shared, renderSize, size, models.length, background);
  } finally {
    for (const model of models) {
      try {
        model.destroy(device);
      } catch {
        // Ignore teardown failures; the shared device stays usable.
      }
    }
    for (const texture of ownedTextures) {
      try {
        device.destroyTexture(texture);
      } catch {
        // Ignore teardown failures.
      }
    }
    try {
      textureHolder.destroy(device);
    } catch {
      // Ignore teardown failures.
    }
  }
}

/**
 * Decode and upload every TEX0 in {@param rres}, waiting for each upload to finish.
 *
 * noclip's `RRESTextureHolder.addRRESTextures` uploads asynchronously and drops the promises,
 * which is fine for a continuous render loop but leaves a one-shot thumbnail sampling empty
 * textures (and, with alpha testing, discarding every fragment). Registering the finished
 * textures as overrides keeps the decode deterministic.
 */
async function uploadRresTextures(
  device: ThumbnailDevice['device'],
  rres: BRRES.RRES,
  holder: RRESTextureHolder,
  ownedTextures: GfxTexture[],
): Promise<void> {
  for (const tex0 of rres.tex0) {
    if (tex0.data === null || tex0.width <= 0 || tex0.height <= 0) continue;
    try {
      const mipChain = calcMipChain(tex0, tex0.mipCount);
      const firstMip = mipChain.mipLevels[0];
      if (firstMip === undefined) continue;
      const gfxTexture = device.createTexture(
        makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, firstMip.width, firstMip.height, mipChain.mipLevels.length),
      );
      device.setResourceName(gfxTexture, tex0.name);
      ownedTextures.push(gfxTexture);
      for (let level = 0; level < mipChain.mipLevels.length; level++) {
        const decoded = await decodeTexture(mipChain.mipLevels[level]);
        device.uploadTextureData(gfxTexture, level, [decoded.pixels]);
      }
      holder.setTextureOverride(tex0.name, {
        gfxTexture,
        width: firstMip.width,
        height: firstMip.height,
        flipY: false,
      });
    } catch {
      // A texture we cannot decode just renders untextured.
    }
  }
}

function readbackToDataUrl(
  shared: ThumbnailDevice,
  renderSize: number,
  outputSize: number,
  modelCount: number,
  background: { r: number; g: number; b: number; a: number },
): ThumbnailRenderResult | null {
  const { gl } = shared;
  const pixels = new Uint8Array(renderSize * renderSize * 4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.readPixels(0, 0, renderSize, renderSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // WebGL reads bottom-up; flip into an ImageData while counting drawn pixels.
  const flipped = new Uint8ClampedArray(renderSize * renderSize * 4);
  const rowBytes = renderSize * 4;
  let covered = 0;
  for (let y = 0; y < renderSize; y++) {
    const src = (renderSize - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  // GX materials frequently disable alpha writes, so "was something drawn here" is measured
  // against the clear colour rather than against alpha.
  const clearR = Math.round(background.r * 255);
  const clearG = Math.round(background.g * 255);
  const clearB = Math.round(background.b * 255);
  const clearA = Math.round(background.a * 255);
  for (let i = 0; i < flipped.length; i += 4) {
    if (
      Math.abs(flipped[i] - clearR) > 2 ||
      Math.abs(flipped[i + 1] - clearG) > 2 ||
      Math.abs(flipped[i + 2] - clearB) > 2 ||
      Math.abs(flipped[i + 3] - clearA) > 2
    )
      covered++;
  }
  const coverage = covered / (renderSize * renderSize);
  if (covered === 0) return null;

  const source = document.createElement('canvas');
  source.width = renderSize;
  source.height = renderSize;
  const sourceCtx = source.getContext('2d');
  if (sourceCtx === null) return null;
  sourceCtx.putImageData(new ImageData(flipped, renderSize, renderSize), 0, 0);

  if (renderSize === outputSize) {
    return { dataUrl: source.toDataURL('image/png'), coverage, modelCount };
  }

  const target = document.createElement('canvas');
  target.width = outputSize;
  target.height = outputSize;
  const targetCtx = target.getContext('2d');
  if (targetCtx === null) return null;
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';
  targetCtx.drawImage(source, 0, 0, outputSize, outputSize);
  return { dataUrl: target.toDataURL('image/png'), coverage, modelCount };
}

function toSlice(data: Uint8Array): ArrayBufferSlice {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new ArrayBufferSlice(copy.buffer);
}
