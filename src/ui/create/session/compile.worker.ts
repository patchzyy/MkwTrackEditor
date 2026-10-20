/// <reference lib="webworker" />
/**
 * Compiles a design into its track files off the main thread. The full compile (KMP, collision
 * octree, course model, minimap) takes 0.4-1.1 s on a retail-sized lap, which would freeze the
 * page right after every edit; the live preview geometry stays on the main thread (50 ms).
 */
import { compileProject, computeFileHashes } from '../../../lib/create/compile';
import { loadCreateKit } from '../../../lib/create/kit';
import { writers } from '../../../lib/create/writers';
import type { CompileRequest, CompileResponse } from './compileProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<CompileRequest>) => {
  void handle(event.data);
});

async function handle(request: CompileRequest): Promise<void> {
  try {
    const kit = await loadCreateKit();
    const result = compileProject(request.project, kit, writers, request.previousKmp);
    const response: CompileResponse = {
      id: request.id,
      type: 'done',
      output: {
        files: [...result.files],
        kmp: result.kmp,
        issues: result.issues,
        stats: result.stats,
        hashes: computeFileHashes(result.files),
      },
    };
    scope.postMessage(response);
  } catch (error) {
    const response: CompileResponse = { id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) };
    scope.postMessage(response);
  }
}
