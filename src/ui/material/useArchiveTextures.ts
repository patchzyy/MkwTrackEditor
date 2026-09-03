// Pairs the contract's texture list with the byte offsets `TexturePreview` needs to decode a
// thumbnail. The offsets come from `src/lib/tex0Brres.ts` — the same walk Visual mode's texture
// browser uses — so a material layer's thumbnail and Visual mode's tile are the same picture.
import { useMemo } from 'react';
import { listBrresTextures } from '../../lib/tex0Brres';
import type { GxTextureSummary } from '../../lib/gxMaterial';
import type { VisualTextureInfo } from '../visual/visualArchive';
import { textureFormatLabel } from './gxOptions';

export function useArchiveTextures(
  archiveBytes: Uint8Array | null,
  textures: readonly GxTextureSummary[],
): VisualTextureInfo[] {
  return useMemo(() => {
    if (!archiveBytes) return [];
    const locations = new Map(listBrresTextures(archiveBytes).map((location) => [location.name, location]));
    // A texture the summary does not know about (one that was just imported) still shows, so the
    // picker is never missing the thing the author has this second added.
    const names = new Set(textures.map((texture) => texture.name));
    const extra = [...locations.keys()].filter((name) => !names.has(name));
    const summaries: GxTextureSummary[] = [
      ...textures,
      ...extra.map((name) => {
        const location = locations.get(name)!;
        return {
          name,
          width: location.width,
          height: location.height,
          format: location.format as GxTextureSummary['format'],
          mipCount: location.mipCount,
          usedBy: [],
        };
      }),
    ];
    return summaries.map((texture) => {
      const location = locations.get(texture.name);
      return {
        name: texture.name,
        width: texture.width,
        height: texture.height,
        format: texture.format,
        formatLabel: textureFormatLabel(texture.format),
        mipCount: Math.max(1, texture.mipCount),
        byteLength: location?.dataSize ?? 0,
        dataOffset: location?.dataOffset ?? -1,
        dataCapacity: location?.dataSize ?? 0,
        usedBy: texture.usedBy,
      };
    });
  }, [archiveBytes, textures]);
}
