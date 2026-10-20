/**
 * Runs full compiles in `compile.worker.ts`, falling back to the main thread when workers are not
 * available (tests, very old browsers). One long-lived worker; requests are answered in order.
 */
import { compileProject, computeFileHashes } from '../../../lib/create/compile';
import type { CompileWriters, CreateKit } from '../../../lib/create/types';
import type { CompileOutput, CompileRequest, CompileResponse } from './compileProtocol';

export interface CompileClient {
  compile(request: Omit<CompileRequest, 'id'>): Promise<CompileOutput>;
  dispose(): void;
}

export interface MainThreadCompiler {
  kit: CreateKit;
  writers: CompileWriters;
}

/** The same compile, on this thread. */
export function compileOnThisThread({ kit, writers }: MainThreadCompiler, request: Omit<CompileRequest, 'id'>): CompileOutput {
  const result = compileProject(request.project, kit, writers, request.previousKmp);
  return {
    files: [...result.files],
    kmp: result.kmp,
    issues: result.issues,
    stats: result.stats,
    hashes: computeFileHashes(result.files),
  };
}

export function createCompileClient(mainThread: () => Promise<MainThreadCompiler>): CompileClient {
  let worker: Worker | null = null;
  let workerBroken = typeof Worker === 'undefined';
  let nextId = 1;
  const pending = new Map<number, { resolve: (output: CompileOutput) => void; reject: (error: Error) => void; request: Omit<CompileRequest, 'id'> }>();

  const runHere = async (request: Omit<CompileRequest, 'id'>): Promise<CompileOutput> => {
    const compiler = await mainThread();
    // Yield once so a pending paint is not starved by back-to-back compiles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return compileOnThisThread(compiler, request);
  };

  const breakWorker = (reason: unknown) => {
    workerBroken = true;
    console.warn('[create] the compile worker failed; compiling on the main thread', reason);
    worker?.terminate();
    worker = null;
    const waiting = [...pending.values()];
    pending.clear();
    for (const job of waiting) runHere(job.request).then(job.resolve, job.reject);
  };

  const ensureWorker = (): Worker | null => {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module', name: 'mkw-create-compile' });
    } catch (error) {
      breakWorker(error);
      return null;
    }
    worker.addEventListener('message', (event: MessageEvent<CompileResponse>) => {
      const message = event.data;
      const job = message ? pending.get(message.id) : undefined;
      if (!job) return;
      pending.delete(message.id);
      if (message.type === 'error') job.reject(new Error(message.message));
      else job.resolve(message.output);
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      event.preventDefault?.();
      breakWorker(event.message || event.error);
    });
    return worker;
  };

  return {
    compile(request) {
      const target = ensureWorker();
      if (!target) return runHere(request);
      const id = nextId++;
      return new Promise<CompileOutput>((resolve, reject) => {
        pending.set(id, { resolve, reject, request });
        target.postMessage({ id, ...request } satisfies CompileRequest);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const job of pending.values()) job.reject(new Error('The compile was cancelled.'));
      pending.clear();
    },
  };
}
