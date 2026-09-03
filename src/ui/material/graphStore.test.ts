import { describe, expect, it } from 'vitest';
import { createDefaultMaterialDoc, type GxTevStageDoc } from '../../lib/gxMaterial';
import { graphStorageKey, hashTevStages, sessionGraphKey } from './graphStore';

function stage(overrides: Partial<GxTevStageDoc> = {}): GxTevStageDoc {
  return {
    colorInA: 15 as never, colorInB: 15 as never, colorInC: 15 as never, colorInD: 8 as never,
    colorOp: 0 as never, colorBias: 0 as never, colorScale: 0 as never, colorClamp: true, colorRegId: 0 as never,
    alphaInA: 7 as never, alphaInB: 7 as never, alphaInC: 7 as never, alphaInD: 4 as never,
    alphaOp: 0 as never, alphaBias: 0 as never, alphaScale: 0 as never, alphaClamp: true, alphaRegId: 0 as never,
    texCoordId: 0 as never, texMap: 0 as never, channelId: 7 as never,
    konstColorSel: 0 as never, konstAlphaSel: 0 as never,
    rasSwapTable: 0, texSwapTable: 0,
    indTexStage: 0 as never, indTexFormat: 0 as never, indTexBiasSel: 0 as never, indTexAlphaSel: 0 as never,
    indTexMatrix: 0 as never, indTexWrapS: 0 as never, indTexWrapT: 0 as never,
    indTexAddPrev: false, indTexUseOrigLOD: false,
    ...overrides,
  };
}

const ref = { archivePath: './course_model.brres', modelName: 'course', materialName: 'road' };

describe('hashTevStages', () => {
  it('is stable for the same stages', () => {
    expect(hashTevStages([stage(), stage()])).toBe(hashTevStages([stage(), stage()]));
  });

  it('is eight hex digits', () => {
    expect(hashTevStages([stage()])).toMatch(/^[0-9a-f]{8}$/);
    expect(hashTevStages([])).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when any stage field changes', () => {
    const base = hashTevStages([stage()]);
    expect(hashTevStages([stage({ colorInA: 8 as never })])).not.toBe(base);
    expect(hashTevStages([stage({ colorClamp: false })])).not.toBe(base);
    expect(hashTevStages([stage({ texMap: 1 as never })])).not.toBe(base);
    expect(hashTevStages([stage({ indTexAddPrev: true })])).not.toBe(base);
    expect(hashTevStages([stage({ rasSwapTable: 2 })])).not.toBe(base);
  });

  it('changes when the stage count changes', () => {
    expect(hashTevStages([stage()])).not.toBe(hashTevStages([stage(), stage()]));
  });

  it('distinguishes the order of two different stages', () => {
    const a = stage();
    const b = stage({ texMap: 3 as never });
    expect(hashTevStages([a, b])).not.toBe(hashTevStages([b, a]));
  });
});

describe('graphStorageKey', () => {
  it('drops the ./ prefix and includes the stage hash', () => {
    const key = graphStorageKey(ref, [stage()]);
    expect(key.startsWith('graph:course_model.brres:course:road:')).toBe(true);
    expect(key.endsWith(hashTevStages([stage()]))).toBe(true);
  });

  it('gives a different key once the stages change, so a stale graph is never reused', () => {
    expect(graphStorageKey(ref, [stage()])).not.toBe(graphStorageKey(ref, [stage({ texMap: 2 as never })]));
  });

  it('gives a different key per material', () => {
    expect(graphStorageKey(ref, [stage()])).not.toBe(graphStorageKey({ ...ref, materialName: 'grass' }, [stage()]));
    expect(graphStorageKey(ref, [stage()])).not.toBe(graphStorageKey({ ...ref, modelName: 'vrcorn' }, [stage()]));
  });

  it('is what an empty material hashes to as well', () => {
    expect(() => graphStorageKey(ref, createDefaultMaterialDoc().tevStages)).not.toThrow();
  });
});

describe('sessionGraphKey', () => {
  it('ignores the ./ prefix and the archive path\'s case', () => {
    expect(sessionGraphKey(ref)).toBe(sessionGraphKey({ ...ref, archivePath: 'Course_Model.brres' }));
  });

  it('does not include the stage hash, so a graph survives its own edits in one session', () => {
    expect(sessionGraphKey(ref)).toBe('course_model.brres|course|road');
  });
});
