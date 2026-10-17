import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendKmpArea,
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiRoute,
  parseKmp,
  patchKmpEntityRotation,
  patchKmpEntityScale,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
} from '../../lib/kmp';
import { createEmptyKmpFile, readKmpFile, writeKmpFile } from '../../lib/kmpFile';
import type { TrackDocument } from '../../lib/track';
import { useEditorHistory, type EditorHistory } from './useEditorHistory';
import { useKmpEditActions, type KmpEditActions, type KmpEditActionsContext } from './useKmpEditActions';
import { useSelection, type EditorSelection } from './useSelection';

let selection: EditorSelection;
let history: EditorHistory;
let actions: KmpEditActions;
let context: KmpEditActionsContext;
let trackRef: { current: TrackDocument | null };
const setStatus = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  let kmp = parseKmp(writeKmpFile(createEmptyKmpFile()));
  for (const [index, objectId] of [0x65, 0x65, 0xcb].entries()) {
    kmp = parseKmp(appendKmpGobj(kmp, objectId, { x: index * 100, y: 20, z: -index * 50 }));
    const object = kmp.entities.find((entity) => entity.id === `GOBJ-${index}`)!;
    kmp = parseKmp(patchKmpEntityRotation(kmp, object, { x: 0, y: index * 30, z: 0 }));
    kmp = parseKmp(patchKmpEntityScale(kmp, object, { x: index + 1, y: 1, z: 1 }));
  }
  kmp = parseKmp(appendKmpCheckpoint(kmp, { x: 300, y: 0, z: 500 }));
  kmp = parseKmp(appendKmpPotiRoute(kmp, { x: 600, y: 0, z: 900 }));
  kmp = parseKmp(appendKmpPoint(kmp, 'ENPT', { x: 1000, y: 200, z: 300 }));
  kmp = parseKmp(appendKmpArea(kmp, { x: 1500, y: 100, z: 600 }));
  const track: TrackDocument = {
    fileName: 'bulk-edit.szs', compressed: false,
    archiveEntries: [{ type: 'file', path: './course.kmp', data: kmp.original }],
    kmp, kmpFile: readKmpFile(kmp.original), brresFiles: [], brresSummaries: {}, warnings: [],
  };
  trackRef = { current: track };
  function Harness() {
    selection = useSelection();
    history = useEditorHistory({ selection, trackDocument: { trackRef, setTrack: vi.fn() }, setStatus });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  const ids = ['GOBJ-0', 'GOBJ-1', 'CKPT-0', 'POTI-0-0', 'ENPT-0', 'AREA-0'];
  selection.applySelection(ids, 'GOBJ-0');
  context = {
    track, trackRef, selection, history, setStatus,
    projectState: null, objFlow: null,
    selected: kmp.entities.find((entity) => entity.id === 'GOBJ-0')!,
    selectedEntities: kmp.entities.filter((entity) => ids.includes(entity.id)),
    selectedPathInfo: null, canBatchReplaceObjects: false,
    batchOffset: { x: 0, y: 0, z: 0 }, fillBetweenSelection: null, fillBetweenCount: 1,
    entityLabel: (entity) => entity.id,
  };
  actions = useKmpEditActions(context);
});

describe('bulk KMP edits', () => {
  it('selects all matching object IDs and keeps the primary object', () => {
    actions.selectMatchingObjects();
    expect(selection.selectedIdsRef.current).toEqual(['GOBJ-0', 'GOBJ-1']);
    expect(selection.selectedIdRef.current).toBe('GOBJ-0');
    expect(trackRef.current).toBe(context.track);
  });

  it('matches every selected object type', () => {
    context.selectedEntities.push(context.track!.kmp!.entities.find((entity) => entity.id === 'GOBJ-2')!);
    actions.selectMatchingObjects();
    expect(selection.selectedIdsRef.current).toEqual(['GOBJ-0', 'GOBJ-1', 'GOBJ-2']);
  });

  it('moves mixed records by the same difference and preserves checkpoint width', () => {
    const before = context.track!.kmp!;
    actions.moveEntity(context.selected!, { x: 80, y: 30, z: -40 });
    const after = parseKmp(trackRef.current!.kmp!.original);
    for (const entity of context.selectedEntities) {
      expect(after.entities.find((candidate) => candidate.id === entity.id)!.position).toEqual({
        x: entity.position.x + 80,
        y: entity.section === 'CKPT' ? 0 : entity.position.y + 10,
        z: entity.position.z - 40,
      });
    }
    const checkpoint = after.entities.find((entity) => entity.id === 'CKPT-0')!.checkpoint!;
    const original = before.entities.find((entity) => entity.id === 'CKPT-0')!.checkpoint!;
    expect(checkpoint.left.x).toBe(original.left.x + 80);
    expect(checkpoint.right.x).toBe(original.right.x + 80);
    expect(after.entities.find((entity) => entity.id === 'GOBJ-2')).toEqual(before.entities.find((entity) => entity.id === 'GOBJ-2'));
    expect(trackRef.current!.kmpFile!.objects[1].position.x).toBe(180);
    expect(trackRef.current!.archiveEntries[0]).toMatchObject({ data: after.original });
    history.undoEdit();
    expect(trackRef.current).toBe(context.track);
    expect(selection.selectedIdsRef.current).toHaveLength(6);
    history.redoEdit();
    expect(trackRef.current!.kmp!.original).toEqual(after.original);
  });

  it('rotates each supported selection in place and reads the latest values on repeated edits', () => {
    actions.rotateEntity(context.selected!, { x: 0, y: 80, z: 0 });
    actions.rotateEntity(context.selected!, { x: 0, y: 90, z: 0 });
    const after = trackRef.current!.kmpFile!;
    expect(after.objects.map((object) => object.rotation.y)).toEqual([90, 120, 60]);
    expect(after.areas[0].rotation.y).toBe(90);
    expect(after.objects[1].position).toEqual(context.track!.kmpFile!.objects[1].position);
    history.undoEdit();
    expect(trackRef.current!.kmpFile!.objects[1].rotation.y).toBe(110);
    history.undoEdit();
    expect(trackRef.current).toBe(context.track);
  });

  it('keeps single selection edits absolute', () => {
    selection.applySelection(['GOBJ-1'], 'GOBJ-1');
    const object = context.track!.kmp!.entities.find((entity) => entity.id === 'GOBJ-1')!;
    actions.rotateEntity(object, { x: 0, y: 80, z: 0 });
    expect(trackRef.current!.kmpFile!.objects.map((entry) => entry.rotation.y)).toEqual([0, 80, 60]);
  });

  it('moves the selection when dragging an object other than the primary selection', () => {
    const object = context.track!.kmp!.entities.find((entity) => entity.id === 'GOBJ-1')!;
    const ids = [...selection.selectedIdsRef.current];
    history.beginEditSession();
    actions.moveEntity(object, { ...object.position, x: object.position.x + 80 });
    actions.moveEntity(object, { ...object.position, x: object.position.x + 100 });
    history.endEditSession();
    expect(trackRef.current!.kmpFile!.objects.map((entry) => entry.position.x)).toEqual([100, 200, 200]);
    expect(selection.selectedIdsRef.current).toEqual(ids);
    expect(selection.selectedIdRef.current).toBe('GOBJ-0');
    history.undoEdit();
    expect(trackRef.current).toBe(context.track);
    expect(selection.selectedIdsRef.current).toEqual(ids);
  });

  it('offsets the same checkpoint endpoint across a selection without changing the opposite end', () => {
    const kmp = parseKmp(appendKmpCheckpoint(context.track!.kmp!, { x: 900, y: 0, z: 1200 }));
    trackRef.current = { ...context.track!, kmp, kmpFile: readKmpFile(kmp.original) };
    selection.applySelection(['CKPT-0', 'CKPT-1'], 'CKPT-0');
    const first = kmp.entities.find((entity) => entity.id === 'CKPT-0')!;
    const second = kmp.entities.find((entity) => entity.id === 'CKPT-1')!;
    const left = first.checkpoint!.left;
    actions.moveCheckpointEndpoint(first, 'left', { ...left, x: left.x + 80 });
    const after = trackRef.current!.kmp!.entities.find((entity) => entity.id === 'CKPT-1')!.checkpoint!;
    expect(after.left.x).toBe(second.checkpoint!.left.x + 80);
    expect(after.right).toEqual(second.checkpoint!.right);
  });

  it('adds the size difference while preserving other axes and unsupported records', () => {
    actions.scaleEntity(context.selected!, { x: 2, y: 1, z: 1 });
    const after = trackRef.current!.kmpFile!;
    expect(after.objects.map((object) => object.scale.x)).toEqual([2, 3, 3]);
    expect(after.objects[1].scale.y).toBe(1);
    expect(after.enemyPoints).toEqual(context.track!.kmpFile!.enemyPoints);
  });

  it('previews repeated gizmo edits and commits the selection as one undo step', () => {
    history.beginEditSession();
    actions.rotateEntity(context.selected!, { x: 0, y: 40, z: 0 });
    actions.rotateEntity(context.selected!, { x: 0, y: 80, z: 0 });
    expect(trackRef.current!.kmp!.entities.find((entity) => entity.id === 'GOBJ-1')!.rotation!.y).toBe(110);
    expect(trackRef.current!.kmp!.original).toBe(context.track!.kmp!.original);
    history.endEditSession();
    expect(readKmpFile(trackRef.current!.kmp!.original).objects[1].rotation.y).toBe(110);
    history.undoEdit();
    expect(trackRef.current).toBe(context.track);
    history.redoEdit();
    expect(trackRef.current!.kmpFile!.objects[1].rotation.y).toBe(110);
  });

  it('applies settings only to selected records in the primary section', () => {
    actions.patchSelectedEntity((kmp, entity) => patchKmpGobjSetting(kmp, entity, 2, 123));
    actions.patchSelectedEntity((kmp, entity) => patchKmpGobjPresenceFlags(kmp, entity, 5));
    const after = trackRef.current!.kmpFile!;
    expect(after.objects.map((object) => object.settings[2])).toEqual([123, 123, 0]);
    expect(after.objects.map((object) => object.presenceFlags)).toEqual([5, 5, 0x3f]);
    expect(after.areas).toEqual(context.track!.kmpFile!.areas);
    expect(after.routes).toEqual(context.track!.kmpFile!.routes);
  });

  it('deletes a mixed selection in one undo step and restores it', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    actions.deleteSelectedEntity();
    const after = trackRef.current!.kmpFile!;
    expect(after.objects.map((object) => object.objectId)).toEqual([0xcb]);
    expect(after.checkpoints).toHaveLength(0);
    expect(after.enemyPoints).toHaveLength(0);
    expect(after.areas).toHaveLength(0);
    expect(selection.selectedIdsRef.current).toEqual([]);
    history.undoEdit();
    expect(trackRef.current).toBe(context.track);
    expect(selection.selectedIdsRef.current).toHaveLength(6);
    vi.unstubAllGlobals();
  });
});
