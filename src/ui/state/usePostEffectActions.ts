import type { Dispatch, SetStateAction } from 'react';
import {
  createDefaultBblm,
  createDefaultBdof,
  createDefaultBfg,
  createDefaultBlight,
  writeBblm,
  writeBdof,
  writeBfgFogEntries,
  writeBlight,
  type PostEffectBlightFile,
  type PostEffectBloomFile,
  type PostEffectDofFile,
} from '../../lib/posteffects';
import { replaceArchiveFile, type TrackDocument } from '../../lib/track';
import { findArchiveData, type AreaFogPreset, type PostEffectResources } from '../inspector/postEffectResources';
import type { EditorHistory } from './useEditorHistory';
import type { EditorSelection } from './useSelection';

export type PostEffectActions = ReturnType<typeof usePostEffectActions>;

/** Creates and edits the track's posteffect.* files (fog, bloom, depth of field, lighting). */
export function usePostEffectActions({
  track,
  postEffectResources,
  selection,
  history,
  setStatus,
}: {
  track: TrackDocument | null;
  postEffectResources: PostEffectResources;
  selection: EditorSelection;
  history: EditorHistory;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  function resolveArchivePath(pattern: RegExp, fallback: string): string {
    const existing = track?.archiveEntries.find((entry) => entry.type === 'file' && pattern.test(entry.path));
    return existing?.path ?? fallback;
  }

  function applyPostEffectArchiveFile(pattern: RegExp, fallback: string, data: Uint8Array, statusMessage: string) {
    if (!track) return;
    history.applyEditorChange(
      replaceArchiveFile(track, resolveArchivePath(pattern, fallback), data),
      selection.selectedIdRef.current,
      true,
      selection.selectedIdsRef.current,
    );
    setStatus(statusMessage);
  }

  function onCreateFog() {
    applyPostEffectArchiveFile(/posteffect\/posteffect\.bfg$/i, 'posteffect/posteffect.bfg', createDefaultBfg(), 'Created posteffect.bfg.');
  }

  function onChangeFogPreset(index: number, patch: (entry: AreaFogPreset) => AreaFogPreset) {
    if (!track || !postEffectResources.fogPath) return;
    const nextEntries = postEffectResources.fogPresets.map((entry) => (entry.index === index ? patch(entry) : entry));
    applyPostEffectArchiveFile(
      /posteffect\/posteffect\.bfg$/i,
      postEffectResources.fogPath,
      writeBfgFogEntries(findArchiveData(track, postEffectResources.fogPath) ?? createDefaultBfg(), nextEntries),
      `Updated fog preset ${index}.`,
    );
  }

  function onAddBloom() {
    const nextIndex = (postEffectResources.bloomFiles.at(-1)?.index ?? -1) + 1;
    const suffix = nextIndex === 0 ? '' : String(nextIndex);
    applyPostEffectArchiveFile(
      new RegExp(`posteffect\\/posteffect\\.bblm${suffix}$`, 'i'),
      `posteffect/posteffect.bblm${suffix}`,
      createDefaultBblm(),
      `Created posteffect.bblm${suffix || '0'}.`,
    );
  }

  function onChangeBloomFile(path: string, data: PostEffectBloomFile) {
    if (!track) return;
    applyPostEffectArchiveFile(
      /posteffect\/posteffect\.bblm\d*$/i,
      path,
      writeBblm(findArchiveData(track, path) ?? createDefaultBblm(), data),
      `Updated ${path.split('/').pop()}.`,
    );
  }

  function onCreateDof(kind: 'main' | 'demo') {
    const fallback = kind === 'demo' ? 'posteffect/posteffect.bdof_demo' : 'posteffect/posteffect.bdof';
    applyPostEffectArchiveFile(
      kind === 'demo' ? /posteffect\/posteffect\.bdof_demo$/i : /posteffect\/posteffect\.bdof$/i,
      fallback,
      createDefaultBdof(),
      `Created ${fallback.split('/').pop()}.`,
    );
  }

  function onChangeDofFile(path: string, data: PostEffectDofFile) {
    if (!track) return;
    applyPostEffectArchiveFile(
      /posteffect\/posteffect\.bdof(_demo)?$/i,
      path,
      writeBdof(findArchiveData(track, path) ?? createDefaultBdof(), data),
      `Updated ${path.split('/').pop()}.`,
    );
  }

  function onCreateBlight() {
    applyPostEffectArchiveFile(/posteffect\/posteffect\.blight$/i, 'posteffect/posteffect.blight', createDefaultBlight(), 'Created posteffect.blight.');
  }

  function onChangeBlight(data: PostEffectBlightFile) {
    if (!track) return;
    applyPostEffectArchiveFile(
      /posteffect\/posteffect\.blight$/i,
      postEffectResources.blightPath ?? 'posteffect/posteffect.blight',
      writeBlight(findArchiveData(track, postEffectResources.blightPath ?? 'posteffect/posteffect.blight') ?? createDefaultBlight(), data),
      'Updated posteffect.blight.',
    );
  }

  return { onCreateFog, onChangeFogPreset, onAddBloom, onChangeBloomFile, onCreateDof, onChangeDofFile, onCreateBlight, onChangeBlight };
}
