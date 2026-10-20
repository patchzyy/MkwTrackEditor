// Material slots on real archives: the item box model that ships with the editor (so CI runs
// these) and, when this machine has track folders, a real course model.
//
// What matters: a swap inside one pass changes exactly two bytes; a swap across passes moves the
// draw op like `applyMaterial` does and leaves an archive the viewport's own parser reads back
// with the new material on the moved draw call; and the track helpers keep Model-mode edits
// pointing at the same draw calls.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseU8 } from './u8';
import { listCourseModels, parseWithNoclip } from './brres/brresFixtures.testdata';
import { bakeCourseModel } from './brres/bakeCourseModel';
import {
  findMaterialIndex,
  listArchiveMaterialsBrief,
  listModelNames,
  listModelSlots,
  setDrawOpMaterial,
  setDrawOpMaterialDetailed,
  MaterialSlotError,
} from './materialSlots';
import {
  assignDrawOpMaterial,
  bakeMeshEdits,
  ensureTrackLocalArchive,
  findTrackArchiveEntry,
  getExportArchiveEntries,
  resolveArchiveBytes,
  type TrackDocument,
} from './track';
import { createIdentityMeshTransform, type MeshEdit } from './brresEditor';
import type { CommonResourceArchive } from './objflow';

const EXTRACTED_ASSETS = 'public/data/MarioKartWii/Race/Course/ExtractedAssets.u8';
const extracted = parseU8(new Uint8Array(readFileSync(EXTRACTED_ASSETS)));
const itembox = extracted.find((entry) => entry.path.toLowerCase().endsWith('/itembox.brres'))!.data!;
const courseModels = listCourseModels(2);

function differingBytes(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

function fakeCommon(): CommonResourceArchive {
  const entry = { path: 'Extracted/itembox.brres', type: 'file' as const, data: itembox };
  return {
    objFlow: { entries: [{ objectId: 0x65, name: 'itembox', resources: 'itembox' }], byId: new Map([[0x65, { objectId: 0x65, name: 'itembox', resources: 'itembox' }]]) },
    resourceEntries: [entry],
    byBaseName: new Map([['itembox.brres', entry]]),
  };
}

function fakeTrack(courseModel: Uint8Array): TrackDocument {
  return {
    fileName: 'test.szs',
    compressed: false,
    archiveEntries: [
      { path: '.', type: 'directory' },
      { path: './course_model.brres', type: 'file', data: courseModel },
    ],
    brresFiles: ['./course_model.brres'],
    brresSummaries: {},
    warnings: [],
    kmp: { entities: [{ id: 'GOBJ-0', section: 'GOBJ', index: 0, position: { x: 0, y: 0, z: 0 }, objectId: 0x65 }] } as unknown as TrackDocument['kmp'],
  };
}

describe('listModelSlots', () => {
  it('lists the item box draw calls in [opaque, translucent] order', () => {
    expect(listModelNames(itembox)).toContain('itembox');
    const slots = listModelSlots(itembox, 'itembox');
    expect(slots.map((slot) => [slot.drawOpIndex, slot.materialName, slot.pass])).toEqual([
      [0, 'mat_boxin', 'opaque'],
      [1, 'mat_question', 'opaque'],
      [2, 'mat_boxout', 'translucent'],
    ]);
    expect(slots[2].translucent).toBe(true);
    expect(slots.every((slot) => slot.shapeName.length > 0)).toBe(true);
  });

  it('agrees with the viewport parser on every course model draw call', async () => {
    for (const fixture of courseModels) {
      const [model] = (await parseWithNoclip(fixture.data)).mdl0;
      const ops = [...model.sceneGraph.drawOpaOps, ...model.sceneGraph.drawXluOps];
      const slots = listModelSlots(fixture.data, model.name);
      expect(slots.length).toBe(ops.length);
      slots.forEach((slot, i) => {
        expect(slot.materialIndex).toBe(ops[i].matId);
        expect(slot.shapeIndex).toBe(ops[i].shpId);
        expect(slot.materialName).toBe(model.materials[ops[i].matId].name);
      });
    }
  });
});

describe('listArchiveMaterialsBrief', () => {
  it('lists every material of every model with its textures', () => {
    const brief = listArchiveMaterialsBrief(itembox);
    const models = new Set(brief.map((material) => material.modelName));
    expect(models).toEqual(new Set(listModelNames(itembox)));
    const boxout = brief.find((material) => material.modelName === 'itembox' && material.materialName === 'mat_boxout')!;
    expect(boxout.translucent).toBe(true);
    expect(boxout.textureNames.length).toBeGreaterThan(0);
    expect(boxout.textureNames.every((name) => name.length > 0)).toBe(true);
  });

  it('is cheap enough for a whole course model', () => {
    for (const fixture of courseModels) {
      const started = performance.now();
      const brief = listArchiveMaterialsBrief(fixture.data);
      expect(brief.length).toBeGreaterThan(0);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});

describe('setDrawOpMaterial', () => {
  it('changes exactly the op material bytes when the pass stays the same', async () => {
    const question = findMaterialIndex(itembox, 'itembox', 'mat_question');
    const result = setDrawOpMaterialDetailed(itembox, 'itembox', 0, question);
    expect(result).toMatchObject({ changed: true, moved: false, drawOpIndex: 0 });
    expect(result.bytes.length).toBe(itembox.length);
    const diff = differingBytes(itembox, result.bytes);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.length).toBeLessThanOrEqual(2);
    expect(listModelSlots(result.bytes, 'itembox')[0].materialName).toBe('mat_question');
    const model = (await parseWithNoclip(result.bytes)).mdl0.find((candidate: { name: string }) => candidate.name === 'itembox');
    expect(model.sceneGraph.drawOpaOps[0].matId).toBe(question);
  });

  it('returns the very same bytes for a no-op', () => {
    const current = listModelSlots(itembox, 'itembox')[1].materialIndex;
    const result = setDrawOpMaterialDetailed(itembox, 'itembox', 1, current);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(itembox);
    expect(setDrawOpMaterial(itembox, 'itembox', 1, current)).toBe(itembox);
  });

  it('round-trips back to the original bytes', () => {
    const original = listModelSlots(itembox, 'itembox')[0].materialIndex;
    const question = findMaterialIndex(itembox, 'itembox', 'mat_question');
    const there = setDrawOpMaterial(itembox, 'itembox', 0, question);
    const back = setDrawOpMaterial(there, 'itembox', 0, original);
    expect(differingBytes(itembox, back)).toEqual([]);
  });

  it('moves the op to the translucent pass for a translucent material', async () => {
    const boxout = findMaterialIndex(itembox, 'itembox', 'mat_boxout');
    const before = listModelSlots(itembox, 'itembox');
    const result = setDrawOpMaterialDetailed(itembox, 'itembox', 0, boxout);
    expect(result).toMatchObject({ changed: true, moved: true, drawOpIndex: 2 });
    // The other two draw calls slide up by one.
    expect(result.indexMap).toEqual([2, 0, 1]);
    const after = listModelSlots(result.bytes, 'itembox');
    expect(after.map((slot) => [slot.shapeIndex, slot.materialName, slot.pass])).toEqual([
      [before[1].shapeIndex, 'mat_question', 'opaque'],
      [before[2].shapeIndex, 'mat_boxout', 'translucent'],
      [before[0].shapeIndex, 'mat_boxout', 'translucent'],
    ]);
    const parsed = await parseWithNoclip(result.bytes);
    // The other models of the archive keep their names although the string pool moved.
    expect(parsed.mdl0.map((candidate: { name: string }) => candidate.name).sort()).toEqual(listModelNames(itembox).sort());
    expect(parsed.tex0.length).toBe((await parseWithNoclip(itembox)).tex0.length);
    const model = parsed.mdl0.find((candidate: { name: string }) => candidate.name === 'itembox');
    expect(model.sceneGraph.drawOpaOps.length).toBe(1);
    expect(model.sceneGraph.drawXluOps.map((op: { matId: number }) => op.matId)).toEqual([boxout, boxout]);
  });

  it('moves a translucent op back to the opaque pass', () => {
    const boxin = findMaterialIndex(itembox, 'itembox', 'mat_boxin');
    const result = setDrawOpMaterialDetailed(itembox, 'itembox', 2, boxin);
    expect(result).toMatchObject({ moved: true, drawOpIndex: 2 });
    expect(result.indexMap).toEqual([0, 1, 2]);
    expect(listModelSlots(result.bytes, 'itembox').map((slot) => slot.pass)).toEqual(['opaque', 'opaque', 'opaque']);
  });

  it('swaps a course model draw call and leaves an archive the viewport reads', async () => {
    for (const fixture of courseModels) {
      const slots = listModelSlots(fixture.data, listModelNames(fixture.data)[0]);
      const modelName = listModelNames(fixture.data)[0];
      const brief = listArchiveMaterialsBrief(fixture.data).filter((material) => material.modelName === modelName);
      const slot = slots[0];
      const other = brief.find((material) => material.materialIndex !== slot.materialIndex && material.translucent === slot.translucent);
      if (!other) continue;
      const result = setDrawOpMaterialDetailed(fixture.data, modelName, 0, other.materialIndex);
      expect(result.moved).toBe(false);
      expect(differingBytes(fixture.data, result.bytes).length).toBeLessThanOrEqual(2);
      const model = (await parseWithNoclip(result.bytes)).mdl0[0];
      expect([...model.sceneGraph.drawOpaOps, ...model.sceneGraph.drawXluOps][0].matId).toBe(other.materialIndex);
    }
  });

  it('refuses a material the model does not have', () => {
    expect(() => setDrawOpMaterial(itembox, 'itembox', 0, 99)).toThrow(MaterialSlotError);
    expect(() => setDrawOpMaterial(itembox, 'itembox', 99, 0)).toThrow(MaterialSlotError);
    expect(() => setDrawOpMaterial(itembox, 'nope', 0, 0)).toThrow(MaterialSlotError);
  });
});

describe('track-local object models', () => {
  const course = courseModels[0]?.data ?? itembox;

  it('copies a Common model into the track once, next to the course model', () => {
    const track = fakeTrack(course);
    expect(resolveArchiveBytes(track, fakeCommon(), './itembox.brres')?.source).toBe('common');
    const first = ensureTrackLocalArchive(track, fakeCommon(), './itembox.brres');
    expect(first).toMatchObject({ copied: true, path: './itembox.brres' });
    expect(findTrackArchiveEntry(first.track, 'itembox.brres')?.data).toEqual(itembox);
    expect(first.track.brresFiles).toContain('./itembox.brres');
    expect(resolveArchiveBytes(first.track, fakeCommon(), './itembox.brres')?.source).toBe('track');
    const again = ensureTrackLocalArchive(first.track, fakeCommon(), './itembox.brres');
    expect(again.copied).toBe(false);
    expect(again.track).toBe(first.track);
  });

  it('exports the edited track copy instead of the Common one', () => {
    const common = fakeCommon();
    const question = findMaterialIndex(itembox, 'itembox', 'mat_question');
    const assigned = assignDrawOpMaterial(fakeTrack(course), common, { archivePath: './itembox.brres', modelName: 'itembox', drawOpIndex: 0, materialIndex: question });
    expect(assigned).toMatchObject({ changed: true, copied: true, moved: false });
    const exported = getExportArchiveEntries(assigned.track, common).filter((entry) => entry.path.toLowerCase().endsWith('itembox.brres'));
    expect(exported.length).toBe(1);
    expect(listModelSlots(exported[0].data!, 'itembox')[0].materialName).toBe('mat_question');
  });

  it('re-keys Model-mode edits when a draw call changes pass', () => {
    const boxout = findMaterialIndex(itembox, 'itembox', 'mat_boxout');
    const target = { archivePath: './itembox.brres', modelName: 'itembox', shapeIndex: 0, drawOpIndex: 1, componentIndex: null, nodeId: 0, granularity: 'shape' as const };
    const edit: MeshEdit = { target, transform: createIdentityMeshTransform(), visible: false, deleted: false };
    const track = { ...fakeTrack(course), meshEdits: [edit] };
    const assigned = assignDrawOpMaterial(track, fakeCommon(), { archivePath: 'itembox.brres', modelName: 'itembox', drawOpIndex: 0, materialIndex: boxout });
    expect(assigned.moved).toBe(true);
    expect(assigned.track.meshEdits?.[0].target.drawOpIndex).toBe(0);
  });
});

describe('placed-object mesh edits at export', () => {
  // Any archive works as the "course model" here; the item box ships with the editor.
  const course = courseModels[0]?.data ?? itembox;
  const modelName = listModelNames(course)[0];
  const placedEdit: MeshEdit = {
    target: { archivePath: './editor-imported/imported-0.brres', modelName, shapeIndex: 0, drawOpIndex: 0, componentIndex: null, nodeId: 0, granularity: 'shape' },
    transform: createIdentityMeshTransform(),
    visible: true,
    deleted: true,
  };

  it('does not delete the course draw call that shares the index', () => {
    const result = bakeCourseModel(course, { edits: [placedEdit], archivePath: './course_model.brres' });
    expect(result.changed).toBe(false);
    expect(result.data).toBe(course);
    expect(result.warnings.map((warning) => warning.code)).toContain('model.edit-other-archive');
  });

  it('still bakes the course model edits next to it', () => {
    const courseEdit: MeshEdit = { ...placedEdit, target: { ...placedEdit.target, archivePath: './course_model.brres', shapeIndex: listModelSlots(course, modelName)[0].shapeIndex } };
    const result = bakeCourseModel(course, { edits: [placedEdit, courseEdit], archivePath: 'course_model.brres' });
    expect(result.changed).toBe(true);
    expect(result.removedDrawOps).toBe(1);
  });

  it('is wired through the track export', () => {
    const track = { ...fakeTrack(course), meshEdits: [placedEdit] };
    const baked = bakeMeshEdits(track.archiveEntries, track);
    expect(baked.entries.find((entry) => entry.path === './course_model.brres')?.data).toBe(course);
  });
});
