// The editor's one IndexedDB database.
//
// Every persisted blob lives here so there is a single version number to bump and a single
// `onupgradeneeded` that knows every store. Callers get `withStore()` and never open the
// database themselves.

export const EDITOR_DB_NAME = 'mkw-track-editor';
/** Bump when adding a store, and add the store in `createMissingStores`. */
export const EDITOR_DB_VERSION = 2;

/** The user-imported `Common.szs` (one blob under the key `common-szs`). */
export const BINARY_ASSETS_STORE = 'binary-assets';
/** Custom BRRES archives the user dropped into the content browser, keyed by asset id. */
export const ASSET_LIBRARY_STORE = 'asset-library';

const ALL_STORES = [BINARY_ASSETS_STORE, ASSET_LIBRARY_STORE] as const;

function createMissingStores(db: IDBDatabase): void {
  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  }
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openEditorDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(EDITOR_DB_NAME, EDITOR_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => resolve(request.result);
  });
}

/** Runs one request inside a transaction on `storeName` and resolves with its result. */
export function withEditorStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openEditorDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = action(store);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      }),
  );
}

/**
 * Copies bytes into a plain `ArrayBuffer`. `Uint8Array.buffer` may be a `SharedArrayBuffer`
 * or a larger backing buffer; IndexedDB wants exactly the bytes and nothing else.
 */
export function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
