import { describe, expect, it } from 'vitest';
import { buildBrresThumbnailKey, getBrresThumbnail, peekBrresThumbnail } from './index';

const bytes = new Uint8Array([0xff, 0x00, 0x13, 0x37, 0x42]);
const otherBytes = new Uint8Array([0xff, 0x00, 0x13, 0x37, 0x43]);

describe('buildBrresThumbnailKey', () => {
  it('is stable for the same bytes and options', () => {
    expect(buildBrresThumbnailKey(bytes, { size: 128 })).toBe(buildBrresThumbnailKey(bytes, { size: 128 }));
  });

  it('separates different content, sizes and variants', () => {
    const base = buildBrresThumbnailKey(bytes, { size: 128 });
    expect(base).not.toBe(buildBrresThumbnailKey(otherBytes, { size: 128 }));
    expect(base).not.toBe(buildBrresThumbnailKey(bytes, { size: 256 }));
    expect(base).not.toBe(buildBrresThumbnailKey(bytes, { size: 128, variantKey: 'kart' }));
  });

  it('separates different extra texture archives', () => {
    const withoutExtras = buildBrresThumbnailKey(bytes);
    const withExtras = buildBrresThumbnailKey(bytes, { extraTextureArchives: [otherBytes] });
    expect(withoutExtras).not.toBe(withExtras);
  });
});

describe('getBrresThumbnail without a DOM', () => {
  it('resolves to null instead of throwing so callers can fall back', async () => {
    expect(typeof document).toBe('undefined');
    await expect(getBrresThumbnail(bytes)).resolves.toBeNull();
  });

  it('reports a cache miss for content that was never rendered', () => {
    expect(peekBrresThumbnail(otherBytes)).toBeUndefined();
  });
});
