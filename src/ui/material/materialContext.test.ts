import { describe, expect, it } from 'vitest';
import type { MaterialBrief, ModelSlot } from '../../lib/materialSlots';
import type { SurfacePick } from '../../lib/surfacePick';
import {
  buildModelMaterialRows,
  contextFromPick,
  contextTitle,
  describeContext,
  filterModelMaterialRows,
  friendlyFileName,
} from './materialContext';

const slot = (drawOpIndex: number, materialIndex: number, materialName: string): ModelSlot => ({
  drawOpIndex,
  shapeIndex: drawOpIndex,
  shapeName: `shape${drawOpIndex}`,
  materialIndex,
  materialName,
  translucent: false,
  pass: 'opaque',
  nodeId: 0,
});

const briefs: MaterialBrief[] = [
  { modelName: 'itembox', materialIndex: 0, materialName: 'box', translucent: false, textureNames: ['itembox_q'] },
  { modelName: 'itembox', materialIndex: 1, materialName: 'glow', translucent: true, textureNames: ['', 'spark'] },
  { modelName: 'itembox', materialIndex: 2, materialName: 'unused', translucent: false, textureNames: ['x'] },
];

describe('material rows', () => {
  it('lists the materials draw calls use, once each, in draw order', () => {
    const rows = buildModelMaterialRows('./itembox.brres', 'itembox', [slot(0, 1, 'glow'), slot(1, 0, 'box'), slot(2, 1, 'glow')], briefs);
    expect(rows.map((row) => row.materialName)).toEqual(['glow', 'box']);
    expect(rows[0].drawCalls).toBe(2);
    expect(rows[0].translucent).toBe(true);
    expect(rows[0].textureNames).toEqual(['spark']);
    expect(rows[0].ref).toEqual({ archivePath: './itembox.brres', modelName: 'itembox', materialName: 'glow' });
  });

  it('leaves out materials no draw call points at', () => {
    const rows = buildModelMaterialRows('./itembox.brres', 'itembox', [slot(0, 0, 'box')], briefs);
    expect(rows.map((row) => row.materialName)).not.toContain('unused');
  });

  it('filters by material or texture name', () => {
    const rows = buildModelMaterialRows('./itembox.brres', 'itembox', [slot(0, 0, 'box'), slot(1, 1, 'glow')], briefs);
    expect(filterModelMaterialRows(rows, 'SPARK').map((row) => row.materialName)).toEqual(['glow']);
    expect(filterModelMaterialRows(rows, '')).toHaveLength(2);
  });
});

describe('context wording', () => {
  it('names the course and sky plainly and objects by their friendly name', () => {
    expect(contextTitle('course', undefined, 'x')).toBe('Track');
    expect(contextTitle('skybox', 'whatever', 'x')).toBe('Sky');
    expect(contextTitle('object', 'Item Box', 'Itembox')).toBe('Item Box');
    expect(contextTitle('object', undefined, 'Itembox')).toBe('Itembox');
  });

  it('turns a file name into something readable', () => {
    expect(friendlyFileName('./fire_ball.brres')).toBe('Fire ball');
  });

  it('builds a context from a pick', () => {
    const pick = {
      source: 'common', archivePath: './itembox.brres', kind: 'object', modelName: 'itembox', objectName: 'Item Box',
      drawOpIndex: 0, shapeIndex: 0, shapeName: 's', materialIndex: 0, materialName: 'm', hitPoint: { x: 0, y: 0, z: 0 }, approximate: false,
    } as SurfacePick;
    const context = contextFromPick(pick, './itembox.brres');
    expect(context).toMatchObject({ title: 'Item Box', source: 'common', kind: 'object' });
    expect(describeContext(context, 2)).toBe('Object model · 2 materials');
    expect(describeContext(context, 1)).toBe('Object model · 1 material');
  });
});
