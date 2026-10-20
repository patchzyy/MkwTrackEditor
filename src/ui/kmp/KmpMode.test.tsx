import { createElement, useEffect, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendKmpCamera, appendKmpCheckpoint, appendKmpGobj, appendKmpPoint, parseKmp } from '../../lib/kmp';
import { createEmptyKmpFile, readKmpFile, writeKmpFile } from '../../lib/kmpFile';
import { replaceCourseKmp, validateTrack, type TrackDocument } from '../../lib/track';
import type { EditorModeContext } from '../modes/types';
import { useEditorHistory, type EditorHistory } from '../state/useEditorHistory';
import { useSelection, type EditorSelection } from '../state/useSelection';
import { KmpInspector, type KmpInspectorProps } from './KmpInspector';
import { useKmpMode } from './KmpMode';
import type { KmpToolsOverlayProps } from './KmpToolsOverlay';

let trackRef: { current: TrackDocument | null };
let history: EditorHistory;
let inspector: KmpInspectorProps;
let tools: KmpToolsOverlayProps;
let selection: EditorSelection;
const setStatus = vi.fn();

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  setStatus.mockClear();
  vi.mocked(useEffect).mockClear();
  let kmp = parseKmp(writeKmpFile(createEmptyKmpFile()));
  kmp = parseKmp(appendKmpGobj(kmp, 0x191, { x: 0, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpGobj(kmp, 0, { x: 100, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpCamera(kmp, { x: 0, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpCamera(kmp, { x: 100, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpCheckpoint(kmp, { x: 0, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpCheckpoint(kmp, { x: 100, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpPoint(kmp, 'JGPT', { x: 0, y: 0, z: 0 }));
  kmp = parseKmp(appendKmpPoint(kmp, 'JGPT', { x: 10000, y: 0, z: 0 }));
  const file = readKmpFile(kmp.original);
  file.objects[0].routeIndex = 50;
  file.objects[0].presenceFlags = 0;
  file.firstOpeningCamera = 0;
  file.cameras[0].nextIndex = 1;
  file.cameras[1].nextIndex = 0;
  file.cameras[0].time = file.cameras[1].time = 60;
  file.checkpoints[0].respawnIndex = 20;
  file.checkpoints[1].respawnIndex = 1;
  kmp = parseKmp(writeKmpFile(file));
  trackRef = { current: {
    fileName: 'repair.szs', compressed: false,
    archiveEntries: [{ type: 'file', path: './course.kmp', data: kmp.original }],
    kmp, kmpFile: readKmpFile(kmp.original), brresFiles: [], brresSummaries: {}, warnings: [],
  } };
  function Harness() {
    selection = useSelection();
    selection.selectedId = 'CKPT-0';
    history = useEditorHistory({ selection, trackDocument: { trackRef, setTrack: vi.fn() }, setStatus });
    const ui = useKmpMode({
      editorMode: 'kmp', track: trackRef.current, trackRef, history, selection, setStatus,
      commonArchive: null, objFlow: null, validation: validateTrack(trackRef.current!),
      editActions: {}, clipboard: {}, selected: null, selectedEntities: [], objectOptions: [],
    } as unknown as EditorModeContext);
    inspector = (ui.inspector as ReactElement<KmpInspectorProps>).props;
    tools = (ui.topRightOverlay as ReactElement<KmpToolsOverlayProps>).props;
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
});

it('A selects the active section and leaves typing, camera movement, and playtesting alone', () => {
  const addEventListener = vi.fn();
  const dataset = { playtest: '', viewportCameraLook: '' };
  vi.stubGlobal('window', { addEventListener, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { documentElement: { dataset } });
  const cleanups = vi.mocked(useEffect).mock.calls.map(([effect]) => effect());
  const onKeyDown = addEventListener.mock.calls.find(([type]) => type === 'keydown')![1];
  const event = { key: 'a', target: { tagName: 'CANVAS' }, preventDefault: vi.fn() };
  onKeyDown(event);
  expect(selection.selectedIdsRef.current).toEqual(['CKPT-0', 'CKPT-1']);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }]) {
    onKeyDown({ ...event, target });
  }
  dataset.viewportCameraLook = 'active';
  onKeyDown(event);
  dataset.viewportCameraLook = '';
  dataset.playtest = 'active';
  onKeyDown(event);
  dataset.playtest = '';
  onKeyDown({ ...event, ctrlKey: true });
  expect(event.preventDefault).toHaveBeenCalledOnce();
  cleanups.forEach((cleanup) => cleanup?.());
});

describe('Checkpoint respawns from enemy routes', () => {
  it('uses the nearest route point, follows a linked group, and preserves existing respawns', () => {
    const file = trackRef.current!.kmpFile!;
    file.enemyPoints = [
      { position: { x: 0, y: 50, z: 0 }, range: 100, setting1: 0, setting2: 0, setting3: 0 },
      { position: { x: 100, y: 75, z: 0 }, range: 100, setting1: 0, setting2: 0, setting3: 0 },
      { position: { x: 100, y: 75, z: 100 }, range: 100, setting1: 0, setting2: 0, setting3: 0 },
    ];
    file.enemyGroups = [
      { start: 0, length: 1, prev: [], next: [1], linkFlags: 0 },
      { start: 1, length: 2, prev: [0], next: [], linkFlags: 0 },
    ];
    const before = replaceCourseKmp(trackRef.current!, writeKmpFile(file));
    trackRef.current = before;
    tools.onCreateRespawns();
    const after = trackRef.current!;
    expect(after.kmpFile!.respawnPoints.slice(0, 2)).toEqual(file.respawnPoints);
    expect(after.kmpFile!.checkpoints.map((checkpoint) => checkpoint.respawnIndex)).toEqual([2, 3]);
    expect(after.kmpFile!.respawnPoints[2]).toMatchObject({ position: { x: 0, y: 50, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, id: 2 });
    expect(after.kmpFile!.respawnPoints[3]).toMatchObject({ position: { x: 100, y: 75, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, id: 3 });
    expect(readKmpFile(after.kmp!.original)).toEqual(after.kmpFile);
    history.undoEdit();
    expect(trackRef.current).toBe(before);
    history.redoEdit();
    expect(trackRef.current).toBe(after);
  });

  it('does not change the track when there is no enemy route or capacity for new respawns', () => {
    const before = trackRef.current;
    tools.onCreateRespawns();
    expect(trackRef.current).toBe(before);
    expect(setStatus).toHaveBeenLastCalledWith('Add an enemy route before creating checkpoint respawns.');
    const file = trackRef.current!.kmpFile!;
    file.enemyPoints = [{ position: { x: 0, y: 0, z: 0 }, range: 100, setting1: 0, setting2: 0, setting3: 0 }];
    file.respawnPoints = Array(254).fill(file.respawnPoints[0]);
    tools.onCreateRespawns();
    expect(trackRef.current).toBe(before);
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringContaining('255 respawn points'));
  });
});

describe('Fix all track issues', () => {
  it('repairs multiple issues and follows up a cleared object link with a generated route', () => {
    inspector.onFixAll();
    const file = trackRef.current!.kmpFile!;
    expect(file.objects[0].routeIndex).toBe(0);
    expect(file.objects[0].presenceFlags & 0x3f).toBe(0x3f);
    expect(file.routes).toHaveLength(1);
    expect(file.routes[0].points).toHaveLength(2);
    expect(file.checkpoints.map((checkpoint) => checkpoint.respawnIndex)).toEqual([0, 1]);
    const codes = validateTrack(trackRef.current!).map((issue) => issue.code);
    expect(codes).not.toContain('object.route-out-of-range');
    expect(codes).not.toContain('object.route-required');
    expect(codes).not.toContain('object.never-visible');
    expect(codes).not.toContain('checkpoint.respawn-out-of-range');
    expect(codes).not.toContain('camera.opening-loop');
    expect(readKmpFile(trackRef.current!.kmp!.original)).toEqual(file);
    expect(trackRef.current!.archiveEntries[0]).toMatchObject({ data: trackRef.current!.kmp!.original });
  });

  it('groups every repair into one undo step and can redo it', () => {
    const before = trackRef.current;
    inspector.onFixAll();
    const after = trackRef.current;
    expect(after).not.toBe(before);
    history.undoEdit();
    expect(trackRef.current).toBe(before);
    history.redoEdit();
    expect(trackRef.current).toBe(after);
  });

  it('retains unsupported issues, reports accurate remaining counts, and is repeatable', () => {
    inspector.onFixAll();
    const remaining = validateTrack(trackRef.current!);
    expect(remaining.some((issue) => issue.code === 'object.disabled')).toBe(true);
    expect(remaining.some((issue) => issue.code === 'archive.missing.course.kcl')).toBe(true);
    expect(inspector.quickFix(remaining.find((issue) => issue.code === 'object.disabled')!)).toBeNull();
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringContaining(
      `${remaining.filter((issue) => issue.level === 'error').length} errors and ${remaining.filter((issue) => issue.level === 'warning').length} warnings remain`,
    ));
    const repaired = trackRef.current;
    inspector.onFixAll();
    expect(trackRef.current).toBe(repaired);
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringContaining('Repaired 0 issues.'));
    const markup = renderToStaticMarkup(createElement(KmpInspector, { ...inspector, issues: remaining }));
    expect(markup).toMatch(/disabled=""[^>]*>Fix all repairable issues<\/button>/);
  });

  it('leaves checkpoints unresolved when no respawn exists', () => {
    const file = { ...trackRef.current!.kmpFile!, respawnPoints: [] };
    trackRef.current = replaceCourseKmp(trackRef.current!, writeKmpFile(file));
    expect(inspector.quickFix({ level: 'error', code: 'checkpoint.respawn-out-of-range', message: '' })).toBeNull();
    inspector.onFixAll();
    expect(trackRef.current!.kmpFile!.checkpoints[0].respawnIndex).toBe(20);
    expect(validateTrack(trackRef.current!).some((issue) => issue.code === 'respawn.missing')).toBe(true);
  });
});
