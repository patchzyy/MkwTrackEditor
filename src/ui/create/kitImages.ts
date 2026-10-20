/**
 * Object URLs for images stored inside the asset kit (theme previews, surface thumbnails), made
 * once per kit and path. The kit lives for the whole session, so the URLs are never revoked.
 */
import type { CreateKit } from '../../lib/create/types';

const cache = new WeakMap<CreateKit, Map<string, string | null>>();

export function kitImageUrl(kit: CreateKit | null, path: string | undefined): string | null {
  if (!kit || !path || typeof URL === 'undefined' || typeof Blob === 'undefined') return null;
  let perKit = cache.get(kit);
  if (!perKit) {
    perKit = new Map();
    cache.set(kit, perKit);
  }
  if (perKit.has(path)) return perKit.get(path) ?? null;
  const bytes = kit.file(path);
  let url: string | null = null;
  if (bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    url = URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
  }
  perKit.set(path, url);
  return url;
}

/** `linear-gradient` for a theme card or chip, from `KitTheme.accent`. */
export function themeGradient(accent: readonly [string, string] | undefined): string {
  const [a, b] = accent ?? ['#2a3442', '#3b4a5c'];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
