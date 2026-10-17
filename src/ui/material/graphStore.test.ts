import { describe, expect, it } from 'vitest';
import { compileShaderGraph, createDefaultMaterialDoc, type GxTevStageDoc, type ShaderGraph } from '../../lib/gxMaterial';
import { graphStorageKey, hashTevStages, migrateStoredGraph, sessionGraphKey } from './graphStore';

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

describe('migrateStoredGraph', () => {
  // What an older build saved: one Value card wired into every input that wanted a zero.
  const old: ShaderGraph = {
    version: 1,
    nodes: [
      { id: 'tex', type: 'texture', sampler: 0, texCoord: 0, x: 0, y: 0 },
      { id: 'zero', type: 'value', value: 0, x: 0, y: 200 },
      { id: 'mix', type: 'lerp', x: 260, y: 0, label: 'Kept as authored' },
      { id: 'out', type: 'output', x: 520, y: 0 },
    ],
    edges: [
      { id: 'e0', from: { node: 'tex', socket: 'rgb' }, to: { node: 'mix', socket: 'a' } },
      { id: 'e1', from: { node: 'zero', socket: 'rgb' }, to: { node: 'mix', socket: 'b' } },
      { id: 'e2', from: { node: 'zero', socket: 'rgb' }, to: { node: 'mix', socket: 't' } },
      { id: 'e3', from: { node: 'mix', socket: 'out' }, to: { node: 'out', socket: 'color' } },
    ],
  };

  it('types the Value card into the inputs it fed and drops it, keeping the layout', () => {
    const migrated = migrateStoredGraph(old);
    expect(migrated.nodes.map((node) => node.id)).toEqual(['tex', 'mix', 'out']);
    expect(migrated.nodes.find((node) => node.id === 'mix')).toMatchObject({ x: 260, y: 0, label: 'Kept as authored', inputValues: { b: 0, t: 0 } });
    expect(migrated.edges.map((edge) => edge.id)).toEqual(['e0', 'e3']);
  });

  it('compiles to the same stages it did before', () => {
    const material = createDefaultMaterialDoc('road', 1);
    expect(compileShaderGraph(migrateStoredGraph(old), material).tevStages).toEqual(compileShaderGraph(old, material).tevStages);
  });

  it('returns a graph with nothing to fold unchanged', () => {
    const current = migrateStoredGraph(old);
    expect(migrateStoredGraph(current)).toBe(current);
  });
});
