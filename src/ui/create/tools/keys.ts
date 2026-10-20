/** Create-mode key bindings (docs/CREATE.md 1.3) as a pure mapping, so they are unit tested. */
import { TOOL_ORDER, type ToolId, type ToolKey } from './types';

export type KeyAction =
  | { type: 'tool'; tool: ToolId }
  | { type: 'topView' }
  | { type: 'frame' }
  | { type: 'lane'; direction: 1 | -1 }
  | { type: 'brush'; direction: 1 | -1 }
  | { type: 'toolKey'; key: ToolKey }
  | { type: 'delete' };

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const TOOL_BY_LETTER: Record<string, ToolId> = { v: 'select', r: 'road', s: 'sections', p: 'pieces', b: 'paint', h: 'sculpt', d: 'scenery', g: 'start' };

/** True when the focused element is something the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // Checkboxes and buttons-as-inputs do not take typed letters.
    const type = (element as HTMLInputElement).type;
    return !(tag === 'INPUT' && (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'range'));
  }
  if (element.isContentEditable) return true;
  return !!element.closest?.('[role="dialog"], [role="menu"], [role="listbox"]');
}

/**
 * Maps a key press to a Create-mode action. Anything with Ctrl, Cmd or Alt held belongs to the
 * shell (undo, redo, copy...) and maps to nothing.
 */
export function mapKey(event: KeyLike, activeTool: ToolId): KeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const tool = TOOL_BY_LETTER[lower];
  if (tool && TOOL_ORDER.includes(tool)) return { type: 'tool', tool };
  switch (lower) {
    case 't':
      return { type: 'topView' };
    case 'f':
      return { type: 'frame' };
    case 'q':
      return activeTool === 'pieces' ? { type: 'lane', direction: -1 } : null;
    case 'e':
      return activeTool === 'pieces' ? { type: 'lane', direction: 1 } : null;
    case '[':
      return { type: 'brush', direction: -1 };
    case ']':
      return { type: 'brush', direction: 1 };
    case 'Enter':
    case 'Escape':
    case 'Backspace':
      return { type: 'toolKey', key: lower as ToolKey };
    case 'Delete':
      return { type: 'delete' };
    default:
      return null;
  }
}

/** The brush a `[` / `]` press resizes for a tool, or null when the tool has none. */
export function brushKeyFor(tool: ToolId): 'paintRadius' | 'sculptRadius' | 'sceneryRadius' | null {
  if (tool === 'paint') return 'paintRadius';
  if (tool === 'sculpt') return 'sculptRadius';
  if (tool === 'scenery') return 'sceneryRadius';
  return null;
}

export function resizeBrush(radius: number, direction: 1 | -1, min: number, max: number): number {
  const next = Math.round(radius * (direction > 0 ? 1.25 : 0.8));
  return Math.max(min, Math.min(max, next));
}
