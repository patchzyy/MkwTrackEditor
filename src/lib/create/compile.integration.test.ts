/**
 * End to end: every layout template compiled with the REAL asset kit and the REAL writers, packed
 * into a `.szs`, re-opened with the editor's own loader, validated, and then driven for a lap in
 * the Kinoko physics engine by a pursuit controller that follows the generated enemy route.
 *
 * Needs the committed kit (public/data/MarioKartWii/Create/create-kit.szs), the committed
 * Common.szs and the committed Kinoko WASM; skips itself when any of them is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTrackBytes, validateTrack } from '../track';
import { parseKcl, raycastDown } from '../kcl';
import { validateKmpFile } from '../kmpValidation';
import type { PlaytestRuntime } from '../playtest/types';
import type { CompileWriters, CreateKit, CreateProject } from './types';
import { useDeterministicIds } from './ids';
import { createProjectFromTemplate, LAYOUT_TEMPLATES } from './templates';
import { buildTrackArchive, compileProject } from './compile';
import { addPiece, deletePiece, splitSection, updateRoad, updateSection } from './ops';
import { distanceToRoadParam, evaluateRoadAt, roadParamToDistance } from './spline';
import { driveRoute, makeRuntime } from './__tests__/kinokoDrive.testdata';

const KIT_PATH = 'public/data/MarioKartWii/Create/create-kit.szs';
const COMMON_PATH = 'public/data/MarioKartWii/Race/Common.szs';
const WASM_PATH = 'src/lib/playtest/wasm/kinoko.wasm';
const haveAll =
  existsSync(KIT_PATH) &&
  existsSync(COMMON_PATH) &&
  existsSync(WASM_PATH) &&
  existsSync('src/lib/create/writers/index.ts') &&
  existsSync('src/lib/create/kit/index.ts');

const templates = LAYOUT_TEMPLATES.filter((t) => t.id !== 'blank').map((t) => t.id);

describe.skipIf(!haveAll)('compile with the real kit and writers', () => {
  let kit: CreateKit;
  let writers: CompileWriters;
  let runtime: PlaytestRuntime;

  beforeAll(async () => {
    useDeterministicIds();
    const kitModule = await import('./kit');
    const writerModule = await import('./writers');
    kit = kitModule.createKitFromArchive(new Uint8Array(readFileSync(KIT_PATH)));
    writers = writerModule.writers;
    runtime = await makeRuntime();
  }, 120_000);

  afterAll(() => runtime?.dispose());

  const make = (template: string, themeId: string): CreateProject =>
    createProjectFromTemplate(template, { name: `${template} on ${themeId}`, themeId, laps: 3 }, kit);

  describe.each(templates)('%s (sunny)', (template) => {
    it('compiles, packs, re-opens cleanly and has collision under the road', async () => {
      const project = make(template, 'sunny');
      const result = compileProject(project, kit, writers);
      expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(result.issues).toEqual([]);
      const szs = buildTrackArchive(result);
      const doc = await loadTrackBytes(szs, `${template}.szs`, { modelPreviews: false });
      expect(doc.warnings).toEqual([]);
      expect(validateTrack(doc).filter((i) => i.level === 'error')).toEqual([]);
      expect(doc.brresFiles.sort()).toEqual(['./course_model.brres', './map_model.brres', './vrcorn_model.brres']);
      expect(doc.kmpFile!.checkpoints.length).toBe(result.kmp.checkpoints.length);
      expect(validateKmpFile(doc.kmpFile!).filter((i) => i.level === 'error')).toEqual([]);

      // The KCL the writer produced finds the road where the design put it.
      const kcl = parseKcl(result.files.get('course.kcl')!);
      expect(kcl.triangles.length).toBeGreaterThan(result.geometry.collision.flags.length * 0.95);
      const road = project.roads[0];
      for (const u of [0.3, 3.7, 8.1]) {
        const s = evaluateRoadAt(road, u);
        const hit = raycastDown(kcl, s.position.x, s.position.z, s.position.y + 400);
        expect(hit).not.toBeNull();
        expect(Math.abs(hit!.y - s.position.y)).toBeLessThan(40);
      }
    }, 120_000);

    it('can be driven for a lap without ever falling off', () => {
      const project = make(template, 'sunny');
      const result = compileProject(project, kit, writers);
      const szs = buildTrackArchive(result, { compress: false });
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, szs, route, { stopAtLap: 2, maxRaceFrames: 60 * 100 });
      console.log(
        `${template}: lap 1 took ${((drive.lapSplitsMs[0] ?? drive.timeMs) / 1000).toFixed(1)} s, length ${Math.round(result.stats.roadLength)}, ${result.stats.checkpoints} checkpoints, geometry ${result.stats.millis.toFixed(0)} ms (incl. writers)`,
      );
      expect(drive.respawns).toBe(0);
      expect(drive.finalLap).toBeGreaterThanOrEqual(2);
      expect(drive.lapSplitsMs.length).toBeGreaterThanOrEqual(1);
      expect(drive.lapSplitsMs[0] / 1000).toBeGreaterThan(25);
      expect(drive.lapSplitsMs[0] / 1000).toBeLessThan(60);
      expect(drive.maxOffRoute).toBeLessThan(project.generation.enemySpacing);
      // The boost panel on the first straight really boosts (cruising tops out around 80).
      expect(drive.maxSpeed).toBeGreaterThan(100);
    }, 120_000);
  });

  describe('every world', () => {
    const worlds = ['sunny', 'gorge', 'desert', 'snow', 'beach', 'castle', 'night', 'factory', 'space', 'garden', 'autumn'];
    it.each(worlds)('%s compiles an oval that re-opens without warnings', async (themeId) => {
      const theme = kit.theme(themeId);
      if (!theme) return; // the kit may be rebuilt with other worlds
      const project = make('oval', themeId);
      const result = compileProject(project, kit, writers);
      expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
      const doc = await loadTrackBytes(buildTrackArchive(result, { compress: false }), 'w.szs', { modelPreviews: false });
      expect(doc.warnings).toEqual([]);
      expect(validateTrack(doc).filter((i) => i.level === 'error')).toEqual([]);
      for (const path of Object.keys(theme.files)) expect(doc.archiveEntries.some((e) => e.path === `./${path}`)).toBe(true);
    }, 120_000);

    it('a sky world (no ground) can be driven for a lap', () => {
      const sky = kit.catalog.themes.find((t) => !t.terrain);
      if (!sky) return;
      const project = make('hills', sky.id);
      expect(project.terrain.enabled).toBe(false);
      const result = compileProject(project, kit, writers);
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, buildTrackArchive(result, { compress: false }), route, { stopAtLap: 2, maxRaceFrames: 60 * 100 });
      expect(drive.respawns).toBe(0);
      expect(drive.finalLap).toBeGreaterThanOrEqual(2);
    }, 120_000);
  });

  describe('road styles and section kinds', () => {
    const styles = ['circuit', 'walled', 'barrier', 'trail', 'bridge', 'castle', 'sky'];
    it.each(styles)('a %s road is drivable', (styleId) => {
      let p = make('kidney', 'sunny');
      p = updateRoad(p, p.roads[0].id, { styleId });
      const result = compileProject(p, kit, writers);
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, buildTrackArchive(result, { compress: false }), route, { stopAtLap: 2, maxRaceFrames: 60 * 100 });
      expect(drive.respawns).toBe(0);
      expect(drive.finalLap).toBeGreaterThanOrEqual(2);
    }, 120_000);

    it.each(['bridge', 'tunnel'] as const)('a %s stretch in the middle of the lap is drivable', (kind) => {
      let p = make('kidney', 'sunny');
      const rid = p.roads[0].id;
      const a = splitSection(p, rid, 3);
      const b = splitSection(a.project, rid, 9);
      p = updateSection(b.project, rid, a.id, { kind });
      const result = compileProject(p, kit, writers);
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, buildTrackArchive(result, { compress: false }), route, { stopAtLap: 2, maxRaceFrames: 60 * 100 });
      expect(drive.respawns).toBe(0);
      expect(drive.finalLap).toBeGreaterThanOrEqual(2);
      // A tunnel ceiling must not slow the kart down (it once did when the ceiling was too low).
      expect(drive.lapSplitsMs[0] / 1000).toBeLessThan(45);
    }, 120_000);
  });

  describe('gaps', () => {
    function withGap(gapLength: number, ramp: boolean): CreateProject {
      let p = make('oval', 'sunny');
      const road = p.roads[0];
      p = p.pieces.filter((x) => x.kind === 'boostPanel').reduce((q, x) => deletePiece(q, x.id), p);
      const gapStart = roadParamToDistance(road, p.start.param) + 14000;
      const a = splitSection(p, road.id, distanceToRoadParam(road, gapStart));
      const b = splitSection(a.project, road.id, distanceToRoadParam(road, gapStart + gapLength));
      p = updateSection(b.project, road.id, a.id, { kind: 'gap' });
      if (ramp) {
        p = addPiece(p, {
          kind: 'boostRamp',
          roadId: road.id,
          param: distanceToRoadParam(road, gapStart - 1200),
          lateral: 0,
          width: 2200,
          length: 2400,
          height: 420,
        }).project;
      }
      return p;
    }

    it('a boost ramp launches a kart over a gap it can clear', () => {
      const result = compileProject(withGap(6000, true), kit, writers);
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, buildTrackArchive(result, { compress: false }), route, { stopAtLap: 2, maxRaceFrames: 60 * 100 });
      expect(drive.respawns).toBe(0);
      expect(drive.finalLap).toBeGreaterThanOrEqual(2);
    }, 120_000);

    it('falling into a gap that is too wide sends the kart back to a respawn point', () => {
      const result = compileProject(withGap(11000, true), kit, writers);
      const route = result.kmp.enemyPoints.map((e) => e.position);
      const drive = driveRoute(runtime, buildTrackArchive(result, { compress: false }), route, { stopAtLap: 2, maxRaceFrames: 60 * 40 });
      expect(drive.respawns).toBeGreaterThan(0);
      expect(drive.finalLap).toBe(1);
    }, 120_000);
  });
});
