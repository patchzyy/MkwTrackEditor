import { describe, expect, it } from 'vitest';
import { KMP_NULL_INDEX_8, KMP_NULL_INDEX_16, createEmptyKmpFile, type KmpFile } from '../../lib/kmpFile';
import { createEnemyPoint, setCheckpointGraph, setEnemyPathGraph } from '../../lib/kmpGraph';
import type { TrackIssue } from '../../lib/kmpValidation';
import {
  buildKmpOutliner,
  computeKeyCheckpointHints,
  describeRouteUsage,
  expansionPathForEntity,
  filterKmpOutliner,
  flattenKmpOutliner,
  outlinerRangeSelection,
  type KmpOutlinerNode,
} from './kmpOutlinerModel';
import { KMP_OUTLINER_SECTIONS, pathGroupColor, pathGroupColorRgb, sectionForEntityId } from './kmpSections';

const objectName = (objectId: number) => (objectId === 0x65 ? 'Item Box' : objectId === 0xcb ? 'Goomba' : `Object ${objectId}`);

function sampleFile(): KmpFile {
  const base = createEmptyKmpFile();
  const withEnemy = setEnemyPathGraph(base, {
    kind: 'enemy',
    groups: [
      { points: [createEnemyPoint({ x: 0, y: 0, z: 0 }), createEnemyPoint({ x: 100, y: 0, z: 0 })], prev: [], next: [1], linkFlags: 0 },
      { points: [createEnemyPoint({ x: 200, y: 0, z: 0 })], prev: [0], next: [], linkFlags: 0 },
    ],
  });
  const withCheckpoints = setCheckpointGraph(withEnemy, {
    kind: 'checkpoint',
    groups: [
      {
        points: [
          { x1: -500, z1: 0, x2: 500, z2: 0, respawnIndex: 0, type: 0, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 },
          { x1: -500, z1: 900, x2: 500, z2: 900, respawnIndex: KMP_NULL_INDEX_8, type: KMP_NULL_INDEX_8, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 },
          { x1: -500, z1: 1800, x2: 500, z2: 1800, respawnIndex: 0, type: 5, prev: KMP_NULL_INDEX_8, next: KMP_NULL_INDEX_8 },
        ],
        prev: [],
        next: [],
        linkFlags: 0,
      },
    ],
  });
  return {
    ...withCheckpoints,
    startPoints: [
      { position: { x: 0, y: 100, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, playerIndex: -1, padding: 0 },
    ],
    respawnPoints: [{ position: { x: 0, y: 50, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, id: 0, extraUserData: -1 }],
    objects: [
      { objectId: 0x65, extendedPresence: 0, position: { x: 10, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, routeIndex: KMP_NULL_INDEX_16, settings: [0, 0, 0, 0, 0, 0, 0, 0], presenceFlags: 0x3f },
      { objectId: 0x65, extendedPresence: 0, position: { x: 20, y: 0, z: 20 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, routeIndex: KMP_NULL_INDEX_16, settings: [0, 0, 0, 0, 0, 0, 0, 0], presenceFlags: 0x3f },
      { objectId: 0xcb, extendedPresence: 0, position: { x: 30, y: 0, z: 30 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, routeIndex: 0, settings: [0, 0, 0, 0, 0, 0, 0, 0], presenceFlags: 0x3f },
    ],
    routes: [
      { smooth: 0, forwardBackward: 0, points: [{ position: { x: 0, y: 0, z: 0 }, setting1: 10, setting2: 0 }, { position: { x: 500, y: 0, z: 0 }, setting1: 10, setting2: 0 }] },
    ],
  };
}

function findNode(sections: KmpOutlinerNode[], id: string): KmpOutlinerNode | null {
  for (const section of sections) {
    const stack = [section];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.id === id) return node;
      stack.push(...node.children);
    }
  }
  return null;
}

describe('buildKmpOutliner', () => {
  it('always returns one node per section, even without a track', () => {
    const sections = buildKmpOutliner({ file: null, objectName });
    expect(sections).toHaveLength(KMP_OUTLINER_SECTIONS.length);
    expect(sections.map((section) => section.section)).toEqual(KMP_OUTLINER_SECTIONS.map((section) => section.key));
    expect(sections.every((section) => section.count === 0)).toBe(true);
  });

  it('groups enemy route points under their path groups', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const enemy = sections.find((section) => section.section === 'enemy')!;
    expect(enemy.children).toHaveLength(2);
    expect(enemy.children[0].label).toBe('Group 1');
    expect(enemy.children[0].children.map((child) => child.entityId)).toEqual(['ENPT-0', 'ENPT-1']);
    expect(enemy.children[1].children.map((child) => child.entityId)).toEqual(['ENPT-2']);
    expect(enemy.count).toBe(3);
  });

  it('describes group links in friendly one-based numbers', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const enemy = sections.find((section) => section.section === 'enemy')!;
    expect(enemy.children[0].detail).toContain('to 2');
    expect(enemy.children[1].detail).toContain('from 1');
  });

  it('buckets objects by their friendly name', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const objects = sections.find((section) => section.section === 'object')!;
    expect(objects.children.map((child) => child.label)).toEqual(['Goomba', 'Item Box']);
    expect(objects.children[1].children.map((child) => child.entityId)).toEqual(['GOBJ-0', 'GOBJ-1']);
    expect(objects.count).toBe(3);
  });

  it('labels checkpoints by their role', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const checkpoints = sections.find((section) => section.section === 'checkpoint')!;
    const details = checkpoints.children[0].children.map((child) => child.detail);
    expect(details[0]).toContain('Lap counter');
    expect(details[1]).toContain('Normal');
    expect(details[2]).toContain('Key 5');
    expect(details[1]).toContain('no respawn');
  });

  it('lists routes with their point counts and what uses them', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const routes = sections.find((section) => section.section === 'route')!;
    expect(routes.children).toHaveLength(1);
    expect(routes.children[0].detail).toContain('2 points');
    expect(routes.children[0].detail).toContain('used by objects');
    expect(routes.children[0].children.map((child) => child.entityId)).toEqual(['POTI-0-0', 'POTI-0-1']);
  });

  it('summarises track settings on the section row itself', () => {
    const sections = buildKmpOutliner({ file: sampleFile(), objectName });
    const stage = sections.find((section) => section.section === 'stage')!;
    expect(stage.entityId).toBe('STGI-0');
    expect(stage.detail).toContain('lap');
  });

  it('propagates validation levels up to the group and section rows', () => {
    const issues: TrackIssue[] = [
      { level: 'warning', code: 'object.disabled', message: 'x', entityId: 'GOBJ-0' },
      { level: 'error', code: 'checkpoint.no-respawn', message: 'y', entityId: 'CKPT-1' },
    ];
    const sections = buildKmpOutliner({ file: sampleFile(), objectName, issues });
    expect(findNode(sections, 'entity:GOBJ-0')!.issueLevel).toBe('warning');
    expect(findNode(sections, 'section:object')!.issueLevel).toBe('warning');
    expect(findNode(sections, 'entity:CKPT-1')!.issueLevel).toBe('error');
    expect(findNode(sections, 'group:checkpoint:0')!.issueLevel).toBe('error');
    expect(findNode(sections, 'section:checkpoint')!.issueLevel).toBe('error');
    expect(findNode(sections, 'section:respawn')!.issueLevel).toBeNull();
  });

  it('prefers the worse level when a subtree has both', () => {
    const issues: TrackIssue[] = [
      { level: 'warning', code: 'a', message: 'x', entityId: 'ENPT-0' },
      { level: 'error', code: 'b', message: 'y', entityId: 'ENPT-1' },
    ];
    const sections = buildKmpOutliner({ file: sampleFile(), objectName, issues });
    expect(findNode(sections, 'group:enemy:0')!.issueLevel).toBe('error');
  });
});

describe('describeRouteUsage', () => {
  it('marks unused routes as unused', () => {
    const file = sampleFile();
    const usage = describeRouteUsage({ ...file, objects: [] });
    expect(usage[0]).toBe('unused');
  });

  it('lists every kind of user of a route', () => {
    const file = sampleFile();
    const usage = describeRouteUsage({
      ...file,
      areas: [
        { shape: 0, type: 3, cameraIndex: KMP_NULL_INDEX_8, priority: 0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, setting1: 0, setting2: 0, routeIndex: 0, enemyPointIndex: KMP_NULL_INDEX_8, padding: 0 },
      ],
    });
    expect(usage[0]).toBe('used by objects and areas');
  });
});

describe('filterKmpOutliner', () => {
  const sections = buildKmpOutliner({ file: sampleFile(), objectName });

  it('returns everything for an empty query', () => {
    expect(filterKmpOutliner(sections, '   ')).toBe(sections);
  });

  it('keeps a whole subtree when the parent matches', () => {
    const filtered = filterKmpOutliner(sections, 'item box');
    const objects = filtered.find((section) => section.section === 'object')!;
    expect(objects.children).toHaveLength(1);
    expect(objects.children[0].children).toHaveLength(2);
  });

  it('keeps only the matching leaf when the parent does not match', () => {
    const filtered = filterKmpOutliner(sections, 'lap counter');
    const checkpoints = filtered.find((section) => section.section === 'checkpoint')!;
    expect(checkpoints.children[0].children.map((child) => child.entityId)).toEqual(['CKPT-0']);
  });

  it('drops sections with no match at all', () => {
    const filtered = filterKmpOutliner(sections, 'goomba');
    expect(filtered.map((section) => section.section)).toEqual(['object']);
  });

  it('requires every whitespace-separated term to match', () => {
    expect(filterKmpOutliner(sections, 'item nonsense')).toHaveLength(0);
  });

  it('is case insensitive', () => {
    expect(filterKmpOutliner(sections, 'GOOMBA')).toHaveLength(1);
  });
});

describe('flattenKmpOutliner', () => {
  const sections = buildKmpOutliner({ file: sampleFile(), objectName });

  it('shows only section rows when nothing is expanded', () => {
    const rows = flattenKmpOutliner(sections, new Set());
    expect(rows).toHaveLength(KMP_OUTLINER_SECTIONS.length);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
  });

  it('marks sections with children as expandable', () => {
    const rows = flattenKmpOutliner(sections, new Set());
    expect(rows.find((row) => row.node.section === 'enemy')!.expandable).toBe(true);
    expect(rows.find((row) => row.node.section === 'stage')!.expandable).toBe(false);
  });

  it('walks into expanded nodes and increases the depth', () => {
    const rows = flattenKmpOutliner(sections, new Set(['section:enemy', 'group:enemy:0']));
    const ids = rows.map((row) => row.node.id);
    expect(ids).toContain('group:enemy:0');
    expect(ids).toContain('entity:ENPT-0');
    expect(rows.find((row) => row.node.id === 'entity:ENPT-0')!.depth).toBe(2);
    expect(ids).not.toContain('entity:ENPT-2');
  });
});

describe('expansionPathForEntity', () => {
  const sections = buildKmpOutliner({ file: sampleFile(), objectName });

  it('returns the ancestors of a nested entity', () => {
    expect(expansionPathForEntity(sections, 'ENPT-2')).toEqual(['section:enemy', 'group:enemy:1']);
  });

  it('returns the ancestors of an object under its name bucket', () => {
    expect(expansionPathForEntity(sections, 'GOBJ-2')).toEqual(['section:object', 'group:object:goomba']);
  });

  it('returns nothing for an unknown entity', () => {
    expect(expansionPathForEntity(sections, 'GOBJ-99')).toEqual([]);
  });
});

describe('outlinerRangeSelection', () => {
  const sections = buildKmpOutliner({ file: sampleFile(), objectName });
  const rows = flattenKmpOutliner(sections, new Set(['section:enemy', 'group:enemy:0', 'group:enemy:1']));

  it('collects every entity between two rows', () => {
    expect(outlinerRangeSelection(rows, 'entity:ENPT-0', 'entity:ENPT-2')).toEqual(['ENPT-0', 'ENPT-1', 'ENPT-2']);
  });

  it('works backwards too', () => {
    expect(outlinerRangeSelection(rows, 'entity:ENPT-2', 'entity:ENPT-0')).toEqual(['ENPT-0', 'ENPT-1', 'ENPT-2']);
  });

  it('includes the whole subtree of a group row in the range', () => {
    expect(outlinerRangeSelection(rows, 'group:enemy:0', 'entity:ENPT-0')).toEqual(['ENPT-0', 'ENPT-1']);
  });

  it('returns nothing when a row is not on screen', () => {
    expect(outlinerRangeSelection(rows, 'entity:ENPT-0', 'entity:GOBJ-0')).toEqual([]);
  });
});

describe('computeKeyCheckpointHints', () => {
  it('lists only key checkpoints', () => {
    const hints = computeKeyCheckpointHints(sampleFile());
    expect(hints.map((hint) => hint.checkpointIndex)).toEqual([0, 2]);
    expect(hints.map((hint) => hint.keyNumber)).toEqual([0, 5]);
    expect(hints.every((hint) => !hint.outOfOrder)).toBe(true);
  });

  it('flags a key checkpoint that goes backwards', () => {
    const file = sampleFile();
    const broken = { ...file, checkpoints: file.checkpoints.map((checkpoint, index) => (index === 2 ? { ...checkpoint, type: 0 } : index === 0 ? { ...checkpoint, type: 3 } : checkpoint)) };
    const hints = computeKeyCheckpointHints(broken);
    expect(hints.find((hint) => hint.checkpointIndex === 2)!.outOfOrder).toBe(true);
  });

  it('flags duplicated key numbers', () => {
    const file = sampleFile();
    const dupes = { ...file, checkpoints: file.checkpoints.map((checkpoint) => ({ ...checkpoint, type: 0 })) };
    expect(computeKeyCheckpointHints(dupes).every((hint) => hint.duplicate)).toBe(true);
  });

  it('returns nothing for a track without checkpoints', () => {
    expect(computeKeyCheckpointHints(createEmptyKmpFile())).toEqual([]);
    expect(computeKeyCheckpointHints(null)).toEqual([]);
  });
});

describe('kmpSections', () => {
  it('maps entity ids back to their section', () => {
    expect(sectionForEntityId('GOBJ-3')?.key).toBe('object');
    expect(sectionForEntityId('POTI-1-2')?.key).toBe('route');
    expect(sectionForEntityId('STGI-0')?.key).toBe('stage');
    expect(sectionForEntityId(null)).toBeNull();
    expect(sectionForEntityId('NOPE-1')).toBeNull();
  });

  it('gives every group a stable colour and wraps around the palette', () => {
    expect(pathGroupColor(0)).toBe(pathGroupColor(12));
    expect(pathGroupColor(0)).not.toBe(pathGroupColor(1));
    expect(pathGroupColor(-1)).toBe(pathGroupColor(0));
  });

  it('converts palette colours to 0..1 rgb', () => {
    const [r, g, b] = pathGroupColorRgb(0);
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    expect(pathGroupColorRgb(1)).not.toEqual(pathGroupColorRgb(0));
  });
});
