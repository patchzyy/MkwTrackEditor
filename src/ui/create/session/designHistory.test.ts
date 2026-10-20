import { describe, expect, it } from 'vitest';
import type { CreateProject } from '../../../lib/create/types';
import {
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commitEdit,
  createDesignHistory,
  DESIGN_HISTORY_LIMIT,
  endGesture,
  redo,
  redoLabel,
  undo,
  undoLabel,
  updateGesture,
} from './designHistory';

const design = (name: string): CreateProject => ({ name }) as unknown as CreateProject;
const name = (h: { present: CreateProject }) => h.present.name;

describe('designHistory', () => {
  it('records labelled steps and walks back and forth', () => {
    let h = createDesignHistory(design('a'));
    expect(canUndo(h)).toBe(false);
    h = commitEdit(h, design('b'), 'Add point');
    h = commitEdit(h, design('c'), 'Move point');
    expect(undoLabel(h)).toBe('Move point');
    h = undo(h);
    expect(name(h)).toBe('b');
    expect(undoLabel(h)).toBe('Add point');
    expect(redoLabel(h)).toBe('Move point');
    h = undo(h);
    expect(name(h)).toBe('a');
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(name(h)).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('clears the redo stack on a new edit', () => {
    let h = createDesignHistory(design('a'));
    h = commitEdit(h, design('b'), 'x');
    h = undo(h);
    h = commitEdit(h, design('c'), 'y');
    expect(canRedo(h)).toBe(false);
    expect(name(h)).toBe('c');
  });

  it('ignores an edit that returns the same design', () => {
    const a = design('a');
    let h = createDesignHistory(a);
    h = commitEdit(h, a, 'nothing');
    expect(canUndo(h)).toBe(false);
  });

  it('coalesces a gesture into one step', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Move road point');
    for (let i = 1; i <= 30; i++) h = updateGesture(h, () => design(`drag${i}`));
    expect(name(h)).toBe('drag30');
    expect(h.past).toHaveLength(0);
    h = endGesture(h);
    expect(h.past).toHaveLength(1);
    expect(h.gesture).toBeNull();
    expect(undoLabel(h)).toBe('Move road point');
    h = undo(h);
    expect(name(h)).toBe('a');
    h = redo(h);
    expect(name(h)).toBe('drag30');
  });

  it('derives every update from the design at begin', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Paint');
    h = updateGesture(h, (base) => design(`${base.name}1`));
    h = updateGesture(h, (base) => design(`${base.name}2`));
    expect(name(h)).toBe('a2');
  });

  it('cancel restores the design from before the gesture', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Move');
    h = updateGesture(h, () => design('b'));
    h = cancelGesture(h);
    expect(name(h)).toBe('a');
    expect(canUndo(h)).toBe(false);
    expect(h.gesture).toBeNull();
  });

  it('records nothing for a gesture that changed nothing', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Move');
    h = endGesture(h);
    expect(canUndo(h)).toBe(false);
  });

  it('an edit during a gesture ends the gesture first', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Move');
    h = updateGesture(h, () => design('b'));
    h = commitEdit(h, design('c'), 'Delete');
    expect(h.past.map((e) => e.label)).toEqual(['Move', 'Delete']);
    h = undo(h);
    expect(name(h)).toBe('b');
  });

  it('undo while dragging settles the drag, then undoes it', () => {
    let h = createDesignHistory(design('a'));
    h = beginGesture(h, 'Move');
    h = updateGesture(h, () => design('b'));
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(name(h)).toBe('a');
    expect(h.gesture).toBeNull();
  });

  it('keeps at most the limit', () => {
    let h = createDesignHistory(design('0'));
    for (let i = 1; i <= DESIGN_HISTORY_LIMIT + 50; i++) h = commitEdit(h, design(String(i)), `s${i}`);
    expect(h.past).toHaveLength(DESIGN_HISTORY_LIMIT);
    // The oldest steps fell off; the newest is still undoable.
    expect(undoLabel(h)).toBe(`s${DESIGN_HISTORY_LIMIT + 50}`);
  });

  it('undo with nothing to undo is a no-op', () => {
    const h = createDesignHistory(design('a'));
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
