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
      { keys: 'Ctrl+S', description: 'Export the track' },
      { keys: 'Ctrl+Z', description: 'Undo' },
      { keys: 'Ctrl+Shift+Z', description: 'Redo' },
      { keys: 'Ctrl+Y', description: 'Redo (alternative)' },
    ],
  },
  {
    title: 'Selection',
    entries: [
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
    title: 'Model mode',
    entries: [
      { keys: '[', description: 'Narrow the mesh selection' },
      { keys: ']', description: 'Widen the mesh selection' },
    ],
  },
  {
    title: 'Shader graph',
    entries: [
      { keys: 'Double-click', description: 'Open the add-node palette on empty space' },
      { keys: 'Right-click', description: 'Open the add-node palette' },
      { keys: 'Middle-drag', description: 'Pan the graph' },
      { keys: 'Space+Drag', description: 'Pan the graph' },
      { keys: 'Wheel', description: 'Zoom about the cursor' },
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
