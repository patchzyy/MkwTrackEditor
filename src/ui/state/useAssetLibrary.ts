// The user's custom model library, backed by IndexedDB (`src/lib/assetLibrary.ts`).
//
// Loads once on mount, then keeps an in-memory list the content browser renders. Imports parse
// the archive with the same summariser the track uses (so tiles get a real render), and every
// change is written through to IndexedDB before the list updates.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createLibraryAssetId,
  deleteLibraryAsset,
  isBrresFileName,
  libraryNameFromFileName,
  loadLibraryAssets,
  saveLibraryAsset,
  sortLibraryAssets,
  uniqueLibraryName,
  type LibraryAssetRecord,
} from '../../lib/assetLibrary';
import { isBrresArchive } from '../../lib/brres/extractModel';
import { parseNoclipBrresSummary } from '../../lib/noclipBrres';
import type { ToastApi } from '../components/Toast';

export interface AssetLibrary {
  assets: LibraryAssetRecord[];
  /** False until the first IndexedDB read has finished. */
  ready: boolean;
  /** Adds every `.brres` in `files`; other files are reported and skipped. */
  importFiles: (files: Iterable<File>) => Promise<LibraryAssetRecord[]>;
  /** Adds one archive from memory (an exported model, for instance). */
  importBytes: (fileName: string, bytes: Uint8Array) => Promise<LibraryAssetRecord | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  get: (id: string) => LibraryAssetRecord | null;
}

export function useAssetLibrary({
  setStatus,
  showToast,
}: {
  setStatus: (message: string) => void;
  showToast: ToastApi['showToast'];
}): AssetLibrary {
  const [assets, setAssets] = useState<LibraryAssetRecord[]>([]);
  const [ready, setReady] = useState(false);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  useEffect(() => {
    let cancelled = false;
    loadLibraryAssets()
      .then((loaded) => {
        if (cancelled) return;
        setAssets(loaded);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReady(true);
        showToast({ tone: 'warning', title: 'Custom models unavailable', detail: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const importBytes = useCallback(
    async (fileName: string, bytes: Uint8Array): Promise<LibraryAssetRecord | null> => {
      if (!isBrresArchive(bytes)) {
        showToast({ tone: 'warning', title: 'Not a BRRES file', detail: `${fileName} does not start with a BRRES header.` });
        return null;
      }
      const summary = await parseNoclipBrresSummary(bytes);
      if (summary.error) {
        showToast({ tone: 'warning', title: `Could not read ${fileName}`, detail: summary.error });
        return null;
      }
      const record: LibraryAssetRecord = {
        id: createLibraryAssetId(),
        name: uniqueLibraryName(libraryNameFromFileName(fileName), assetsRef.current.map((asset) => asset.name)),
        fileName: fileName.split(/[\\/]/).pop() ?? fileName,
        size: bytes.byteLength,
        addedAt: Date.now(),
        models: summary.models.map((model) => model.name),
        textureCount: summary.textures.length,
        thumbnail: summary.previewDataUrl ?? null,
        bytes,
      };
      try {
        await saveLibraryAsset(record);
      } catch (error) {
        showToast({ tone: 'error', title: 'Could not save the model', detail: error instanceof Error ? error.message : String(error) });
        return null;
      }
      setAssets((current) => sortLibraryAssets([...current.filter((asset) => asset.id !== record.id), record]));
      return record;
    },
    [showToast],
  );

  const importFiles = useCallback(
    async (files: Iterable<File>): Promise<LibraryAssetRecord[]> => {
      const list = Array.from(files);
      const brres = list.filter((file) => isBrresFileName(file.name));
      const skipped = list.length - brres.length;
      const added: LibraryAssetRecord[] = [];
      for (const file of brres) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const record = await importBytes(file.name, bytes);
        if (record) added.push(record);
      }
      if (skipped > 0) {
        showToast({ tone: 'warning', title: 'Only .brres files are kept', detail: `${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped.` });
      }
      if (added.length > 0) {
        setStatus(added.length === 1 ? `Added ${added[0].name} to My Assets.` : `Added ${added.length} models to My Assets.`);
      }
      return added;
    },
    [importBytes, setStatus, showToast],
  );

  const remove = useCallback(
    async (id: string) => {
      const asset = assetsRef.current.find((candidate) => candidate.id === id);
      setAssets((current) => current.filter((candidate) => candidate.id !== id));
      try {
        await deleteLibraryAsset(id);
      } catch (error) {
        showToast({ tone: 'error', title: 'Could not remove the model', detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (asset) setStatus(`Removed ${asset.name} from My Assets.`);
    },
    [setStatus, showToast],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      const asset = assetsRef.current.find((candidate) => candidate.id === id);
      if (!asset || !trimmed || trimmed === asset.name) return;
      const renamed = { ...asset, name: trimmed };
      setAssets((current) => sortLibraryAssets(current.map((candidate) => (candidate.id === id ? renamed : candidate))));
      try {
        await saveLibraryAsset(renamed);
      } catch (error) {
        showToast({ tone: 'error', title: 'Could not rename the model', detail: error instanceof Error ? error.message : String(error) });
      }
    },
    [showToast],
  );

  const get = useCallback((id: string) => assetsRef.current.find((asset) => asset.id === id) ?? null, []);

  return useMemo(() => ({ assets, ready, importFiles, importBytes, remove, rename, get }), [assets, get, importBytes, importFiles, ready, remove, rename]);
}
