// Post-effect (fog / bloom / DOF / lighting) file discovery and small colour helpers.
// Extracted from src/ui/App.tsx.
import {
  parseBlight,
  parseBblm,
  parseBdof,
  parseBfgFogEntries,
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectDofFile,
  type PostEffectFogEntry,
  type RgbColor,
} from '../../lib/posteffects';
import type { TrackDocument } from '../../lib/track';

export type AreaFogPreset = PostEffectFogEntry;
export interface PostEffectBloomPresetFile {
  index: number;
  path: string;
  data: PostEffectBloomFile;
}

export interface PostEffectDofFileRecord {
  label: string;
  path: string;
  data: PostEffectDofFile;
}

export interface PostEffectResources {
  fogPath: string | null;
  fogPresets: AreaFogPreset[];
  bloomFiles: PostEffectBloomPresetFile[];
  dofFiles: PostEffectDofFileRecord[];
  blightPath: string | null;
  blight: PostEffectBlightFile | null;
}
export const emptyPostEffectResources: PostEffectResources = { fogPath: null, fogPresets: [], bloomFiles: [], dofFiles: [], blightPath: null, blight: null };
export function getTrackPostEffectResources(track: TrackDocument | null): PostEffectResources {
  if (!track) return emptyPostEffectResources;
  const fogEntry = track.archiveEntries.find((entry) => entry.type === 'file' && /posteffect\/posteffect\.bfg$/i.test(entry.path));
  const fogPresets = fogEntry?.data ? parseBfgFogEntries(fogEntry.data) : [];
  const bloomFiles = track.archiveEntries
    .filter((entry) => entry.type === 'file' && /posteffect\/posteffect\.bblm\d*$/i.test(entry.path))
    .map((entry) => {
      const match = entry.path.match(/posteffect\.bblm(\d*)$/i);
      const suffix = match?.[1] ?? '';
      const index = suffix === '' ? 0 : Number(suffix);
      const parsed = entry.data && Number.isFinite(index) ? parseBblm(entry.data) : null;
      return parsed ? { index, path: entry.path, data: parsed } : null;
    })
    .filter((preset): preset is PostEffectBloomPresetFile => preset !== null)
    .sort((a, b) => a.index - b.index);
  const dofFiles = track.archiveEntries
    .filter((entry) => entry.type === 'file' && /posteffect\/posteffect\.bdof(_demo)?$/i.test(entry.path))
    .map((entry) => {
      const parsed = entry.data ? parseBdof(entry.data) : null;
      if (!parsed) return null;
      return {
        label: /_demo$/i.test(entry.path) ? 'Intro DOF' : 'Main DOF',
        path: entry.path,
        data: parsed,
      };
    })
    .filter((entry): entry is PostEffectDofFileRecord => entry !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
  const blightEntry = track.archiveEntries.find((entry) => entry.type === 'file' && /posteffect\/posteffect\.blight$/i.test(entry.path));
  return { fogPath: fogEntry?.path ?? null, fogPresets, bloomFiles, dofFiles, blightPath: blightEntry?.path ?? null, blight: blightEntry?.data ? parseBlight(blightEntry.data) : null };
}

export function getFogTypeLabel(fogType: number): string {
  switch (fogType) {
    case 0: return 'None';
    case 1: return 'Persp Linear';
    case 2: return 'Persp Exp';
    case 3: return 'Persp Exp2';
    case 4: return 'Persp InvExp';
    case 5: return 'Persp InvExp2';
    case 6: return 'Ortho Linear';
    case 7: return 'Ortho Exp';
    case 8: return 'Ortho Exp2';
    case 9: return 'Ortho InvExp';
    case 10: return 'Ortho InvExp2';
    default: return `Type ${fogType}`;
  }
}

export function formatCompactFloat(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(Math.abs(value) >= 10 ? 1 : 2)).toString() : '0';
}

export function findArchiveData(track: TrackDocument, path: string): Uint8Array | null {
  const entry = track.archiveEntries.find((candidate) => candidate.type === 'file' && candidate.path.toLowerCase() === path.toLowerCase());
  return entry?.data ?? null;
}

export function rgbToHex(color: RgbColor): string {
  return `#${color.map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(value: string): RgbColor {
  const normalized = value.replace('#', '').trim();
  if (normalized.length !== 6) return [255, 255, 255];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ].map((channel) => (Number.isFinite(channel) ? channel : 255)) as RgbColor;
}

export function clampByte(value: number): number {
  return Math.max(0, Math.min(0xff, Math.round(value)));
}
