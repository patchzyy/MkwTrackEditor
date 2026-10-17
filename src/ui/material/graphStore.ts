// Persistence for authored shader graphs.
//
// A graph is a *view* of a material's TEV stages: the same stages can be drawn as many different
// node arrangements, and only the author knows which one they meant. So the graph is stored
// alongside the track and re-used when reopening it — but only while the stages still match what
// was compiled, because a graph that no longer produces the material's stages would silently lie.
// That is what the stage hash in the key is for.
//
// IndexedDB failures are never fatal: a private-mode browser just loses the layout and gets a
// fresh `decompileShader` result instead.
import type { GxMaterialRef, GxTevStageDoc } from '../../lib/gxMaterial';
// The light module, not the barrel: this file is in the main bundle.
import { foldLiteralNodes } from '../../lib/gxMaterial/graphLiterals';
import type { EditorShaderGraph } from './graphModel';

// Its own database rather than a second store inside `mkw-track-editor`: adding a store means
// bumping that database's version, and `src/lib/persistedCommon.ts` opens it at version 1, which
// would then fail with a VersionError and lose the user's imported `Common.szs`.
const DB_NAME = 'mkw-track-editor-shader-graphs';
const DB_VERSION = 1;
const STORE_NAME = 'shader-graphs';

// ---------------------------------------------------------------------------- keys

/**
 * FNV-1a over the fields of every stage that the compiler writes. Two materials whose stages
 * differ in any way the editor can author get different hashes, so a stored graph is only ever
 * re-used for the stages it was authored against.
 */
export function hashTevStages(stages: readonly GxTevStageDoc[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  mix(stages.length);
  for (const stage of stages) {
    mix(stage.colorInA); mix(stage.colorInB); mix(stage.colorInC); mix(stage.colorInD);
    mix(stage.colorOp); mix(stage.colorBias); mix(stage.colorScale); mix(stage.colorClamp ? 1 : 0); mix(stage.colorRegId);
    mix(stage.alphaInA); mix(stage.alphaInB); mix(stage.alphaInC); mix(stage.alphaInD);
    mix(stage.alphaOp); mix(stage.alphaBias); mix(stage.alphaScale); mix(stage.alphaClamp ? 1 : 0); mix(stage.alphaRegId);
    mix(stage.texCoordId); mix(stage.texMap); mix(stage.channelId);
    mix(stage.konstColorSel); mix(stage.konstAlphaSel);
    mix(stage.rasSwapTable); mix(stage.texSwapTable);
    mix(stage.indTexStage); mix(stage.indTexFormat); mix(stage.indTexBiasSel); mix(stage.indTexAlphaSel);
    mix(stage.indTexMatrix); mix(stage.indTexWrapS); mix(stage.indTexWrapT);
    mix(stage.indTexAddPrev ? 1 : 0); mix(stage.indTexUseOrigLOD ? 1 : 0);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** `graph:<archivePath>:<model>:<material>:<stage hash>`. */
export function graphStorageKey(ref: GxMaterialRef, stages: readonly GxTevStageDoc[]): string {
  const archive = ref.archivePath.replace(/^\.\//, '');
  return `graph:${archive}:${ref.modelName}:${ref.materialName}:${hashTevStages(stages)}`;
}

/** In-memory key, without the hash: one graph per material for the length of a session. */
export function sessionGraphKey(ref: GxMaterialRef): string {
  return `${ref.archivePath.replace(/^\.\//, '').toLowerCase()}|${ref.modelName}|${ref.materialName}`;
}

// ---------------------------------------------------------------------------- IndexedDB

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
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
        request.onsuccess = () => resolve(request.result);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      }),
  );
}

interface StoredGraph {
  version: 1;
  savedAt: number;
  graph: EditorShaderGraph;
}

/**
 * What a stored graph becomes on the way in. A graph saved by an older build wired the hardware
 * constants from a shared "Value" node into every input that wanted one; those become values typed
 * into the inputs (`foldLiteralNodes`), which compiles to the very same stages. The layout is the
 * author's and is kept — only the Value cards and their wires go.
 */
export function migrateStoredGraph(graph: EditorShaderGraph): EditorShaderGraph {
  return foldLiteralNodes(graph);
}

export async function loadStoredGraph(ref: GxMaterialRef, stages: readonly GxTevStageDoc[]): Promise<EditorShaderGraph | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const stored = await withStore<StoredGraph | undefined>('readonly', (store) => store.get(graphStorageKey(ref, stages)));
    if (!stored || stored.version !== 1 || stored.graph?.version !== 1) return null;
    return migrateStoredGraph(stored.graph);
  } catch {
    return null;
  }
}

export async function saveStoredGraph(ref: GxMaterialRef, stages: readonly GxTevStageDoc[], graph: EditorShaderGraph): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const record: StoredGraph = { version: 1, savedAt: Date.now(), graph };
  try {
    await withStore<IDBValidKey>('readwrite', (store) => store.put(record, graphStorageKey(ref, stages)));
  } catch {
    // A graph layout is a convenience, never state the editor depends on.
  }
}
