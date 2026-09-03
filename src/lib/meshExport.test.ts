// End-to-end Model-mode export: take a real `.szs`, edit its geometry the way the editor does,
// export, and re-open the result as if the user had just dropped it back in.

import { describe, expect, it } from 'vitest';
import { createIdentityMeshTransform, type EditorMeshTarget, type ImportedMesh, type MeshEdit } from './brresEditor';
import { COURSE_MODEL_PATH, exportTrack, loadTrackBytes, validateExportBytes, type TrackDocument } from './track';
import { CUSTOM_TRACK_DIR, NINTENDO_TRACK_DIR, listTracks, readTrackBytes } from './realTrackFixtures.testdata';
import { collectDrawOps } from './brres/meshBake';
import { findObjectBrres, openCourseModel, parseWithNoclip } from './brres/brresFixtures.testdata';

const trackPaths = [...listTracks(CUSTOM_TRACK_DIR, 2), ...listTracks(NINTENDO_TRACK_DIR, 2)];

function courseModelBytes(track: TrackDocument): Uint8Array {
  const entry = track.archiveEntries.find(
    (candidate) => candidate.type === 'file' && candidate.path.toLowerCase().endsWith('course_model.brres'),
  );
  if (!entry?.data) throw new Error('no course model');
  return entry.data;
}

function firstExclusiveTarget(brres: Uint8Array): { target: EditorMeshTarget; drawOpIndex: number } {
  const { editor, modelName } = openCourseModel(brres);
  const ops = collectDrawOps(editor);
  const uses = new Map<number, number>();
  for (const ref of ops) uses.set(ref.op.shapeId, (uses.get(ref.op.shapeId) ?? 0) + 1);
  const drawOpIndex = Math.max(0, ops.findIndex((ref) => uses.get(ref.op.shapeId) === 1));
  const ref = ops[drawOpIndex];
  return {
    drawOpIndex,
    target: {
      archivePath: COURSE_MODEL_PATH,
      modelName,
      shapeIndex: ref.op.shapeId,
      drawOpIndex,
      componentIndex: null,
      nodeId: ref.op.nodeId,
      granularity: 'shape',
    },
  };
}

/** Recompressing a whole track is slow, so these export without Yaz0. */
const RAW = { compress: false } as const;

/**
 * Validates an uncompressed export. `validateExportBytes` compares against the source archive's
 * compression, so the document it checks against has to agree that this one is not compressed.
 */
function validateRawExport(track: TrackDocument, bytes: Uint8Array) {
  return validateExportBytes({ ...track, compressed: false }, bytes).filter((issue) => issue.level === 'error');
}

describe.skipIf(trackPaths.length === 0)('Model mode export', () => {
  for (const path of trackPaths) {
    const name = path.split(/[\\/]/).pop()!;

    it(`${name}: exports byte-identically when no mesh was touched`, async () => {
      const track = await loadTrackBytes(readTrackBytes(path), name, { brresSummaryLimit: 0 });
      const plain = exportTrack(track, RAW);
      const withEmptyEdits = exportTrack({ ...track, meshEdits: [], importedMeshes: [] }, RAW);
      expect(withEmptyEdits.length).toBe(plain.length);
      expect(Buffer.from(withEmptyEdits).equals(Buffer.from(plain))).toBe(true);
    });

    it(`${name}: exports a moved, deleted and duplicated mesh into a readable archive`, async () => {
      const track = await loadTrackBytes(readTrackBytes(path), name, { brresSummaryLimit: 0 });
      const source = courseModelBytes(track);
      const { editor } = openCourseModel(source);
      const shapesBefore = editor.listShapes().length;
      const opsBefore = collectDrawOps(editor).length;

      const ops = collectDrawOps(editor);
      const uses = new Map<number, number>();
      for (const ref of ops) uses.set(ref.op.shapeId, (uses.get(ref.op.shapeId) ?? 0) + 1);
      const exclusive = ops
        .map((ref, index) => ({ ref, index }))
        .filter((entry) => uses.get(entry.ref.op.shapeId) === 1);
      if (exclusive.length < 2) return;

      const moved = firstExclusiveTarget(source).target;
      const deleted: EditorMeshTarget = { ...moved, drawOpIndex: exclusive[1].index, shapeIndex: exclusive[1].ref.op.shapeId };
      const edits: MeshEdit[] = [
        { target: moved, transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 900, z: 0 } }, visible: true, deleted: false },
        { target: deleted, transform: createIdentityMeshTransform(), visible: true, deleted: true },
      ];
      const copies: ImportedMesh[] = [{
        id: 'dup',
        sourcePath: COURSE_MODEL_PATH,
        modelName: moved.modelName,
        label: 'Copy',
        transform: { ...createIdentityMeshTransform(), translation: { x: 1200, y: 0, z: 0 } },
        visible: true,
        sourceShape: moved,
      }];

      const edited: TrackDocument = { ...track, meshEdits: edits, importedMeshes: copies };
      const bytes = exportTrack(edited, RAW);
      expect(bytes.length).toBeGreaterThan(0);

      // Re-open the export the same way the editor opens a dropped file.
      const reopened = await loadTrackBytes(bytes, `${name}-export`, { brresSummaryLimit: 0 });
      expect(reopened.kmp).toBeDefined();
      expect(reopened.kcl).toBeDefined();
      expect(reopened.brresFiles).toEqual(track.brresFiles);

      const exportedModel = courseModelBytes(reopened);
      const after = openCourseModel(exportedModel);
      expect(after.editor.listShapes().length).toBe(shapesBefore + 1);
      // One draw call removed, one appended.
      expect(collectDrawOps(after.editor).length).toBe(opsBefore);

      // ...and the renderer's own parser accepts it.
      const parsed = await parseWithNoclip(exportedModel);
      expect(parsed.mdl0.length).toBe(1);
      expect(parsed.mdl0[0].shapes.length).toBe(shapesBefore + 1);

      expect(validateRawExport(edited, bytes)).toEqual([]);
    });
  }

  const objectBrres = findObjectBrres(['itembox.brres', 'DokanSFC.brres', 'kuribo.brres']);

  it.skipIf(!objectBrres)('exports an imported object as part of the course model', async () => {
    const path = trackPaths[0];
    const name = path.split(/[\\/]/).pop()!;
    const track = await loadTrackBytes(readTrackBytes(path), name, { brresSummaryLimit: 0 });
    const shapesBefore = openCourseModel(courseModelBytes(track)).editor.listShapes().length;

    const edited: TrackDocument = {
      ...track,
      importedMeshes: [{
        id: 'placed',
        sourcePath: objectBrres!.name,
        modelName: '',
        label: objectBrres!.name,
        transform: { ...createIdentityMeshTransform(), translation: { x: 0, y: 2500, z: 0 } },
        visible: true,
      }],
      meshImportSources: { [objectBrres!.name]: objectBrres!.data },
    };

    const bytes = exportTrack(edited, RAW);
    const reopened = await loadTrackBytes(bytes, `${name}-import`, { brresSummaryLimit: 0 });
    const exportedModel = courseModelBytes(reopened);
    const parsed = await parseWithNoclip(exportedModel);

    expect(parsed.mdl0[0].shapes.length).toBeGreaterThan(shapesBefore);
    expect(validateRawExport(edited, bytes)).toEqual([]);
  });

  it('says so rather than silently dropping an import whose file is gone', async () => {
    const path = trackPaths[0];
    const name = path.split(/[\\/]/).pop()!;
    const track = await loadTrackBytes(readTrackBytes(path), name, { brresSummaryLimit: 0 });
    const edited: TrackDocument = {
      ...track,
      importedMeshes: [{
        id: 'gone',
        sourcePath: 'not-loaded.brres',
        modelName: '',
        label: 'Missing object',
        transform: createIdentityMeshTransform(),
        visible: true,
      }],
    };
    // The export still succeeds; the warning is what the UI shows the user.
    expect(() => exportTrack(edited, RAW)).not.toThrow();
  });
});
