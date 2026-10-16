import { mat4 } from 'gl-matrix';
import { describe, expect, it } from 'vitest';
import {
  GRAVITY_AREA_TYPE,
  GRAVITY_PATH_END,
  GravityFlag,
  GravityMode,
  GravityVolume,
  buildGravityOverlay,
  findGravityIssues,
  getAreaAxes,
  getGravityGateFrames,
  getGravityPathChains,
  getGravityScale,
  gravityRecordsFromEntities,
  planAreaTypeChange,
  planGravityChainExtension,
  planGravityFlagChange,
  planGravityModeChange,
  planGravityNextGate,
  planGravityVolumeChange,
  sampleGravity,
  type GravityAreaRecord,
} from './gravityField';
import {
  appendKmpArea,
  appendKmpGravityGate,
  deleteKmpEntity,
  moveKmpEntity,
  parseKmp,
  patchKmpAreaFields,
  patchKmpEntityRotation,
  patchKmpEntityScale,
  type KmpDocument,
} from './kmp';
import type { Vec3 } from './kmpFile';

const SECTION_NAMES = ['KTPT', 'ENPT', 'ENPH', 'ITPT', 'ITPH', 'CKPT', 'CKPH', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI'];

function createEmptyKmp(): KmpDocument {
  const headerSize = 0x10 + SECTION_NAMES.length * 4;
  const bytes = new Uint8Array(headerSize + SECTION_NAMES.length * 8);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RKMD'), 0);
  view.setUint32(0x04, bytes.length, false);
  view.setUint16(0x08, SECTION_NAMES.length, false);
  view.setUint16(0x0a, headerSize, false);
  view.setUint32(0x0c, 2520, false);
  SECTION_NAMES.forEach((name, index) => {
    const sectionOffset = headerSize + index * 8;
    view.setUint32(0x10 + index * 4, sectionOffset - headerSize, false);
    bytes.set(encoder.encode(name), sectionOffset);
  });
  return parseKmp(bytes);
}

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const one: Vec3 = { x: 1, y: 1, z: 1 };

function record(index: number, fields: Partial<GravityAreaRecord>): GravityAreaRecord {
  return {
    index,
    type: GRAVITY_AREA_TYPE,
    shape: 0,
    priority: 0,
    setting1: 0,
    setting2: 0,
    routeIndex: GravityMode.Parallel,
    enemyIndex: GravityVolume.Box,
    flags: 0,
    position: zero,
    rotation: zero,
    scale: one,
    ...fields,
  };
}

function gate(index: number, position: Vec3, next: number, fields: Partial<GravityAreaRecord> = {}): GravityAreaRecord {
  return record(index, { routeIndex: GravityMode.Path, enemyIndex: next, position, ...fields });
}

function expectVec(actual: Vec3, expected: Vec3, digits = 4) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

/** Adds a type-11 AREA with the given transform and fields (in AREA order). */
function addArea(doc: KmpDocument, position: Vec3, fields: Record<string, number>, rotation = zero, scale = one): KmpDocument {
  let next = parseKmp(appendKmpArea(doc, position));
  const index = next.entities.filter((entity) => entity.section === 'AREA').length - 1;
  const area = () => next.entities.find((entity) => entity.section === 'AREA' && entity.index === index)!;
  next = parseKmp(patchKmpEntityRotation(next, area(), rotation));
  next = parseKmp(patchKmpEntityScale(next, area(), scale));
  const patches = Object.entries({ type: GRAVITY_AREA_TYPE, ...fields }).map(([field, value]) => ({ index, field: field as 'type', value }));
  return parseKmp(patchKmpAreaFields(next, patches));
}

describe('gravity field math', () => {
  it('builds AREA axes like the game (EGG fromRPY, R = Rz * Ry * Rx)', () => {
    const rotation = { x: 30, y: 45, z: 60 };
    const d = Math.PI / 180;
    const m = mat4.create();
    mat4.rotateZ(m, m, rotation.z * d);
    mat4.rotateY(m, m, rotation.y * d);
    mat4.rotateX(m, m, rotation.x * d);
    const axes = getAreaAxes(rotation);
    expectVec(axes.x, { x: m[0], y: m[1], z: m[2] });
    expectVec(axes.y, { x: m[4], y: m[5], z: m[6] });
    expectVec(axes.z, { x: m[8], y: m[9], z: m[10] });
  });

  it('computes strength like the game (0 = normal, capped at 10x)', () => {
    expect(getGravityScale(0)).toBe(1);
    expect(getGravityScale(1300)).toBe(1);
    expect(getGravityScale(650)).toBeCloseTo(0.5);
    expect(getGravityScale(60000)).toBe(10);
  });

  it('resolves parallel, point and axis fields with their volumes', () => {
    // A wall: parallel box rolled 90 degrees, so its "down" is +X
    const wall = record(0, { rotation: { x: 0, y: 0, z: 90 } });
    const wallSample = sampleGravity([wall], { x: -5000, y: 0, z: 0 });
    expect(wallSample?.field.id).toBe(0);
    expectVec(wallSample!.up, { x: -1, y: 0, z: 0 });
    expect(sampleGravity([wall], { x: 5000, y: 0, z: 0 })).toBeNull();

    const planet = record(1, { routeIndex: GravityMode.PointAttract, enemyIndex: GravityVolume.Sphere, scale: { x: 2, y: 2, z: 2 } });
    const above = sampleGravity([undefined, planet], { x: 0, y: 19000, z: 0 });
    expectVec(above!.up, { x: 0, y: 1, z: 0 });
    // The sphere is centred at (0, 10000, 0) with radius 10000: the box corner is outside
    expect(sampleGravity([undefined, planet], { x: 9000, y: 1000, z: 9000 })).toBeNull();

    const tube = record(0, { routeIndex: GravityMode.AxisRepel, enemyIndex: GravityVolume.Cylinder });
    expectVec(sampleGravity([tube], { x: 3000, y: 5000, z: 0 })!.up, { x: -1, y: 0, z: 0 });
  });

  it('picks the higher priority field, and the first one on ties', () => {
    const low = record(0, {});
    const high = record(1, { priority: 2, rotation: { x: 180, y: 0, z: 0 }, position: { x: 0, y: 10000, z: 0 } });
    expect(sampleGravity([low, high], { x: 0, y: 5000, z: 0 })?.field.id).toBe(1);
    const tie = record(1, { position: { x: 0, y: 0, z: 0 } });
    expect(sampleGravity([low, tie], { x: 0, y: 5000, z: 0 })?.field.id).toBe(0);
  });
});

describe('gravity path chains', () => {
  it('forms one field per chain, OR-ing the gates flags', () => {
    const records = [
      gate(0, { x: 0, y: 0, z: 0 }, 1),
      gate(1, { x: 0, y: 0, z: 10000 }, 2, { flags: GravityFlag.CameraWorldUp }),
      gate(2, { x: 0, y: 0, z: 20000 }, GRAVITY_PATH_END),
      gate(3, { x: 50000, y: 0, z: 0 }, GRAVITY_PATH_END),
    ];
    expect(getGravityPathChains(records)).toEqual([[0, 1, 2], [3]]);
    const sample = sampleGravity(records, { x: 0, y: 2000, z: 15000 });
    expect(sample?.field).toMatchObject({ id: 0, mode: GravityMode.Path, flags: GravityFlag.CameraWorldUp, areas: [0, 1, 2] });
    expectVec(sample!.up, { x: 0, y: 1, z: 0 });
    // Not between any two gates
    expect(sampleGravity(records, { x: 0, y: 2000, z: -500 })).toBeNull();
  });

  it('turns gates facing against the chain around', () => {
    const records = [
      gate(0, { x: 0, y: 0, z: 0 }, 1),
      gate(1, { x: 0, y: 0, z: 10000 }, GRAVITY_PATH_END, { rotation: { x: 0, y: 180, z: 0 } }),
    ];
    const frames = getGravityGateFrames(records);
    expect(frames.get(1)?.flipped).toBe(true);
    expectVec(frames.get(1)!.axes.z, { x: 0, y: 0, z: 1 });
    expectVec(frames.get(1)!.axes.y, { x: 0, y: 1, z: 0 });
    expect(sampleGravity(records, { x: 0, y: 1000, z: 5000 })?.field.id).toBe(0);
  });

  it('twists the up direction between gates (corkscrew)', () => {
    const records = [
      gate(0, { x: 0, y: 0, z: 0 }, 1),
      gate(1, { x: 0, y: 0, z: 10000 }, GRAVITY_PATH_END, { rotation: { x: 0, y: 0, z: 90 } }),
    ];
    const sample = sampleGravity(records, { x: 0, y: 100, z: 5000 });
    const s = Math.SQRT1_2;
    expectVec(sample!.up, { x: -s, y: s, z: 0 }, 3);
  });

  it('reports broken and unlinked gates and too-sharp twists', () => {
    const records = [
      gate(0, { x: 0, y: 0, z: 0 }, 1),
      gate(1, { x: 0, y: 0, z: 10000 }, GRAVITY_PATH_END, { rotation: { x: 0, y: 0, z: 150 } }),
      gate(2, { x: 0, y: 0, z: 30000 }, 3),
      record(3, {}),
    ];
    const issues = findGravityIssues(records);
    expect(issues.find((issue) => issue.index === 0)?.message).toMatch(/turns 150 degrees/);
    expect(issues.find((issue) => issue.index === 2 && /not a path gate/.test(issue.message))).toBeTruthy();
    expect(issues.find((issue) => issue.index === 2 && /not linked/.test(issue.message))).toBeTruthy();
  });
});

describe('gravity edits', () => {
  it('applies defaults when an AREA becomes a gravity field and clears them when it stops', () => {
    const area = record(4, { type: 0, shape: 1, routeIndex: 0xff, enemyIndex: 0xff, flags: 0 });
    const enter = planAreaTypeChange(area, GRAVITY_AREA_TYPE);
    expect(Object.fromEntries(enter.map((patch) => [patch.field, patch.value]))).toEqual({
      type: 11, shape: 1, routeIndex: 0, enemyIndex: GravityVolume.Cylinder, setting1: 1300, setting2: 10, cameraIndex: 0xff, flags: 0,
    });
    const leave = planAreaTypeChange(record(4, { flags: 3 }), 0);
    expect(Object.fromEntries(leave.map((patch) => [patch.field, patch.value]))).toEqual({ type: 0, routeIndex: 0xff, enemyIndex: 0xff, flags: 0 });
  });

  it('swaps enemyIndex between volume and gate link on mode changes', () => {
    expect(planGravityModeChange(record(0, { enemyIndex: 2 }), GravityMode.Path)).toEqual([
      { index: 0, field: 'routeIndex', value: 5 },
      { index: 0, field: 'enemyIndex', value: GRAVITY_PATH_END },
      { index: 0, field: 'shape', value: 0 },
    ]);
    expect(planGravityModeChange(gate(0, zero, 3), GravityMode.AxisRepel)).toContainEqual({ index: 0, field: 'enemyIndex', value: GravityVolume.Box });
    expect(planGravityVolumeChange(record(0, {}), GravityVolume.Sphere)).toEqual([
      { index: 0, field: 'enemyIndex', value: 2 },
      { index: 0, field: 'shape', value: 1 },
    ]);
    expect(planGravityVolumeChange(gate(0, zero, 1), GravityVolume.Sphere)).toEqual([]);
  });

  it('links gates only to other gates and sets flags on a whole chain', () => {
    const records = [gate(0, zero, 1), gate(1, { x: 0, y: 0, z: 10000 }, GRAVITY_PATH_END, { flags: 0x100 }), record(2, {})];
    expect(planGravityNextGate(records, records[0], 2)).toEqual([{ index: 0, field: 'enemyIndex', value: GRAVITY_PATH_END }]);
    expect(planGravityNextGate(records, records[1], 0)).toEqual([{ index: 1, field: 'enemyIndex', value: 0 }]);
    expect(planGravityFlagChange(records, records[1], GravityFlag.ResetOnExit, true)).toEqual([
      { index: 0, field: 'flags', value: 1 },
      { index: 1, field: 'flags', value: 0x101 },
    ]);
    expect(planGravityFlagChange(records, records[2], GravityFlag.CameraWorldUp, true)).toEqual([{ index: 2, field: 'flags', value: 2 }]);
  });

  it('places an added gate along the chain, halfway to the next gate at most', () => {
    const records = [gate(0, zero, 1), gate(1, { x: 0, y: 0, z: 4000 }, GRAVITY_PATH_END)];
    expect(planGravityChainExtension(records, 0)).toEqual({ position: { x: 0, y: 0, z: 2000 }, next: 1 });
    expect(planGravityChainExtension(records, 1)).toEqual({ position: { x: 0, y: 0, z: 14000 }, next: GRAVITY_PATH_END });
  });
});

describe('gravity AREAs in course.kmp', () => {
  function chainDoc(): KmpDocument {
    let doc = createEmptyKmp();
    doc = addArea(doc, { x: 0, y: 0, z: 0 }, { routeIndex: 5, enemyIndex: 1 });
    doc = addArea(doc, { x: 0, y: 0, z: 10000 }, { routeIndex: 5, enemyIndex: 2 });
    doc = addArea(doc, { x: 0, y: 0, z: 20000 }, { routeIndex: 5, enemyIndex: GRAVITY_PATH_END, flags: GravityFlag.ResetOnExit });
    return doc;
  }
  const links = (doc: KmpDocument) => doc.entities.filter((entity) => entity.section === 'AREA').map((entity) => entity.area!.enemyIndex);

  it('reads and writes the flags at 0x2E', () => {
    const doc = chainDoc();
    expect(doc.entities.filter((entity) => entity.section === 'AREA').map((entity) => entity.area!.flags)).toEqual([0, 0, 1]);
    const area = doc.entities.find((entity) => entity.id === 'AREA-2')!;
    expect(new DataView(doc.original.buffer).getUint16(area.rawOffset + 0x2e, false)).toBe(1);
  });

  it('keeps gate links pointing at the same AREAs after deleting or reordering', () => {
    const doc = chainDoc();
    const deleted = parseKmp(deleteKmpEntity(doc, doc.entities.find((entity) => entity.id === 'AREA-1')!));
    expect(links(deleted)).toEqual([GRAVITY_PATH_END, GRAVITY_PATH_END]);
    const deletedFirst = parseKmp(deleteKmpEntity(doc, doc.entities.find((entity) => entity.id === 'AREA-0')!));
    expect(links(deletedFirst)).toEqual([1, GRAVITY_PATH_END]);

    const moved = parseKmp(moveKmpEntity(doc, doc.entities.find((entity) => entity.id === 'AREA-0')!, 1));
    // AREA 0 and 1 swapped places: the old gate 0 (now 1) still links to the old gate 1 (now 0)
    expect(links(moved)).toEqual([2, 0, GRAVITY_PATH_END]);
    expect(getGravityPathChains(gravityRecordsFromEntities(moved.entities))).toEqual([[0, 1, 2]]);
  });

  it('adds a gate after a gate and relinks the chain', () => {
    const doc = chainDoc();
    const result = appendKmpGravityGate(doc, 0);
    const next = parseKmp(result.bytes);
    expect(result.index).toBe(3);
    expect(links(next)).toEqual([3, 2, GRAVITY_PATH_END, 1]);
    expect(next.entities.find((entity) => entity.id === 'AREA-3')!.position).toEqual({ x: 0, y: 0, z: 5000 });
  });
});

describe('gravity overlay', () => {
  it('draws every field with animated flow and labels only the selected field', () => {
    const records = [
      record(0, {}),
      record(1, { routeIndex: GravityMode.PointAttract, enemyIndex: GravityVolume.Sphere, position: { x: 30000, y: 0, z: 0 } }),
      gate(2, { x: 0, y: 0, z: 40000 }, 3),
      gate(3, { x: 0, y: 0, z: 50000 }, GRAVITY_PATH_END),
    ];
    const idle = buildGravityOverlay(records);
    expect(idle.flows.length).toBeGreaterThan(10);
    expect(idle.labels).toHaveLength(0);
    // Parallel streams point down (along gravity)
    const down = idle.flows[0].points;
    expect(down[1].y).toBeLessThan(down[0].y);

    const selected = buildGravityOverlay(records, { selected: new Set([3]) });
    expect(selected.labels).toHaveLength(1);
    expect(selected.labels[0].text).toMatch(/Path/);
    expect(selected.triangles.length).toBeGreaterThan(idle.triangles.length);
  });
});
