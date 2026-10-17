import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendKmpCamera, appendKmpCheckpoint, appendKmpGobj, appendKmpPoint, parseKmp } from '../../lib/kmp';
import { createEmptyKmpFile, readKmpFile, writeKmpFile } from '../../lib/kmpFile';
import { replaceCourseKmp, validateTrack, type TrackDocument } from '../../lib/track';
import type { EditorModeContext } from '../modes/types';
import { useEditorHistory, type EditorHistory } from '../state/useEditorHistory';
import { useSelection } from '../state/useSelection';
import { KmpInspector, type KmpInspectorProps } from './KmpInspector';
import { useKmpMode } from './KmpMode';

let trackRef: { current: TrackDocument | null };
let history: EditorHistory;
let inspector: KmpInspectorProps;
const setStatus = vi.fn();

beforeEach(() => {
  setStatus.mockClear();
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
    const selection = useSelection();
    history = useEditorHistory({ selection, trackDocument: { trackRef, setTrack: vi.fn() }, setStatus });
    const ui = useKmpMode({
      editorMode: 'kmp', track: trackRef.current, trackRef, history, selection, setStatus,
      commonArchive: null, objFlow: null, validation: validateTrack(trackRef.current!),
      editActions: {}, clipboard: {}, selected: null, selectedEntities: [], objectOptions: [],
    } as unknown as EditorModeContext);
    inspector = (ui.inspector as ReactElement<KmpInspectorProps>).props;
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
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
    expect(markup).toContain('disabled="">Fix all repairable issues</button>');
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
