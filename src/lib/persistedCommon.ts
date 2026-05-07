const DB_NAME = 'mkw-track-editor';
const DB_VERSION = 1;
const STORE_NAME = 'binary-assets';
const COMMON_SZS_KEY = 'common-szs';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  }));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function loadPersistedCommonSzs(): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  const stored = await withStore<ArrayBuffer | null>('readonly', (store) => store.get(COMMON_SZS_KEY));
  return stored ? new Uint8Array(stored) : null;
}

export async function savePersistedCommonSzs(bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await withStore<IDBValidKey>('readwrite', (store) => store.put(toArrayBuffer(bytes), COMMON_SZS_KEY));
}
