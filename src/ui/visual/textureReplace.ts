// Turns a PNG/JPG the author picked into GX texture bytes that fit the existing TEX0 slot.
// The pure encoding lives in `src/lib/tex0Codec.ts`; this module only does the DOM work
// (decoding the picked image file) and the policy around sizes and mip counts.
import { decodeTextureImage, textureImageToCanvas } from '../../lib/noclipBrres';
import {
  calcTex0DataSize,
  canEncodeTex0Format,
  encodeTex0Data,
  floorPowerOfTwo,
  maxMipCount,
  type RgbaImage,
} from '../../lib/tex0Codec';
import { patchBrresTexture } from '../../lib/tex0Brres';
import type { VisualTextureInfo } from './visualArchive';

export interface TextureReplacement {
  pixelData: Uint8Array;
  width: number;
  height: number;
  format: number;
  mipCount: number;
  /** Source image size before resizing, for the status message. */
  sourceWidth: number;
  sourceHeight: number;
  notes: string[];
}

/** Reads an image file into straight RGBA8. Throws with a friendly message if it cannot. */
export async function readImageFile(file: File): Promise<RgbaImage> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('This browser cannot decode images for texture replacement.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} is not an image this browser can read (use PNG or JPG).`);
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a 2D canvas to read the image.');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(data.data.buffer.slice(0)) };
  } finally {
    bitmap.close();
  }
}

export interface BuildReplacementOptions {
  /** Override the output size. Defaults to the original TEX0 dimensions. */
  width?: number;
  height?: number;
  /** Override the mip count. Defaults to the original TEX0's. */
  mipCount?: number;
}

/**
 * Encodes `image` into the texture's own format at its own size. Dimensions, format and mip count
 * are kept by default because the BRRES is patched in place: growing the pixel data would mean
 * re-emitting the whole container (see `docs/WORKPLAN.md`; the BRRES writer is a separate task).
 */
export function buildTextureReplacement(
  image: RgbaImage,
  texture: VisualTextureInfo,
  options: BuildReplacementOptions = {},
): TextureReplacement {
  if (!canEncodeTex0Format(texture.format)) {
    throw new Error(`${texture.name} uses ${texture.formatLabel}, which this editor cannot write yet.`);
  }
  const notes: string[] = [];
  const width = clampToPowerOfTwo(options.width ?? texture.width);
  const height = clampToPowerOfTwo(options.height ?? texture.height);
  const requestedMips = options.mipCount ?? texture.mipCount;
  const mipCount = Math.max(1, Math.min(requestedMips, maxMipCount(width, height)));
  if (mipCount !== requestedMips) notes.push(`Mip levels reduced to ${mipCount} to fit ${width}x${height}.`);

  const needed = calcTex0DataSize(texture.format, width, height, mipCount);
  if (needed > texture.dataCapacity) {
    throw new Error(
      `A ${width}x${height} ${texture.formatLabel} texture needs ${needed} bytes but only ${texture.dataCapacity} are reserved. ` +
        'Keep the original size, or lower the mip count.',
    );
  }
  if (image.width !== width || image.height !== height) {
    notes.push(`Resized from ${image.width}x${image.height} to ${width}x${height}.`);
  }

  const pixelData = encodeTex0Data(image, texture.format, width, height, mipCount);
  return {
    pixelData,
    width,
    height,
    format: texture.format,
    mipCount,
    sourceWidth: image.width,
    sourceHeight: image.height,
    notes,
  };
}

/** Applies a built replacement to the archive's BRRES bytes. */
export function applyTextureReplacement(
  archiveBytes: Uint8Array,
  textureName: string,
  replacement: TextureReplacement,
): Uint8Array {
  return patchBrresTexture(archiveBytes, textureName, {
    pixelData: replacement.pixelData,
    width: replacement.width,
    height: replacement.height,
    format: replacement.format,
    mipCount: replacement.mipCount,
  });
}

/** Sizes an author can pick for a replacement without the BRRES having to grow. */
export function listReplacementSizes(texture: VisualTextureInfo): Array<{ width: number; height: number; label: string; fits: boolean }> {
  const sizes: Array<{ width: number; height: number }> = [{ width: texture.width, height: texture.height }];
  let width = texture.width;
  let height = texture.height;
  while (width > 1 || height > 1) {
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
    sizes.push({ width, height });
  }
  return sizes.map((size) => {
    const mipCount = Math.max(1, Math.min(texture.mipCount, maxMipCount(size.width, size.height)));
    const needed = calcTex0DataSize(texture.format, size.width, size.height, mipCount);
    return {
      ...size,
      label: `${size.width} x ${size.height}`,
      fits: needed <= texture.dataCapacity,
    };
  });
}

/** Downloads the texture's top mip level as a PNG. */
export async function exportTextureAsPng(
  archiveBytes: Uint8Array,
  texture: VisualTextureInfo,
): Promise<void> {
  const data = archiveBytes.subarray(texture.dataOffset, texture.dataOffset + texture.dataCapacity);
  const image = await decodeTextureImage({ ...texture, data }, 0);
  if (!image) throw new Error(`${texture.name} could not be decoded.`);
  const canvas = textureImageToCanvas(image);
  if (!canvas) throw new Error('This browser cannot render the texture to a PNG.');
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('This browser could not encode the PNG.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${texture.name}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clampToPowerOfTwo(value: number): number {
  const rounded = Math.max(1, Math.round(value));
  return floorPowerOfTwo(rounded) === rounded ? rounded : floorPowerOfTwo(rounded);
}
