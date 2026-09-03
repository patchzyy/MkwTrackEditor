/**
 * What the KMP tool panel can do with the current selection.
 *
 * Pure, so the enable/disable rules behind every button (and the reason a button is off) can be
 * unit tested without rendering anything.
 */

import { KMP_NULL_INDEX_8, type KmpFile } from '../../lib/kmpFile';
import { MAX_GROUP_LINKS, pathGroups, type PathPointSection } from '../../lib/kmpGraph';

export interface PathSelectionContext {
  section: PathPointSection;
  /** "enemy route" / "item route" / "checkpoint path". */
  pathLabel: string;
  /** "enemy route point" / "item route point" / "checkpoint". */
  pointLabel: string;
  /** Index of the point inside the whole section. */
  globalIndex: number;
  groupIndex: number;
  localIndex: number;
  groupCount: number;
  groupSize: number;
  prevGroups: number[];
  nextGroups: number[];
  /** Splitting needs a point that is neither the first nor the only one in its group. */
  canSplit: boolean;
  /** Merging needs exactly one next group, which must have exactly this group as its only prev. */
  canMerge: boolean;
  /** A group can take another outgoing link only while it is under the game's limit of six. */
  canLink: boolean;
}

export interface CheckpointSelectionContext {
  index: number;
  /** `lap` = the single lap counter, `key` = a numbered key checkpoint, `normal` = neither. */
  kind: 'lap' | 'key' | 'normal';
  keyNumber: number | null;
  respawnIndex: number | null;
  respawnCount: number;
}

export interface RouteSelectionContext {
  routeIndex: number;
  pointIndex: number;
  pointCount: number;
}

export interface KmpSelectionContext {
  path: PathSelectionContext | null;
  checkpoint: CheckpointSelectionContext | null;
  route: RouteSelectionContext | null;
}

const PATH_LABELS: Record<PathPointSection, { path: string; point: string }> = {
  ENPT: { path: 'enemy route', point: 'enemy route point' },
  ITPT: { path: 'item route', point: 'item route point' },
  CKPT: { path: 'checkpoint path', point: 'checkpoint' },
};

function isPathSection(value: string): value is PathPointSection {
  return value === 'ENPT' || value === 'ITPT' || value === 'CKPT';
}

/** Reads the selected entity id against the file and reports what applies to it. */
export function getKmpSelectionContext(file: KmpFile | null, entityId: string | null): KmpSelectionContext {
  const empty: KmpSelectionContext = { path: null, checkpoint: null, route: null };
  if (!file || !entityId) return empty;
  const parts = entityId.split('-');
  const prefix = parts[0];
  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0) return empty;

  if (prefix === 'POTI') {
    const pointIndex = Number(parts[2]);
    const route = file.routes[index];
    if (!route || !Number.isInteger(pointIndex)) return empty;
    return { ...empty, route: { routeIndex: index, pointIndex, pointCount: route.points.length } };
  }

  if (!isPathSection(prefix)) return empty;
  const groups = pathGroups(file, prefix);
  const groupIndex = groups.findIndex((group) => index >= group.start && index < group.start + group.length);
  if (groupIndex < 0) return empty;
  const group = groups[groupIndex];
  const localIndex = index - group.start;

  // Merging is only safe when the next group is a plain continuation: one way out of this
  // group, and this group is the only way into that one.
  const nextGroups = group.next.filter((value) => value >= 0 && value < groups.length);
  const prevGroups = group.prev.filter((value) => value >= 0 && value < groups.length);
  const onlyNext = nextGroups.length === 1 ? nextGroups[0] : null;
  const canMerge =
    onlyNext !== null &&
    onlyNext !== groupIndex &&
    groups[onlyNext] !== undefined &&
    groups[onlyNext].prev.filter((value) => value >= 0 && value < groups.length).join() === String(groupIndex);

  const path: PathSelectionContext = {
    section: prefix,
    pathLabel: PATH_LABELS[prefix].path,
    pointLabel: PATH_LABELS[prefix].point,
    globalIndex: index,
    groupIndex,
    localIndex,
    groupCount: groups.length,
    groupSize: group.length,
    prevGroups,
    nextGroups,
    canSplit: localIndex > 0 && localIndex < group.length,
    canMerge,
    canLink: nextGroups.length < MAX_GROUP_LINKS,
  };

  if (prefix !== 'CKPT') return { ...empty, path };

  const checkpoint = file.checkpoints[index];
  if (!checkpoint) return { ...empty, path };
  return {
    path,
    route: null,
    checkpoint: {
      index,
      kind: checkpoint.type === 0 ? 'lap' : checkpoint.type === KMP_NULL_INDEX_8 ? 'normal' : 'key',
      keyNumber: checkpoint.type === 0 || checkpoint.type === KMP_NULL_INDEX_8 ? null : checkpoint.type,
      respawnIndex: checkpoint.respawnIndex === KMP_NULL_INDEX_8 ? null : checkpoint.respawnIndex,
      respawnCount: file.respawnPoints.length,
    },
  };
}

/** Groups the selected entity ids by their section prefix, for the batch tools. */
export function summarizeSelection(entityIds: readonly string[]): { total: number; sections: string[]; allSameSection: boolean } {
  const sections: string[] = [];
  for (const id of entityIds) {
    const prefix = id.split('-')[0];
    if (!sections.includes(prefix)) sections.push(prefix);
  }
  return { total: entityIds.length, sections, allSameSection: sections.length === 1 };
}
