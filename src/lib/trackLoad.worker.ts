/// <reference lib="webworker" />
/**
 * Reads a `.szs` off the main thread.
 *
 * Everything `loadTrackBytes` does — Yaz0 decode, U8 parse, KMP, KCL, one summary per model
 * archive — plus `buildEditorProjectState`, which parses every BRRES again for Model mode. On a
 * 9 MB retail track that is several seconds of solid CPU work; on the main thread it froze the
 * page, and the only feedback was a status line nobody could see update.
 *
 * The worker owns no DOM, so model previews are skipped here (`modelPreviews: false`) and the
 * page fills them in afterwards, when they are cheap and nothing is waiting on them.
 *
 * The finished document is *transferred*, not copied: every typed array in it is a view onto the
 * one decoded archive buffer, so handing that buffer over costs nothing and the views arrive
 * intact. See `collectTrackTransferables` in `trackLoader.ts`.
 */

import { buildEditorProjectState } from './brresEditor';
import { loadTrackBytes } from './track';
import type { TrackLoadRequest, TrackLoadWorkerMessage } from './trackLoaderProtocol';
import { collectTransferables } from './trackLoaderProtocol';
import { readingFraction } from './trackLoadProgress';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<TrackLoadRequest>) => {
  void handle(event.data);
});

async function handle(request: TrackLoadRequest): Promise<void> {
  const post = (message: TrackLoadWorkerMessage, transfer?: Transferable[]) => {
    scope.postMessage(message, transfer ?? []);
  };

  try {
    const track = await loadTrackBytes(new Uint8Array(request.bytes), request.fileName, {
      brresSummaryLimit: request.brresSummaryLimit,
      modelPreviews: false,
      onProgress: (progress) => post({ id: request.id, type: 'progress', progress }),
    });

    // Model mode needs every BRRES parsed a second time. It is the single most expensive thing
    // that used to run on the main thread after a load, so it belongs here too.
    post({
      id: request.id,
      type: 'progress',
      progress: { stage: 'project', label: 'Preparing the model list', fraction: readingFraction(1) },
    });
    const projectState = await buildEditorProjectState(track);

    post({ id: request.id, type: 'done', track, projectState }, collectTransferables(track));
  } catch (error) {
    post({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
