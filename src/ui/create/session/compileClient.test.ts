import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileProject, computeFileHashes } from '../../../lib/create/compile';
import { useDeterministicIds } from '../../../lib/create/ids';
import { createKitFromArchive } from '../../../lib/create/kit';
import { createProjectFromTemplate } from '../../../lib/create/templates';
import type { CreateKit, CreateProject } from '../../../lib/create/types';
import { writers } from '../../../lib/create/writers';
import { createCompileClient } from './compileClient';
import { collisionKey, documentFileName, friendlyKitError } from './useCreateSession';

const KIT_PATH = 'public/data/MarioKartWii/Create/create-kit.szs';

describe('helpers', () => {
  it('names the track file after the design, safely', () => {
    expect(documentFileName({ name: 'My cool track' } as CreateProject)).toBe('My cool track.szs');
    expect(documentFileName({ name: 'a/b\c:d*e?' } as CreateProject)).toBe('abcde.szs');
    expect(documentFileName({ name: '  ' } as CreateProject)).toBe('My track.szs');
  });

  it('fingerprints collision so an unchanged mesh keeps its raycaster', () => {
    const make = (y: number) => ({
      positions: new Float32Array([0, y, 0, 1, y, 0, 0, y, 1]),
      indices: new Uint32Array([0, 1, 2]),
      flags: new Uint16Array([0]),
    });
    expect(collisionKey(make(0))).toBe(collisionKey(make(0)));
    expect(collisionKey(make(0))).not.toBe(collisionKey(make(5)));
  });

  it('explains a kit that did not load', () => {
    expect(friendlyKitError(new Error('Failed to fetch'))).toContain('Failed to fetch');
  });
});

describe.skipIf(!existsSync(KIT_PATH))('the compile client without a worker', () => {
  let kit: CreateKit;
  let project: CreateProject;

  beforeAll(() => {
    useDeterministicIds();
    kit = createKitFromArchive(new Uint8Array(readFileSync(KIT_PATH)));
    project = createProjectFromTemplate('oval', { name: 'Client', themeId: 'sunny', laps: 3 }, kit);
  }, 60_000);

  it('compiles on the calling thread and matches a direct compile', async () => {
    const client = createCompileClient(async () => ({ kit, writers }));
    const output = await client.compile({ project, previousKmp: null });
    const direct = compileProject(project, kit, writers);
    expect(output.files.map(([path]) => path).sort()).toEqual([...direct.files.keys()].sort());
    expect(output.hashes).toEqual(computeFileHashes(direct.files));
    expect(output.stats.checkpoints).toBe(direct.stats.checkpoints);
    expect(output.kmp.checkpoints.length).toBe(direct.kmp.checkpoints.length);
    client.dispose();
  }, 60_000);
});
