import { X } from 'lucide-react';
import { useEffect } from 'react';
import { IconButton, Kbd } from '../components';

/** The graph's controls, in the order someone new to it needs them. */
const GRAPH_CONTROLS: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: 'Right-drag', does: 'Pan (middle-drag too)' },
  { keys: 'Scroll', does: 'Zoom about the cursor' },
  { keys: 'Two-finger scroll', does: 'Pan, on a trackpad; pinch zooms' },
  { keys: 'Right-click', does: 'Add a node here (or a node\'s own menu)' },
  { keys: 'Drag from a pin', does: 'Wire it; let go on empty grid to add a node already wired' },
  { keys: 'Left-drag on grid', does: 'Box-select; Shift or Ctrl adds' },
  { keys: 'Alt+click a pin', does: 'Break its wires' },
  { keys: 'F / Home', does: 'Frame the selection / everything' },
  { keys: 'Ctrl+D', does: 'Duplicate' },
  { keys: 'Ctrl+C / Ctrl+V', does: 'Copy / paste at the cursor' },
  { keys: 'Delete', does: 'Delete the selected nodes or wire' },
  { keys: 'Ctrl+Z / Ctrl+Y', does: 'Undo / redo' },
];

const TIPS: readonly string[] = [
  'An input with nothing wired into it holds a value right on the node — the little 0 / ½ / 1 switch. Wire something in and the switch goes away.',
  'Each maths node is one step of the Wii\'s colour combiner (its "TEV"): every step mixes up to four inputs, and a material can have up to 16 steps. The status line says how many this graph uses.',
  'Colour and alpha are worked out side by side. Blue pins carry colour, grey pins alpha; "Alpha as colour" is the one bridge from alpha to colour.',
  'Click a node to see all of its settings in the Details panel on the right.',
  'Lost? "Start from…" swaps in a ready-made shader, and Reset rebuilds the graph from what the material had.',
];

/**
 * The "?" card over the graph: the controls, then a handful of tips in plain words. It sits over
 * the canvas but is not part of it, so the wheel scrolls the card rather than zooming the graph.
 */
export function GraphHelpCard({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside className="graphHelp" role="dialog" aria-label="Graph controls and tips" data-graph-overlay>
      <header className="graphHelpHeader">
        <strong>Controls</strong>
        <IconButton size="sm" variant="ghost" icon={<X size={13} />} tooltip="Close" onClick={onClose} />
      </header>
      <dl className="graphHelpControls">
        {GRAPH_CONTROLS.map((entry) => (
          <div key={entry.keys}>
            <dt><Kbd>{entry.keys}</Kbd></dt>
            <dd>{entry.does}</dd>
          </div>
        ))}
      </dl>
      <strong className="graphHelpTitle">Tips</strong>
      <ul className="graphHelpTips">
        {TIPS.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </aside>
  );
}
