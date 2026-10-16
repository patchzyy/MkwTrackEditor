/**
 * Pure view model for the KMP outliner.
 *
 * The outliner is a tree of sections -> groups -> entities built straight from the structured
 * `KmpFile`. Everything here is pure so the tree, the search filter and the multi-select range
 * maths can be unit tested without React.
 */

import { KMP_NULL_INDEX_8, KMP_NULL_INDEX_16, type KmpFile } from '../../lib/kmpFile';
import { computeLapPathValidity, getCheckpointGraph } from '../../lib/kmpGraph';
import type { TrackIssue } from '../../lib/kmpValidation';
import { areaTypeName, cameraTypeName } from '../../lib/kmpFile';
import { GRAVITY_AREA_TYPE, GravityMode, getGravityMode, getGravityVolume, gravityModeOptions, gravityVolumeOptions } from '../../lib/gravityField';

/** Outliner detail of a gravity field: its mode, and its volume or next gate. */
function gravityAreaDetail(routeIndex: number, enemyIndex: number, shape: number): string {
  const mode = getGravityMode({ routeIndex });
  const modeLabel = gravityModeOptions.find((option) => option.value === mode)?.label ?? 'Parallel';
  if (mode === GravityMode.Path) return enemyIndex === 0xff ? 'Gate, end' : `Gate → ${enemyIndex + 1}`;
  const volume = gravityVolumeOptions.find((option) => option.value === getGravityVolume({ enemyIndex, shape }))?.label ?? 'Box';
  return `${modeLabel} ${volume.toLowerCase()}`;
}
import {
  KMP_OUTLINER_SECTIONS,
  pathGroupColor,
  type KmpOutlinerSectionKey,
  type KmpOutlinerSectionMeta,
} from './kmpSections';

export type KmpOutlinerNodeKind = 'section' | 'group' | 'entity';

export interface KmpOutlinerNode {
  /** Unique row id: `section:object`, `group:enemy:2`, `entity:GOBJ-7`. */
  id: string;
  kind: KmpOutlinerNodeKind;
  section: KmpOutlinerSectionKey;
  label: string;
  /** Secondary text shown to the right of the label. */
  detail: string;
  /** How many entities live under this node. */
  count: number;
  /** KMP entity id selected when the row is clicked, when the row maps to one record. */
  entityId: string | null;
  /** Every entity id under this node, in track order. Drives "select group" and shift-range. */
  entityIds: string[];
  /** Path-group index for grouped path sections, route index for routes. */
  groupIndex: number | null;
  /** Index of the point inside its group / route. */
  localIndex: number | null;
  /** Group colour, or null when the section is not group-coloured. */
  accent: string | null;
  issueLevel: 'error' | 'warning' | null;
  children: KmpOutlinerNode[];
  /** Lower-cased haystack for the search box. */
  searchText: string;
}

export interface BuildKmpOutlinerOptions {
  file: KmpFile | null;
  /** Resolves a GOBJ object id to its friendly name. */
  objectName: (objectId: number) => string;
  /** Validation issues; their `entityId` decorates the matching rows and their ancestors. */
  issues?: readonly TrackIssue[];
}

const ROUTE_UNUSED = KMP_NULL_INDEX_16;

function worseLevel(a: 'error' | 'warning' | null, b: 'error' | 'warning' | null): 'error' | 'warning' | null {
  if (a === 'error' || b === 'error') return 'error';
  if (a === 'warning' || b === 'warning') return 'warning';
  return null;
}

function makeNode(node: Omit<KmpOutlinerNode, 'searchText' | 'children' | 'entityIds' | 'count'> & Partial<Pick<KmpOutlinerNode, 'children' | 'entityIds' | 'count'>>): KmpOutlinerNode {
  const children = node.children ?? [];
  const entityIds = node.entityIds ?? (node.entityId ? [node.entityId] : children.flatMap((child) => child.entityIds));
  return {
    ...node,
    children,
    entityIds,
    count: node.count ?? entityIds.length,
    searchText: `${node.label} ${node.detail} ${node.entityId ?? ''}`.toLowerCase(),
  };
}

/** Rolls validation levels up from entity rows to their group and section rows. */
function propagateIssues(node: KmpOutlinerNode, levels: Map<string, 'error' | 'warning'>): KmpOutlinerNode {
  const children = node.children.map((child) => propagateIssues(child, levels));
  let level = node.entityId ? levels.get(node.entityId) ?? null : null;
  for (const child of children) level = worseLevel(level, child.issueLevel);
  return { ...node, children, issueLevel: level };
}

function fmtPos(position: { x: number; y: number; z: number }): string {
  return `${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`;
}

/**
 * "from 1, 3 · to 4". A KMP group record always has six link slots, most of them the 0xFF
 * "none" marker, so only the ones that name a real group are listed.
 */
function linkSummary(prev: number[], next: number[], groupCount: number): string {
  const real = (links: number[]) => links.filter((index) => Number.isInteger(index) && index >= 0 && index < groupCount);
  const label = (links: number[]) => (links.length > 0 ? links.map((index) => index + 1).join(', ') : 'none');
  return `from ${label(real(prev))} · to ${label(real(next))}`;
}

/** "3 points" / "1 point". */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function checkpointDetail(type: number, respawnIndex: number): string {
  const kind = type === 0 ? 'Lap counter' : type === KMP_NULL_INDEX_8 ? 'Normal' : `Key ${type}`;
  const respawn = respawnIndex === KMP_NULL_INDEX_8 ? 'no respawn' : `respawn ${respawnIndex + 1}`;
  return `${kind} · ${respawn}`;
}

function buildPathSection(
  meta: KmpOutlinerSectionMeta,
  groups: Array<{ start: number; length: number; prev: number[]; next: number[] }>,
  describePoint: (globalIndex: number, localIndex: number) => { label: string; detail: string },
): KmpOutlinerNode {
  const groupNodes = groups.map((group, groupIndex) => {
    const children: KmpOutlinerNode[] = [];
    for (let local = 0; local < group.length; local++) {
      const globalIndex = group.start + local;
      const described = describePoint(globalIndex, local);
      children.push(
        makeNode({
          id: `entity:${meta.entityPrefix}-${globalIndex}`,
          kind: 'entity',
          section: meta.key,
          label: described.label,
          detail: described.detail,
          entityId: `${meta.entityPrefix}-${globalIndex}`,
          groupIndex,
          localIndex: local,
          accent: pathGroupColor(groupIndex),
          issueLevel: null,
        }),
      );
    }
    return makeNode({
      id: `group:${meta.key}:${groupIndex}`,
      kind: 'group',
      section: meta.key,
      label: `Group ${groupIndex + 1}`,
      detail: `${plural(group.length, 'point')} · ${linkSummary(group.prev, group.next, groups.length)}`,
      entityId: null,
      groupIndex,
      localIndex: null,
      accent: pathGroupColor(groupIndex),
      issueLevel: null,
      children,
    });
  });
  return makeNode({
    id: `section:${meta.key}`,
    kind: 'section',
    section: meta.key,
    label: meta.label,
    detail: groupNodes.length > 0 ? plural(groupNodes.length, 'group') : '',
    entityId: null,
    groupIndex: null,
    localIndex: null,
    accent: null,
    issueLevel: null,
    children: groupNodes,
  });
}

function flatSection(
  meta: KmpOutlinerSectionMeta,
  records: Array<{ label: string; detail: string }>,
): KmpOutlinerNode {
  const children = records.map((record, index) =>
    makeNode({
      id: `entity:${meta.entityPrefix}-${index}`,
      kind: 'entity',
      section: meta.key,
      label: record.label,
      detail: record.detail,
      entityId: `${meta.entityPrefix}-${index}`,
      groupIndex: null,
      localIndex: index,
      accent: null,
      issueLevel: null,
    }),
  );
  return makeNode({
    id: `section:${meta.key}`,
    kind: 'section',
    section: meta.key,
    label: meta.label,
    detail: '',
    entityId: null,
    groupIndex: null,
    localIndex: null,
    accent: null,
    issueLevel: null,
    children,
  });
}

/** Builds the whole outliner tree. Returns one node per section, always in section order. */
export function buildKmpOutliner({ file, objectName, issues = [] }: BuildKmpOutlinerOptions): KmpOutlinerNode[] {
  const levels = new Map<string, 'error' | 'warning'>();
  for (const issue of issues) {
    if (!issue.entityId) continue;
    levels.set(issue.entityId, worseLevel(levels.get(issue.entityId) ?? null, issue.level) ?? issue.level);
  }

  const meta = (key: KmpOutlinerSectionKey) => KMP_OUTLINER_SECTIONS.find((section) => section.key === key)!;
  const sections: KmpOutlinerNode[] = [];

  if (!file) {
    for (const section of KMP_OUTLINER_SECTIONS) sections.push(flatSection(section, []));
    return sections;
  }

  sections.push(
    flatSection(
      meta('start'),
      file.startPoints.map((point, index) => ({
        label: point.playerIndex >= 0 ? `Start ${index + 1} (player ${point.playerIndex + 1})` : `Start ${index + 1}`,
        detail: fmtPos(point.position),
      })),
    ),
  );

  sections.push(
    buildPathSection(meta('enemy'), file.enemyGroups, (globalIndex, local) => {
      const point = file.enemyPoints[globalIndex];
      return {
        label: `Point ${local + 1}`,
        detail: point ? `${fmtPos(point.position)} · width ${Math.round(point.range)}` : '',
      };
    }),
  );

  sections.push(
    buildPathSection(meta('item'), file.itemGroups, (globalIndex, local) => {
      const point = file.itemPoints[globalIndex];
      return {
        label: `Point ${local + 1}`,
        detail: point ? `${fmtPos(point.position)} · width ${Math.round(point.range)}` : '',
      };
    }),
  );

  sections.push(
    buildPathSection(meta('checkpoint'), file.checkpointGroups, (globalIndex, local) => {
      const checkpoint = file.checkpoints[globalIndex];
      return {
        label: `Checkpoint ${local + 1}`,
        detail: checkpoint ? checkpointDetail(checkpoint.type, checkpoint.respawnIndex) : '',
      };
    }),
  );

  sections.push(
    flatSection(
      meta('respawn'),
      file.respawnPoints.map((point, index) => ({
        label: `Respawn ${index + 1}`,
        detail: fmtPos(point.position),
      })),
    ),
  );

  // Objects group by name so a track with 60 item boxes reads as one expandable row.
  const objectBuckets = new Map<string, Array<{ index: number; detail: string }>>();
  file.objects.forEach((object, index) => {
    const name = objectName(object.objectId);
    const bucket = objectBuckets.get(name) ?? [];
    bucket.push({
      index,
      detail: object.routeIndex !== ROUTE_UNUSED ? `${fmtPos(object.position)} · route ${object.routeIndex + 1}` : fmtPos(object.position),
    });
    objectBuckets.set(name, bucket);
  });
  const objectMeta = meta('object');
  const objectGroups = [...objectBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, entries]) =>
      makeNode({
        id: `group:object:${name.toLowerCase().replace(/\s+/g, '-')}`,
        kind: 'group',
        section: 'object',
        label: name,
        detail: plural(entries.length, 'placed'),
        entityId: null,
        groupIndex: null,
        localIndex: null,
        accent: null,
        issueLevel: null,
        // Numbered within their own kind: the fourth item box reads "Item Box 4", not
        // "Item Box 87" because it happens to be the 87th object record in the file.
        children: entries.map((entry, position) =>
          makeNode({
            id: `entity:GOBJ-${entry.index}`,
            kind: 'entity',
            section: 'object',
            label: `${name} ${position + 1}`,
            detail: entry.detail,
            entityId: `GOBJ-${entry.index}`,
            groupIndex: null,
            localIndex: entry.index,
            accent: null,
            issueLevel: null,
          }),
        ),
      }),
    );
  sections.push(
    makeNode({
      id: `section:${objectMeta.key}`,
      kind: 'section',
      section: 'object',
      label: objectMeta.label,
      detail: objectGroups.length > 0 ? plural(objectGroups.length, 'kind') : '',
      entityId: null,
      groupIndex: null,
      localIndex: null,
      accent: null,
      issueLevel: null,
      children: objectGroups,
    }),
  );

  const routeMeta = meta('route');
  const routeUse = describeRouteUsage(file);
  const routeGroups = file.routes.map((route, routeIndex) =>
    makeNode({
      id: `group:route:${routeIndex}`,
      kind: 'group',
      section: 'route',
      label: `Route ${routeIndex + 1}`,
      detail: `${plural(route.points.length, 'point')} · ${routeUse[routeIndex] ?? 'unused'}`,
      entityId: null,
      groupIndex: routeIndex,
      localIndex: null,
      accent: pathGroupColor(routeIndex),
      issueLevel: null,
      children: route.points.map((point, pointIndex) =>
        makeNode({
          id: `entity:POTI-${routeIndex}-${pointIndex}`,
          kind: 'entity',
          section: 'route',
          label: `Point ${pointIndex + 1}`,
          detail: `${fmtPos(point.position)} · speed ${point.setting1}`,
          entityId: `POTI-${routeIndex}-${pointIndex}`,
          groupIndex: routeIndex,
          localIndex: pointIndex,
          accent: pathGroupColor(routeIndex),
          issueLevel: null,
        }),
      ),
    }),
  );
  sections.push(
    makeNode({
      id: `section:${routeMeta.key}`,
      kind: 'section',
      section: 'route',
      label: routeMeta.label,
      detail: routeGroups.length > 0 ? plural(routeGroups.length, 'route') : '',
      entityId: null,
      groupIndex: null,
      localIndex: null,
      accent: null,
      issueLevel: null,
      children: routeGroups,
    }),
  );

  sections.push(
    flatSection(
      meta('area'),
      file.areas.map((area, index) => ({
        label: `${areaTypeName(area.type)} ${index + 1}`,
        detail: area.type === GRAVITY_AREA_TYPE
          ? `${gravityAreaDetail(area.routeIndex, area.enemyPointIndex, area.shape)} · priority ${area.priority}`
          : `${area.shape === 1 ? 'Cylinder' : 'Box'} · priority ${area.priority}`,
      })),
    ),
  );

  sections.push(
    flatSection(
      meta('camera'),
      file.cameras.map((camera, index) => ({
        label: `${cameraTypeName(camera.type)} ${index + 1}`,
        detail: `${camera.time / 60 >= 0.05 ? `${(camera.time / 60).toFixed(1)}s` : 'instant'}${camera.routeIndex !== KMP_NULL_INDEX_8 ? ` · route ${camera.routeIndex + 1}` : ''}`,
      })),
    ),
  );

  sections.push(
    flatSection(
      meta('cannon'),
      file.cannonPoints.map((point, index) => ({
        label: `Cannon ${index + 1}`,
        detail: fmtPos(point.position),
      })),
    ),
  );

  sections.push(
    flatSection(
      meta('battle'),
      file.battleFinishPoints.map((point, index) => ({
        label: `Finish point ${index + 1}`,
        detail: fmtPos(point.position),
      })),
    ),
  );

  const stage = file.stage[0];
  sections.push(
    makeNode({
      id: 'section:stage',
      kind: 'section',
      section: 'stage',
      label: 'Track settings',
      detail: stage ? `${plural(stage.lapCount, 'lap')} · pole ${stage.polePosition === 1 ? 'right' : 'left'}` : 'not set',
      entityId: 'STGI-0',
      entityIds: stage ? ['STGI-0'] : [],
      count: stage ? 1 : 0,
      groupIndex: null,
      localIndex: null,
      accent: null,
      issueLevel: null,
      children: [],
    }),
  );

  return sections.map((section) => propagateIssues(section, levels));
}

/** Short "used by …" text for each POTI route, so the Routes section is self-explanatory. */
export function describeRouteUsage(file: KmpFile): Record<number, string> {
  const usage: Record<number, string[]> = {};
  const add = (index: number, text: string) => {
    if (index === KMP_NULL_INDEX_8 || index === ROUTE_UNUSED || index < 0 || index >= file.routes.length) return;
    usage[index] = usage[index] ?? [];
    if (!usage[index].includes(text)) usage[index].push(text);
  };
  for (const object of file.objects) add(object.routeIndex, 'objects');
  for (const area of file.areas) add(area.routeIndex, 'areas');
  for (const camera of file.cameras) add(camera.routeIndex, 'cameras');
  const out: Record<number, string> = {};
  for (let index = 0; index < file.routes.length; index++) {
    out[index] = usage[index] ? `used by ${usage[index].join(' and ')}` : 'unused';
  }
  return out;
}

/**
 * Filters the tree to rows matching `query`. A section or group that matches keeps all of its
 * children; otherwise only matching descendants survive.
 */
export function filterKmpOutliner(sections: KmpOutlinerNode[], query: string): KmpOutlinerNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  const terms = needle.split(/\s+/);
  const matches = (node: KmpOutlinerNode) => terms.every((term) => node.searchText.includes(term));
  const walk = (node: KmpOutlinerNode): KmpOutlinerNode | null => {
    if (matches(node)) return node;
    const children = node.children.map(walk).filter((child): child is KmpOutlinerNode => child !== null);
    if (children.length === 0) return null;
    return { ...node, children };
  };
  return sections.map(walk).filter((node): node is KmpOutlinerNode => node !== null);
}

export interface KmpOutlinerRow {
  node: KmpOutlinerNode;
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

/** Depth-first list of the rows the panel should render, honouring the expanded set. */
export function flattenKmpOutliner(sections: KmpOutlinerNode[], expanded: ReadonlySet<string>): KmpOutlinerRow[] {
  const rows: KmpOutlinerRow[] = [];
  const walk = (node: KmpOutlinerNode, depth: number) => {
    const expandable = node.children.length > 0;
    const isExpanded = expandable && expanded.has(node.id);
    rows.push({ node, depth, expandable, expanded: isExpanded });
    if (!isExpanded) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const section of sections) walk(section, 0);
  return rows;
}

/** Node ids that must be open for `entityId` to be visible in the tree. */
export function expansionPathForEntity(sections: KmpOutlinerNode[], entityId: string): string[] {
  const path: string[] = [];
  const walk = (node: KmpOutlinerNode, trail: string[]): boolean => {
    if (node.entityId === entityId && node.kind === 'entity') {
      path.push(...trail);
      return true;
    }
    for (const child of node.children) {
      if (walk(child, [...trail, node.id])) return true;
    }
    return false;
  };
  for (const section of sections) walk(section, []);
  return path;
}

/** Entity ids covered by a shift-click from `anchorId` to `targetId` in the rendered rows. */
export function outlinerRangeSelection(rows: KmpOutlinerRow[], anchorId: string, targetId: string): string[] {
  const anchor = rows.findIndex((row) => row.node.id === anchorId);
  const target = rows.findIndex((row) => row.node.id === targetId);
  if (anchor < 0 || target < 0) return [];
  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
  const ids: string[] = [];
  for (let index = from; index <= to; index++) {
    for (const entityId of rows[index].node.entityIds) {
      if (!ids.includes(entityId)) ids.push(entityId);
    }
  }
  return ids;
}

/** Key-checkpoint ordering hints for the checkpoint rows, in flat checkpoint order. */
export interface KeyCheckpointHint {
  checkpointIndex: number;
  keyNumber: number;
  /** True when this key number breaks the ascending order along the path. */
  outOfOrder: boolean;
  duplicate: boolean;
}

export function computeKeyCheckpointHints(file: KmpFile | null): KeyCheckpointHint[] {
  if (!file || file.checkpoints.length === 0) return [];
  const graph = getCheckpointGraph(file);
  const validity = computeLapPathValidity(graph);
  const duplicates = new Set(validity.duplicateKeyCheckpoints);
  const hints: KeyCheckpointHint[] = [];
  let highestSoFar = -1;
  file.checkpoints.forEach((checkpoint, checkpointIndex) => {
    if (checkpoint.type === KMP_NULL_INDEX_8) return;
    const outOfOrder = checkpoint.type < highestSoFar;
    if (checkpoint.type > highestSoFar) highestSoFar = checkpoint.type;
    hints.push({ checkpointIndex, keyNumber: checkpoint.type, outOfOrder, duplicate: duplicates.has(checkpoint.type) });
  });
  return hints;
}

/**
 * `entityId -> friendly name`, taken straight from the tree, so the inspector, the status bar
 * and the outliner all call the same record the same thing.
 */
export function kmpOutlinerLabels(sections: KmpOutlinerNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  // Only a real group qualifies the name ("Group 2 · Point 3"). Sitting directly under a
  // section heading adds nothing, because the name already says what it is.
  const walk = (node: KmpOutlinerNode, groupLabel: string | null) => {
    if (node.kind === 'entity' && node.entityId) {
      // Object buckets are named after the object, and so are their children, so "Goomba ·
      // Goomba 1" would just stutter.
      const qualify = groupLabel !== null && !node.label.startsWith(groupLabel);
      labels.set(node.entityId, qualify ? `${groupLabel} · ${node.label}` : node.label);
    }
    for (const child of node.children) walk(child, node.kind === 'group' ? node.label : groupLabel);
  };
  for (const section of sections) walk(section, null);
  return labels;
}
