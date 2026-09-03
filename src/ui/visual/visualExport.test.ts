/**
 * End-to-end proof that the two kinds of Visual-mode edit survive export: a texture replacement
 * and a post-effect change are applied to a real track, exported to a `.szs`, and then read back
 * out of the exported archive.
 *
 * Runs against the real tracks on this machine and skips itself when they are not present.
 */
import { describe, expect, it } from 'vitest';
import ArrayBufferSlice from '../../../vendor/noclip.website/src/ArrayBufferSlice.js';
import { parse as parseBrres } from '../../../vendor/noclip.website/src/rres/brres.js';
import { exportTrack, loadTrackBytes, replaceArchiveFile, validateExportBytes, type TrackDocument } from '../../lib/track';
import { parseBfgFogEntries, writeBfgFogEntries } from '../../lib/posteffects';
import { canEncodeTex0Format, type RgbaImage } from '../../lib/tex0Codec';
import { listBrresTextures } from '../../lib/tex0Brres';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from '../../lib/realTrackFixtures.testdata';
import { applyTextureReplacement, buildTextureReplacement } from './textureReplace';
import { findArchiveBytes, listVisualArchivePaths, readVisualArchive, type VisualTextureInfo } from './visualArchive';

const trackPaths = [...listTracks(CUSTOM_TRACK_DIR, 2), ...listTracks(NINTENDO_TRACK_DIR, 2)];

/** A deterministic, high-contrast test image; every encodable GX format keeps its structure. */
function makeTestImage(width: number, height: number): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) % 2 === 0;
      pixels[offset + 0] = checker ? 0xff : 0x00;
      pixels[offset + 1] = checker ? 0x00 : 0xff;
      pixels[offset + 2] = 0x00;
      pixels[offset + 3] = 0xff;
    }
  }
  return { width, height, pixels };
}

function readArchive(track: TrackDocument, path: string): Uint8Array {
  const bytes = findArchiveBytes(track, path);
  if (!bytes) throw new Error(`${path} missing from the track`);
  return bytes;
}

/** Re-reads an exported `.szs` back into a track document. */
async function reload(track: TrackDocument, fileName: string): Promise<TrackDocument> {
  return loadTrackBytes(exportTrack(track), fileName);
}

const describeIfTracks = trackPaths.length > 0 ? describe : describe.skip;

describeIfTracks('Visual mode edits survive export', () => {
  for (const trackPath of trackPaths) {
    const fileName = trackPath.split(/[\\/]/).pop() as string;

    it(`${fileName}: a replaced texture is in the exported archive and the archive still parses`, async () => {
      const track = await loadTrackBytes(readTrackBytes(trackPath), fileName);
      const archivePath = listVisualArchivePaths(track)[0];
      expect(archivePath, 'the track has at least one .brres').toBeTruthy();

      const originalBytes = readArchive(track, archivePath);
      const info = await readVisualArchive(archivePath, originalBytes);
      expect(info.error).toBeUndefined();

      // The smallest writable texture with room for the replacement: fastest to encode, and the
      // one most likely to be tightly packed, so it also exercises the capacity check.
      const texture = info.textures
        .filter((candidate) => canEncodeTex0Format(candidate.format) && candidate.dataOffset >= 0 && candidate.dataCapacity > 0)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0] as VisualTextureInfo | undefined;
      if (!texture) return; // Nothing in this archive is writable; the format tests cover why.

      const replacement = buildTextureReplacement(makeTestImage(texture.width, texture.height), texture);
      expect(replacement.pixelData.byteLength).toBeLessThanOrEqual(texture.dataCapacity);
      // The encoded pixels must differ from what was there, or the assertion below proves nothing.
      const before = originalBytes.subarray(texture.dataOffset, texture.dataOffset + replacement.pixelData.byteLength);
      expect([...before]).not.toEqual([...replacement.pixelData]);

      const patched = applyTextureReplacement(originalBytes, texture.name, replacement);
      const edited = replaceArchiveFile(track, archivePath, patched);
      // Some real tracks (battle arenas) already fail KMP-level checks, so the bar is that the
      // texture edit adds no new export error of its own.
      const errorCodes = (document: TrackDocument) =>
        validateExportBytes(document, exportTrack(document))
          .filter((issue) => issue.level === 'error')
          .map((issue) => issue.code)
          .sort();
      expect(errorCodes(edited)).toEqual(errorCodes(track));

      const exported = await reload(edited, fileName);
      const exportedArchive = readArchive(exported, archivePath);

      // The pixel bytes made the round trip through U8 + Yaz0 unchanged.
      const location = listBrresTextures(exportedArchive).find((candidate) => candidate.name === texture.name);
      expect(location, `${texture.name} still in the exported archive`).toBeTruthy();
      const after = exportedArchive.subarray(location!.dataOffset, location!.dataOffset + replacement.pixelData.byteLength);
      expect([...after]).toEqual([...replacement.pixelData]);

      // ...and the archive is still a BRRES the renderer can load, with the TEX0 header intact.
      const copy = exportedArchive.slice();
      const rres = parseBrres(new ArrayBufferSlice(copy.buffer, copy.byteOffset, copy.byteLength));
      const tex0 = rres.tex0.find((candidate: { name: string }) => candidate.name === texture.name);
      expect(tex0).toBeTruthy();
      expect(tex0.width).toBe(replacement.width);
      expect(tex0.height).toBe(replacement.height);
      expect(tex0.format).toBe(replacement.format);
      expect(rres.mdl0.length).toBe(info.models.length);
    });

    it(`${fileName}: a fog edit is in the exported archive`, async () => {
      const track = await loadTrackBytes(readTrackBytes(trackPath), fileName);
      const fogEntry = track.archiveEntries.find(
        (entry) => entry.type === 'file' && /posteffect\/posteffect\.bfg$/i.test(entry.path),
      );
      if (!fogEntry?.data) return; // Not every track ships fog.

      const presets = parseBfgFogEntries(fogEntry.data);
      expect(presets.length).toBeGreaterThan(0);
      const nextPresets = presets.map((preset, index) =>
        index === 0 ? { ...preset, startZ: 1234.5, endZ: 6789, color: [12, 34, 56] as [number, number, number] } : preset,
      );

      const edited = replaceArchiveFile(track, fogEntry.path, writeBfgFogEntries(fogEntry.data, nextPresets));
      const exported = await reload(edited, fileName);
      const exportedFog = exported.archiveEntries.find(
        (entry) => entry.type === 'file' && entry.path.toLowerCase() === fogEntry.path.toLowerCase(),
      );
      expect(exportedFog?.data).toBeTruthy();

      const roundTripped = parseBfgFogEntries(exportedFog!.data as Uint8Array);
      expect(roundTripped[0].startZ).toBeCloseTo(1234.5, 3);
      expect(roundTripped[0].endZ).toBeCloseTo(6789, 3);
      expect(roundTripped[0].color).toEqual([12, 34, 56]);
      // Every other preset is byte-identical.
      expect(roundTripped.slice(1)).toEqual(presets.slice(1));
    });
  }
});
