import { useEffect, useState } from 'react';
import { decodeTextureImage, textureImageToDataUrl } from '../../lib/noclipBrres';
import type { VisualTextureInfo } from './visualArchive';

/**
 * Decodes a TEX0 to a PNG data URL once per (texture, bytes) pair and caches it, so scrolling the
 * texture list does not re-run the GX decoder. Keyed by the archive bytes' identity plus the
 * texture's data offset, so a replaced texture invalidates its own entry.
 */
const previewCache = new Map<string, string | null>();
const previewPending = new Map<string, Promise<string | null>>();

/** A stable number per archive byte array, so a decode of one set of bytes is never reused for another. */
const bytesIds = new WeakMap<Uint8Array, number>();
let nextBytesId = 1;
function bytesId(bytes: Uint8Array): number {
  let id = bytesIds.get(bytes);
  if (id === undefined) {
    id = nextBytesId++;
    bytesIds.set(bytes, id);
  }
  return id;
}

function cacheKey(archivePath: string, archiveBytes: Uint8Array, texture: VisualTextureInfo, revision: number): string {
  return `${archivePath}|${bytesId(archiveBytes)}|${texture.name}|${texture.dataOffset}|${texture.format}|${texture.width}x${texture.height}|${revision}`;
}

async function loadPreview(
  archivePath: string,
  archiveBytes: Uint8Array,
  texture: VisualTextureInfo,
  revision: number,
): Promise<string | null> {
  const key = cacheKey(archivePath, archiveBytes, texture, revision);
  const cached = previewCache.get(key);
  if (cached !== undefined) return cached;
  const inFlight = previewPending.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    if (texture.dataOffset < 0) return null;
    const data = archiveBytes.subarray(texture.dataOffset, texture.dataOffset + texture.dataCapacity);
    const image = await decodeTextureImage({ ...texture, data }, 0);
    const url = image ? textureImageToDataUrl(image) : null;
    previewCache.set(key, url);
    // Every edit of an archive makes new keys, so keep only the newest decodes.
    if (previewCache.size > 800) previewCache.delete(previewCache.keys().next().value as string);
    previewPending.delete(key);
    return url;
  })();
  previewPending.set(key, promise);
  return promise;
}

export function useTexturePreview(
  archivePath: string,
  archiveBytes: Uint8Array | null,
  texture: VisualTextureInfo | null,
  revision: number,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!archiveBytes || !texture) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void loadPreview(archivePath, archiveBytes, texture, revision).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [archivePath, archiveBytes, texture, revision]);
  return url;
}

/** A decoded texture on a checkerboard, so transparency is obvious. */
export function TexturePreview({
  archivePath,
  archiveBytes,
  texture,
  revision,
  size = 'tile',
}: {
  archivePath: string;
  archiveBytes: Uint8Array | null;
  texture: VisualTextureInfo | null;
  revision: number;
  size?: 'tile' | 'large';
}) {
  const url = useTexturePreview(archivePath, archiveBytes, texture, revision);
  const className = size === 'large' ? 'visualCheckerboard visualTexturePreviewLarge' : 'visualCheckerboard visualCheckerboardTile';
  return (
    <div className={className}>
      {url && <img src={url} alt={texture ? `${texture.name} preview` : 'Texture preview'} />}
    </div>
  );
}
