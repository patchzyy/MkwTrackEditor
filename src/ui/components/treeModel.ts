/**
 * Pure tree maths behind `TreeView`: flattening, windowing for virtualisation and keyboard
 * focus movement. No DOM, no React — unit tested in `treeModel.test.ts`.
 */

import type { ReactNode } from 'react';

export interface TreeNode<T = unknown> {
  id: string;
  label: string;
  /** Optional second line / right-aligned hint. */
  detail?: string;
  icon?: ReactNode;
  children?: TreeNode<T>[];
  /** Greys the row out and skips it during keyboard navigation. */
  disabled?: boolean;
  /** Renders the eye / checkbox column when the tree was given a `column` mode. */
  checked?: boolean;
  data?: T;
}

export interface FlatTreeRow<T = unknown> {
  node: TreeNode<T>;
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  /** Index in the flattened list. */
  index: number;
}

/** Depth-first walk that only descends into expanded nodes. */
export function flattenTree<T>(nodes: readonly TreeNode<T>[], expandedIds: ReadonlySet<string>): FlatTreeRow<T>[] {
  const rows: FlatTreeRow<T>[] = [];
  const walk = (list: readonly TreeNode<T>[], depth: number, parentId: string | null) => {
    for (const node of list) {
      const hasChildren = (node.children?.length ?? 0) > 0;
      const expanded = hasChildren && expandedIds.has(node.id);
      rows.push({ node, id: node.id, depth, hasChildren, expanded, parentId, index: rows.length });
      if (expanded && node.children) walk(node.children, depth + 1, node.id);
    }
  };
  walk(nodes, 0, null);
  return rows;
}

/** Every descendant id of `node`, excluding `node` itself. */
export function collectDescendantIds<T>(node: TreeNode<T>): string[] {
  const ids: string[] = [];
  const walk = (list: readonly TreeNode<T>[]) => {
    for (const child of list) {
      ids.push(child.id);
      if (child.children) walk(child.children);
    }
  };
  if (node.children) walk(node.children);
  return ids;
}

/** Ids of every node that has children, i.e. "expand all". */
export function collectExpandableIds<T>(nodes: readonly TreeNode<T>[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly TreeNode<T>[]) => {
    for (const node of list) {
      if (node.children?.length) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/** Ids of every ancestor of `targetId`, root first. Empty when the id is not in the tree. */
export function ancestorIds<T>(nodes: readonly TreeNode<T>[], targetId: string): string[] {
  const path: string[] = [];
  const walk = (list: readonly TreeNode<T>[], trail: string[]): boolean => {
    for (const node of list) {
      if (node.id === targetId) {
        path.push(...trail);
        return true;
      }
      if (node.children && walk(node.children, [...trail, node.id])) return true;
    }
    return false;
  };
  walk(nodes, []);
  return path;
}

export interface TreeWindow {
  /** First row index to render. */
  start: number;
  /** One past the last row index to render. */
  end: number;
  /** Pixel offset of the first rendered row from the top of the scrollable content. */
  offsetY: number;
  /** Full scroll height so the scrollbar stays honest. */
  totalHeight: number;
}

/**
 * Which slice of a fixed-row-height list is worth rendering. Keeps 1000-row trees at a few
 * dozen DOM nodes.
 */
export function computeTreeWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): TreeWindow {
  const safeRowHeight = rowHeight > 0 ? rowHeight : 1;
  const totalHeight = rowCount * safeRowHeight;
  if (rowCount === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };
  const clampedScroll = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight)));
  const firstVisible = Math.floor(clampedScroll / safeRowHeight);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / safeRowHeight) + 1;
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rowCount, firstVisible + visibleCount + overscan);
  return { start, end, offsetY: start * safeRowHeight, totalHeight };
}

export interface TreeKeyResult {
  /** Row to focus after the key press. */
  focusId?: string;
  /** Node to expand. */
  expandId?: string;
  /** Node to collapse. */
  collapseId?: string;
  /** The key activated the row (Enter/Space). */
  activateId?: string;
  /** The key toggled the checkbox/eye column. */
  toggleId?: string;
}

/**
 * Standard tree keyboard model (WAI-ARIA): up/down move, right expands then descends, left
 * collapses then goes to the parent, Home/End jump, Enter/Space activate.
 * Returns `null` when the key is not handled so the caller can let it bubble.
 */
export function handleTreeKey<T>(rows: readonly FlatTreeRow<T>[], focusedId: string | null, key: string): TreeKeyResult | null {
  if (rows.length === 0) return null;
  const enabled = rows.filter((row) => !row.node.disabled);
  if (enabled.length === 0) return null;
  const current = rows.find((row) => row.id === focusedId) ?? null;
  const enabledIndex = current ? enabled.findIndex((row) => row.id === current.id) : -1;

  switch (key) {
    case 'ArrowDown': {
      const next = enabled[Math.min(enabled.length - 1, enabledIndex + 1)] ?? enabled[0];
      return { focusId: next.id };
    }
    case 'ArrowUp': {
      const next = enabledIndex <= 0 ? enabled[0] : enabled[enabledIndex - 1];
      return { focusId: next.id };
    }
    case 'Home':
      return { focusId: enabled[0].id };
    case 'End':
      return { focusId: enabled[enabled.length - 1].id };
    case 'ArrowRight': {
      if (!current) return { focusId: enabled[0].id };
      if (current.hasChildren && !current.expanded) return { expandId: current.id };
      if (current.hasChildren && current.expanded) {
        const child = rows[current.index + 1];
        return child ? { focusId: child.id } : null;
      }
      return null;
    }
    case 'ArrowLeft': {
      if (!current) return { focusId: enabled[0].id };
      if (current.hasChildren && current.expanded) return { collapseId: current.id };
      if (current.parentId) return { focusId: current.parentId };
      return null;
    }
    case 'Enter':
      return current ? { activateId: current.id } : null;
    case ' ':
    case 'Spacebar':
      return current ? { toggleId: current.id } : null;
    default:
      return null;
  }
}
