import { describe, expect, it } from 'vitest';
import type { CreateChecklist } from '../session/types';
import { addProp, addTerrainStroke, splitSection } from '../../../lib/create/ops';
import { flattenTree } from '../../components/treeModel';
import { freshBlank, freshOval, kit } from '../tools/testing';
import { checklistAction, checklistProgress, nextStep } from './checklistActions';
import { ancestorsFor, buildLayerNodes, defaultExpanded, formatDriveTime, nodeIdFor } from './layersModel';

const item = (state: 'done' | 'todo' | 'warning' | 'error', detail = 'x', title = 't') => ({ state, title, detail });
const checklist = (over: Partial<CreateChecklist> = {}): CreateChecklist => ({
  world: item('done'),
  roadLoop: item('done'),
  startLine: item('done'),
  itemBoxes: item('done'),
  drivable: item('done'),
  testDrive: item('todo', 'Take it for a spin (F5).'),
  ...over,
});

describe('layers model', () => {
  it('lists roads with sections and points, pieces, scenery, terrain and the start line', () => {
    let project = freshOval();
    project = splitSection(project, project.roads[0].id, 6.5).project;
    project = addProp(project, { objectId: 303, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, snapToGround: true }).project;
    project = addTerrainStroke(project, { kind: 'paint', surface: { surfaceId: 'test.sand' }, radius: 1000, points: [{ x: 0, z: 0 }] }).project;
    const nodes = buildLayerNodes(project, kit);
    expect(nodes.map((n) => n.label)).toEqual(['Roads', 'Pieces', 'Scenery', 'Terrain', 'Start line']);
    const road = nodes[0].children![0];
    expect(road.label).toBe('Main road');
    expect(road.detail).toMatch(/^Loop · \d+ s$/);
    expect(road.children!.map((c) => c.label)).toEqual(['Sections', 'Points']);
    expect(road.children![0].children).toHaveLength(2);
    expect(road.children![1].children).toHaveLength(24);
    expect(nodes[2].children![0].detail).toBe('×1');
    expect(nodes[3].children![0].label).toBe('Paint test sand');
  });

  it('an empty design has an empty tree so the empty state can teach', () => {
    expect(buildLayerNodes(freshBlank(), kit)).toEqual([]);
  });

  it('every selectable row id is findable from its selection and reveals through its ancestors', () => {
    const project = freshOval();
    const road = project.roads[0];
    const nodes = buildLayerNodes(project, kit);
    const expanded = new Set<string>([...defaultExpanded(project), ...ancestorsFor({ kind: 'point', roadId: road.id, pointId: road.points[5].id }, project)]);
    const rows = flattenTree(nodes, expanded);
    expect(rows.some((r) => r.id === nodeIdFor({ kind: 'point', roadId: road.id, pointId: road.points[5].id }))).toBe(true);
    expect(rows.some((r) => r.id === nodeIdFor({ kind: 'start' }))).toBe(true);
  });

  it('formats drive time like the checklist', () => {
    expect(formatDriveTime(180000)).toMatch(/s$/);
    expect(formatDriveTime(5)).toBe('1 s');
  });
});

describe('checklist actions', () => {
  it('the World row opens the track settings', () => {
    expect(checklistAction('world', item('done'), freshOval(), [])).toEqual({ type: 'trackSettings' });
  });

  it('Road loop: no road starts the Road tool; an open road continues it; a closed road is framed', () => {
    expect(checklistAction('roadLoop', item('todo'), freshBlank(), [])).toEqual({ type: 'tool', tool: 'road' });
    const open = freshOval();
    open.roads[0] = { ...open.roads[0], closed: false };
    expect(checklistAction('roadLoop', item('warning'), open, [])).toMatchObject({ type: 'tool', tool: 'road', frame: true, select: [{ kind: 'road' }] });
    expect(checklistAction('roadLoop', item('done'), freshOval(), [])).toMatchObject({ type: 'show', selection: { kind: 'road' } });
  });

  it('Start line and Item boxes jump to their tools', () => {
    expect(checklistAction('startLine', item('todo'), freshOval(), [])).toEqual({ type: 'tool', tool: 'start' });
    expect(checklistAction('startLine', item('done'), freshOval(), [])).toEqual({ type: 'show', selection: { kind: 'start' } });
    expect(checklistAction('itemBoxes', item('todo'), freshOval(), [])).toMatchObject({ type: 'tool', tool: 'pieces', arm: { kind: 'piece', piece: 'itemRow' } });
  });

  it('Drivable shows the first error that has something to show', () => {
    const issues = [
      { level: 'warning' as const, code: 'a', message: 'w', target: { kind: 'start' as const } },
      { level: 'error' as const, code: 'b', message: 'e', target: { kind: 'road' as const, roadId: 'r1' } },
    ];
    expect(checklistAction('drivable', item('error'), freshOval(), issues)).toEqual({ type: 'show', selection: { kind: 'road', roadId: 'r1' } });
    expect(checklistAction('drivable', item('done'), freshOval(), issues)).toEqual({ type: 'none' });
    expect(checklistAction('testDrive', item('todo'), freshOval(), [])).toEqual({ type: 'testDrive' });
  });

  it('counts progress and says what to do next, treating item boxes as a suggestion', () => {
    expect(checklistProgress(checklist())).toEqual({ done: 5, total: 6 });
    expect(nextStep(checklist({ roadLoop: item('warning', 'Close your road into a loop.') }))).toBe('Close your road into a loop.');
    expect(nextStep(checklist({ itemBoxes: item('todo', 'Add item boxes'), testDrive: item('done') }))).toMatch(/All set/);
  });
});
