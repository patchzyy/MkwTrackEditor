import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { IconButton } from './Button';
import { KbdSequence } from './Tooltip';

export interface ShortcutEntry {
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/** The editor's global keyboard map, as shown by the `?` overlay. */
export const EDITOR_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'File',
    entries: [
      { keys: 'Ctrl+O', description: 'Open a track' },
      { keys: 'Ctrl+S', description: 'Export the track' },
      { keys: 'Ctrl+Alt+R', description: 'Refresh the viewport from your edits' },
      { keys: 'Ctrl+Z', description: 'Undo' },
      { keys: 'Ctrl+Shift+Z', description: 'Redo' },
      { keys: 'Ctrl+Y', description: 'Redo (alternative)' },
    ],
  },
  {
    title: 'Selection',
    entries: [
      { keys: 'A', description: 'Select every point in the active KMP section' },
      { keys: 'Click', description: 'Select what is under the cursor' },
      { keys: 'Ctrl+Click', description: 'Add to or remove from the selection' },
      { keys: 'Drag', description: 'Marquee-select in the viewport' },
      { keys: 'Ctrl+C', description: 'Copy the selection' },
      { keys: 'Ctrl+V', description: 'Paste' },
      { keys: 'Ctrl+D', description: 'Duplicate the selection' },
      { keys: 'Delete', description: 'Delete the selection' },
    ],
  },
  {
    title: 'Transform',
    entries: [
      { keys: 'W', description: 'Move tool' },
      { keys: 'E', description: 'Rotate tool' },
      { keys: 'R', description: 'Scale tool' },
      { keys: 'F', description: 'Frame the selection' },
      { keys: 'Drag', description: 'Scrub any number field left or right' },
      { keys: 'Shift+Drag', description: 'Scrub in fine steps' },
      { keys: 'Ctrl+Drag', description: 'Scrub in coarse steps' },
    ],
  },
  {
    title: 'Create mode',
    entries: [
      { keys: 'F5', description: 'Test drive your track from the start line (Ctrl+Enter too)' },
      { keys: 'Ctrl+Z', description: 'Undo the last change to your design' },
      { keys: 'Ctrl+Shift+Z', description: 'Redo it (Ctrl+Y too)' },
      { keys: 'Delete', description: 'Remove what is selected' },
      { keys: 'Esc', description: 'Leave a test drive and come back to building' },
      { keys: 'V', description: 'Select tool: click and drag things; Shift-drag a road point to raise it' },
      { keys: 'R', description: 'Road tool: click the ground to draw; click the first point to close the loop' },
      { keys: 'S', description: 'Sections tool: click the road to split it, drag an edge to move it' },
      { keys: 'P', description: 'Pieces tool: place boosts, ramps, item boxes and hazards (Q / E change lane)' },
      { keys: 'B', description: 'Paint tool: paint ground surfaces (Shift erases)' },
      { keys: 'H', description: 'Sculpt tool: raise ground (Shift lowers, Ctrl smooths)' },
      { keys: 'D', description: 'Scenery tool: click to place, drag to scatter, Shift-drag to erase' },
      { keys: 'G', description: 'Start tool: click the main road to move the start line' },
      { keys: 'T', description: 'Top view for planning (toggle)' },
      { keys: 'F', description: 'Frame the selection, or the whole track' },
      { keys: '[ ]', description: 'Smaller / larger brush' },
      { keys: 'Enter', description: 'Finish drawing the road' },
    ],
  },
  {
    title: 'Model mode',
    entries: [
      { keys: '[', description: 'Narrow the mesh selection' },
      { keys: ']', description: 'Widen the mesh selection' },
    ],
  },
  {
    title: 'Blender viewport presets (Controls menu)',
    entries: [
      { keys: 'Right-click', description: 'Select in Blender 2.7; modern Blender uses left-click' },
      { keys: 'MMB', description: 'Orbit around the view pivot' },
      { keys: 'Shift+MMB', description: 'Pan the view' },
      { keys: 'Ctrl+MMB', description: 'Zoom (or use the mouse wheel)' },
      { keys: 'Numpad 1 / 3 / 7', description: 'Front / right / top view; Ctrl shows the opposite' },
      { keys: 'Numpad 5', description: 'Toggle perspective / orthographic projection' },
      { keys: 'Numpad 2 / 4 / 6 / 8', description: 'Orbit in 15° steps; Ctrl or Shift pans' },
      { keys: 'Numpad 9', description: 'View from the opposite side' },
      { keys: 'Numpad + / −', description: 'Zoom in / out' },
      { keys: 'Numpad .', description: 'Frame the selection and set the orbit pivot' },
      { keys: 'Home', description: 'Frame the whole track' },
    ],
  },
  {
    title: 'Shader graph',
    entries: [
      { keys: 'Right-drag', description: 'Pan the graph (middle-drag and Space+Drag too)' },
      { keys: 'Right-click', description: 'Add a node, or a node/wire menu over one' },
      { keys: 'Double-click', description: 'Open the add-node menu on empty space' },
      { keys: 'Wheel', description: 'Zoom about the cursor (trackpad scroll pans, pinch zooms)' },
      { keys: 'Drag', description: 'Marquee-select on empty space' },
      { keys: 'F', description: 'Frame the selection, or everything' },
      { keys: 'Home', description: 'Frame the whole graph' },
      { keys: 'Alt+Click', description: 'Break the wires on a pin' },
      { keys: 'Shift+Click', description: 'Add a node to the selection' },
      { keys: 'Ctrl+Drag', description: 'Snap moved nodes to the grid' },
      { keys: 'Ctrl+A', description: 'Select every node' },
      { keys: 'Ctrl+D', description: 'Duplicate the selected nodes' },
      { keys: 'Ctrl+C', description: 'Copy the selected nodes as JSON' },
      { keys: 'Ctrl+V', description: 'Paste nodes' },
      { keys: 'Ctrl+Z', description: 'Undo a graph change' },
      { keys: 'Ctrl+Y', description: 'Redo a graph change' },
      { keys: 'Delete', description: 'Delete the selected nodes or wire' },
    ],
  },
  {
    title: 'Interface',
    entries: [
      { keys: '?', description: 'Show or hide this sheet' },
      { keys: 'Esc', description: 'Close menus and popovers' },
      { keys: 'Double-click', description: 'Reset a dock handle to its default size' },
    ],
  },
];

/** Modal sheet listing every keyboard shortcut. Focus is trapped until it is closed. */
export function ShortcutOverlay({ open, onClose, groups = EDITOR_SHORTCUTS }: { open: boolean; onClose: () => void; groups?: ShortcutGroup[] }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="uiShortcutScrim" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="uiShortcutSheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="uiShortcutHeader">
          <h2>Keyboard shortcuts</h2>
          <IconButton ref={closeRef} icon={<X size={15} />} tooltip="Close" variant="ghost" onClick={onClose} />
        </header>
        <div className="uiShortcutColumns">
          {groups.map((group) => (
            <section className="uiShortcutGroup" key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.entries.map((entry) => (
                  <div className="uiShortcutRow" key={`${group.title}-${entry.keys}-${entry.description}`}>
                    <dt>
                      <KbdSequence shortcut={entry.keys} />
                    </dt>
                    <dd>{entry.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
