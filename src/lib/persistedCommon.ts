import { BINARY_ASSETS_STORE, hasIndexedDb, toStandaloneArrayBuffer, withEditorStore } from './editorDb';

const COMMON_SZS_KEY = 'common-szs';

export async function loadPersistedCommonSzs(): Promise<Uint8Array | null> {
  if (!hasIndexedDb()) return null;
  const stored = await withEditorStore<ArrayBuffer | null>(BINARY_ASSETS_STORE, 'readonly', (store) => store.get(COMMON_SZS_KEY));
  return stored ? new Uint8Array(stored) : null;
}

export async function savePersistedCommonSzs(bytes: Uint8Array): Promise<void> {
  if (!hasIndexedDb()) return;
  await withEditorStore<IDBValidKey>(BINARY_ASSETS_STORE, 'readwrite', (store) => store.put(toStandaloneArrayBuffer(bytes), COMMON_SZS_KEY));
}
