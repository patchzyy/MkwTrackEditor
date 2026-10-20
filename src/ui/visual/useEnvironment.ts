// The state behind the Environment panel: reads the track's posteffect files in plain terms,
// turns every control into an edit of those files, and keeps the "drag to preview, release to
// commit one undo step" contract.
//
//  - A control calls `preview` while it is being dragged. The new file bytes go into a draft that
//    sits on top of the track; Visual mode pushes the draft at the renderer, so the viewport
//    follows the pointer. Nothing touches the track or the undo history yet.
//  - On release the control calls `commit`, which writes every drafted file into the track in ONE
//    history step.
//  - A look preset is the same thing at once: a draft of several files, committed immediately.
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { patchKmpStageField, patchKmpStageFlareColor, type KmpDocument } from '../../lib/kmp';
import {
  createDefaultBblm,
  createDefaultBdof,
  createDefaultBfg,
  createDefaultBlight,
  parseBblm,
  parseBdof,
  parseBfgFogEntries,
  parseBlight,
  writeBblm,
  writeBdof,
  writeBfgFogEntries,
  writeBlight,
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectDofFile,
  type PostEffectFogEntry,
  type RgbColor,
} from '../../lib/posteffects';
import { replaceArchiveFile, replaceCourseKmp, type TrackDocument } from '../../lib/track';
import { getTrackPostEffectResources, type PostEffectResources } from '../inspector/postEffectResources';
import type { useEditorHistory } from '../state/useEditorHistory';
import type { useSelection } from '../state/useSelection';
import { sameColor } from './colorMath';
import {
  BLOOM_DEFAULT,
  DOF_DEFAULT,
  FOG_DEFAULT_COLOR,
  FOG_DEFAULT_END,
  FOG_DEFAULT_START,
  MAIN_FOG_INDEX,
  isFogActive,
  setBloomColor,
  setBloomEnabled,
  setBloomStrength,
  setBloomThreshold,
  setDofField,
  setFogColor,
  setFogDistance,
  setFogEnabled,
  setAmbientColor,
  setLightColor,
  setMainLightColor,
  setMainShadowColor,
} from './environment';
import { LOOK_PRESETS, applyLookPreset, findLookPreset, type LookFiles, type LookPresetId } from './lookPresets';

export const FOG_PATH = 'posteffect/posteffect.bfg';
export const BLIGHT_PATH = 'posteffect/posteffect.blight';
export const BLOOM_PATH = 'posteffect/posteffect.bblm';
export const DOF_PATH = 'posteffect/posteffect.bdof';

interface FileWrite {
  path: string;
  data: Uint8Array;
}

const norm = (path: string) => path.replace(/\\/g, '/').toLowerCase();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isPostEffectPath(path: string): boolean {
  return /^posteffect\//i.test(path.replace(/^\.\//, ''));
}

/** The track's `posteffect/*` files with a draft laid over them. */
function overlayEntries(track: TrackDocument, draft: ReadonlyMap<string, FileWrite>): TrackDocument['archiveEntries'] {
  if (draft.size === 0) return track.archiveEntries;
  const seen = new Set<string>();
  const merged = track.archiveEntries.map((entry) => {
    if (entry.type !== 'file') return entry;
    const hit = draft.get(norm(entry.path));
    if (!hit) return entry;
    seen.add(norm(entry.path));
    return { ...entry, data: hit.data };
  });
  for (const [key, write] of draft) if (!seen.has(key)) merged.push({ type: 'file', path: write.path, data: write.data } as TrackDocument['archiveEntries'][number]);
  return merged;
}

function lookFilesOf(resources: PostEffectResources): LookFiles {
  return {
    blight: resources.blight,
    fog: resources.fogPath ? resources.fogPresets : null,
    bloom: resources.bloomFiles.map((file) => file.data),
  };
}

export interface EnvironmentStage {
  /** Sun flare colour (red, green, blue, strength). */
  flareColor: [number, number, number, number];
  flash: boolean;
}

export interface UseEnvironmentArgs {
  track: TrackDocument | null;
  trackRef: MutableRefObject<TrackDocument | null>;
  history: ReturnType<typeof useEditorHistory>;
  selection: ReturnType<typeof useSelection>;
  setStatus: Dispatch<SetStateAction<string>>;
}

export function useEnvironment({ track, trackRef, history, selection, setStatus }: UseEnvironmentArgs) {
  const draftRef = useRef(new Map<string, FileWrite>());
  const [draftVersion, setDraftVersion] = useState(0);

  // --- the files as the track was opened, for "Original" and the presets -----------------------
  const originalRef = useRef<{ key: string; files: Map<string, FileWrite> } | null>(null);
  const trackKey = track ? `${track.sourceId ?? ''}|${track.fileName}` : null;
  if (track && trackKey !== null && originalRef.current?.key !== trackKey) {
    const files = new Map<string, FileWrite>();
    for (const entry of track.archiveEntries) {
      if (entry.type === 'file' && entry.data && isPostEffectPath(entry.path)) files.set(norm(entry.path), { path: entry.path, data: entry.data });
    }
    originalRef.current = { key: trackKey, files };
    draftRef.current = new Map();
  }
  if (!track && originalRef.current) originalRef.current = null;

  /** What the panel shows: the track with the draft on top. */
  const entries = useMemo(
    () => (track ? overlayEntries(track, draftRef.current) : []),
    // `draftVersion` is the draft's identity; the ref itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track, draftVersion],
  );
  const resources = useMemo(
    () => getTrackPostEffectResources({ archiveEntries: entries } as unknown as TrackDocument),
    [entries],
  );
  const effectiveFiles = useMemo(
    () => entries.filter((entry) => entry.type === 'file' && entry.data && isPostEffectPath(entry.path)).map((entry) => ({ path: entry.path, data: entry.data as Uint8Array })),
    [entries],
  );

  const original = useMemo<LookFiles>(() => {
    const files = originalRef.current?.files;
    const pick = (re: RegExp) => [...(files?.values() ?? [])].filter((file) => re.test(file.path));
    const blightFile = pick(/\.blight$/i)[0];
    const fogFile = pick(/\.bfg$/i)[0];
    return {
      blight: blightFile ? parseBlight(blightFile.data) : null,
      fog: fogFile ? parseBfgFogEntries(fogFile.data) : null,
      bloom: pick(/\.bblm\d*$/i)
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => parseBblm(file.data))
        .filter((file): file is PostEffectBloomFile => file !== null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  // --- draft plumbing -------------------------------------------------------------------------

  /** The effective bytes for a path right now (draft first). Reads refs, so it is never stale. */
  const bytesFor = useCallback(
    (path: string): Uint8Array | null => {
      const drafted = draftRef.current.get(norm(path));
      if (drafted) return drafted.data;
      const current = trackRef.current;
      const hit = current?.archiveEntries.find((entry) => entry.type === 'file' && norm(entry.path) === norm(path));
      return hit?.data ?? null;
    },
    [trackRef],
  );

  const currentResources = useCallback((): PostEffectResources => {
    const current = trackRef.current;
    if (!current) return getTrackPostEffectResources(null);
    return getTrackPostEffectResources({ archiveEntries: overlayEntries(current, draftRef.current) } as unknown as TrackDocument);
  }, [trackRef]);

  const stage = useCallback((writes: FileWrite[]) => {
    if (writes.length === 0) return;
    for (const write of writes) draftRef.current.set(norm(write.path), write);
    setDraftVersion((version) => version + 1);
  }, []);

  /** Writes the draft into the track as one undo step. Does nothing if it changes no byte. */
  const commit = useCallback(
    (message: string) => {
      const draft = draftRef.current;
      if (draft.size === 0) return;
      const current = trackRef.current;
      draftRef.current = new Map();
      setDraftVersion((version) => version + 1);
      if (!current) return;
      let next = current;
      let changed = false;
      for (const write of draft.values()) {
        const existing = current.archiveEntries.find((entry) => entry.type === 'file' && norm(entry.path) === norm(write.path));
        if (existing?.data && bytesEqual(existing.data, write.data)) continue;
        next = replaceArchiveFile(next, write.path, write.data);
        changed = true;
      }
      if (!changed) return;
      history.applyEditorChange(next, selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
      setStatus(message);
    },
    [history, selection, setStatus, trackRef],
  );

  /** Drops an uncommitted draft (Escape, or leaving the mode mid-drag). */
  const discard = useCallback(() => {
    if (draftRef.current.size === 0) return;
    draftRef.current = new Map();
    setDraftVersion((version) => version + 1);
  }, []);

  // --- file-level helpers ---------------------------------------------------------------------

  const pathOf = useCallback((found: string | null | undefined, fallback: string) => found ?? fallback, []);

  const writeFog = useCallback(
    (entries: PostEffectFogEntry[]): FileWrite => {
      const res = currentResources();
      const path = pathOf(res.fogPath, FOG_PATH);
      return { path, data: writeBfgFogEntries(bytesFor(path) ?? createDefaultBfg(), entries) };
    },
    [bytesFor, currentResources, pathOf],
  );

  const writeBlightFile = useCallback(
    (file: PostEffectBlightFile): FileWrite => {
      const res = currentResources();
      const path = pathOf(res.blightPath, BLIGHT_PATH);
      return { path, data: writeBlight(bytesFor(path) ?? createDefaultBlight(), file) };
    },
    [bytesFor, currentResources, pathOf],
  );

  const mainBloom = (res: PostEffectResources) => res.bloomFiles.find((file) => file.index === 0) ?? null;
  const mainDof = (res: PostEffectResources) => res.dofFiles.find((file) => !/_demo$/i.test(file.path)) ?? null;

  const writeBloom = useCallback(
    (path: string, file: PostEffectBloomFile): FileWrite => ({ path, data: writeBblm(bytesFor(path) ?? createDefaultBblm(), file) }),
    [bytesFor],
  );

  const writeDof = useCallback(
    (path: string, file: PostEffectDofFile): FileWrite => ({ path, data: writeBdof(bytesFor(path) ?? createDefaultBdof(), file) }),
    [bytesFor],
  );

  /** Last glow strength before it was switched off, so switching it back on restores it. */
  const lastBloomRef = useRef<PostEffectBloomFile | null>(null);
  const lastFogTypeRef = useRef<number>(1);

  // --- one method per control -----------------------------------------------------------------
  // Each previews (drafts) its change. Toggles and buttons follow with `commit(...)`.

  const tools = useMemo(
    () => ({
      sunColor(color: RgbColor) {
        const blight = currentResources().blight;
        if (blight) stage([writeBlightFile(setMainLightColor(blight, color))]);
      },
      shadowColor(color: RgbColor) {
        const blight = currentResources().blight;
        if (blight) stage([writeBlightFile(setMainShadowColor(blight, color))]);
      },
      lightColor(index: number, color: RgbColor) {
        const blight = currentResources().blight;
        if (blight) stage([writeBlightFile(setLightColor(blight, index, color))]);
      },
      ambientColor(index: number, color: RgbColor) {
        const blight = currentResources().blight;
        if (blight) stage([writeBlightFile(setAmbientColor(blight, index, color))]);
      },
      addLighting() {
        stage([{ path: BLIGHT_PATH, data: createDefaultBlight() }]);
      },

      fogEnabled(on: boolean) {
        const entries = currentResources().fogPresets;
        if (entries.length === 0) return;
        const main = entries.find((entry) => entry.index === MAIN_FOG_INDEX);
        if (!on && main && isFogActive(main)) lastFogTypeRef.current = main.fogType;
        stage([writeFog(setFogEnabled(entries, on, lastFogTypeRef.current))]);
      },
      fogColor(color: RgbColor) {
        const entries = currentResources().fogPresets;
        if (entries.length > 0) stage([writeFog(setFogColor(entries, color))]);
      },
      fogDistance(which: 'start' | 'end', distance: number) {
        const entries = currentResources().fogPresets;
        if (entries.length > 0) stage([writeFog(setFogDistance(entries, which, distance))]);
      },
      addFog() {
        const entries = parseBfgFogEntries(createDefaultBfg()).map((entry) =>
          entry.index === MAIN_FOG_INDEX ? { ...entry, fogType: 1, startZ: FOG_DEFAULT_START, endZ: FOG_DEFAULT_END, color: [...FOG_DEFAULT_COLOR] as RgbColor } : entry,
        );
        stage([writeFog(entries)]);
      },

      glowEnabled(on: boolean) {
        const res = currentResources();
        const main = mainBloom(res);
        if (!main) return;
        if (!on) lastBloomRef.current = main.data;
        const restore = lastBloomRef.current ?? original.bloom[0] ?? null;
        stage([writeBloom(main.path, setBloomEnabled(main.data, on, restore))]);
      },
      glowStrength(strength: number) {
        const main = mainBloom(currentResources());
        if (main) stage([writeBloom(main.path, setBloomStrength(main.data, strength, original.bloom[0] ?? main.data))]);
      },
      glowColor(color: RgbColor) {
        const main = mainBloom(currentResources());
        if (main) stage([writeBloom(main.path, setBloomColor(main.data, color))]);
      },
      glowThreshold(threshold: number) {
        const main = mainBloom(currentResources());
        if (main) stage([writeBloom(main.path, setBloomThreshold(main.data, threshold))]);
      },
      addGlow() {
        stage([writeBloom(BLOOM_PATH, BLOOM_DEFAULT)]);
      },

      dofField(field: 'focusCenter' | 'focusRange' | 'blurRadius', value: number) {
        const main = mainDof(currentResources());
        if (main) stage([writeDof(main.path, setDofField(main.data, field, value))]);
      },
      addDof() {
        stage([writeDof(DOF_PATH, DOF_DEFAULT)]);
      },
    }),
    // The writers are stable callbacks over refs; `original` only changes with the track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentResources, stage, writeFog, writeBlightFile, writeBloom, writeDof, original],
  );

  // --- looks ----------------------------------------------------------------------------------

  /** The files a look produces from the opened-track originals. */
  const presetWrites = useCallback(
    (id: LookPresetId): FileWrite[] => {
      const originals = originalRef.current?.files;
      if (!originals) return [];
      const preset = findLookPreset(id);
      if (id === 'original') {
        // Byte-exact: put back what was opened, rather than re-serialising it.
        const writes: FileWrite[] = [];
        const current = trackRef.current;
        for (const file of originals.values()) {
          if (/\.(blight|bfg|bblm\d*)$/i.test(file.path)) writes.push(file);
        }
        // A file a look created that the track did not have is switched off instead.
        const hadFog = [...originals.values()].some((file) => /\.bfg$/i.test(file.path));
        const fogNow = current?.archiveEntries.find((entry) => entry.type === 'file' && /posteffect\/posteffect\.bfg$/i.test(entry.path));
        if (!hadFog && fogNow) writes.push({ path: fogNow.path, data: createDefaultBfg() });
        return writes;
      }
      const result = applyLookPreset(preset, original);
      const writes: FileWrite[] = [];
      const files = [...originals.values()];
      const blightFile = files.find((file) => /\.blight$/i.test(file.path));
      if (result.blight && blightFile) writes.push({ path: blightFile.path, data: writeBlight(blightFile.data, result.blight) });
      const fogFile = files.find((file) => /\.bfg$/i.test(file.path));
      if (result.fog) writes.push({ path: fogFile?.path ?? FOG_PATH, data: writeBfgFogEntries(fogFile?.data ?? createDefaultBfg(), result.fog) });
      const bloomFiles = files.filter((file) => /\.bblm\d*$/i.test(file.path)).sort((a, b) => a.path.localeCompare(b.path));
      bloomFiles.forEach((file, index) => {
        const next = result.bloom[index];
        if (next) writes.push({ path: file.path, data: writeBblm(file.data, next) });
      });
      return writes;
    },
    [original, trackRef],
  );

  const applyPreset = useCallback(
    (id: LookPresetId) => {
      const writes = presetWrites(id);
      if (writes.length === 0) {
        setStatus(`${findLookPreset(id).label} has nothing to change in this track.`);
        return;
      }
      stage(writes);
      commit(id === 'original' ? 'Restored the original look.' : `Applied the ${findLookPreset(id).label} look.`);
    },
    [commit, presetWrites, setStatus, stage],
  );

  /** Which look the files match right now, if any. */
  const activePreset = useMemo<LookPresetId | null>(() => {
    const byPath = new Map(effectiveFiles.map((file) => [norm(file.path), file.data]));
    for (const preset of LOOK_PRESETS) {
      const writes = presetWrites(preset.id);
      if (writes.length === 0) continue;
      if (writes.every((write) => {
        const now = byPath.get(norm(write.path));
        return now !== undefined && bytesEqual(now, write.data);
      })) return preset.id;
    }
    return null;
    // `effectiveFiles` is the identity that changes whenever the files do.
  }, [effectiveFiles, presetWrites]);

  const lookFiles = useMemo(() => lookFilesOf(resources), [resources]);

  // --- sky (KMP track settings) ---------------------------------------------------------------

  const stageInfo = useMemo<EnvironmentStage | null>(() => {
    const entity = track?.kmp?.entities.find((candidate) => candidate.section === 'STGI');
    if (!entity?.stage) return null;
    const color = entity.stage.flareColor;
    return {
      flareColor: [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 0],
      flash: entity.stage.lensFlareFlash !== 0,
    };
  }, [track?.kmp]);

  const commitStage = useCallback(
    (change: { flash?: boolean; color?: readonly number[] }, message: string) => {
      const current = trackRef.current;
      const kmp: KmpDocument | undefined = current?.kmp;
      const entity = kmp?.entities.find((candidate) => candidate.section === 'STGI');
      if (!current || !kmp || !entity) return;
      let doc = kmp;
      if (change.flash !== undefined) doc = { ...doc, original: patchKmpStageField(doc, entity, 'lensFlareFlash', change.flash ? 1 : 0) };
      if (change.color) {
        for (let channel = 0; channel < 4; channel++) {
          const value = change.color[channel];
          if (value !== undefined && value !== entity.stage?.flareColor[channel]) doc = { ...doc, original: patchKmpStageFlareColor(doc, entity, channel, value) };
        }
      }
      if (doc.original === kmp.original) return;
      history.applyEditorChange(replaceCourseKmp(current, doc.original), selection.selectedIdRef.current, true, selection.selectedIdsRef.current);
      setStatus(message);
    },
    [history, selection, setStatus, trackRef],
  );

  const hasDraft = draftVersion > 0 && draftRef.current.size > 0;

  return {
    resources,
    lookFiles,
    originalLook: original,
    effectiveFiles,
    tools,
    preview: stage,
    commit,
    discard,
    hasDraft,
    applyPreset,
    activePreset,
    stageInfo,
    commitStage,
    sameColor,
  };
}

export type EnvironmentEditor = ReturnType<typeof useEnvironment>;
