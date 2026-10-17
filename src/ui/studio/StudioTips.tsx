import { Lightbulb, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Kbd } from '../components';

/**
 * The studio's getting-started card: what the three columns are and the handful of moves that
 * make the editor useful, each in one line. It is reached from **Tips** in the header, so it is
 * there when somebody wants it and never in the way when they do not.
 *
 * The node graph's own controls (adding, wiring, deleting nodes) are explained by the graph dock,
 * so they are only pointed at here, not repeated.
 */
export function StudioTips({ onClose }: { onClose: () => void }) {
  return (
    <div className="studioTips" role="dialog" aria-label="Model Studio tips">
      <header className="studioTipsHeader">
        <Lightbulb size={15} aria-hidden="true" />
        <strong>Getting around the Model Studio</strong>
        <IconButton size="sm" variant="ghost" icon={<X size={13} />} tooltip="Close the tips" tooltipSide="left" onClick={onClose} />
      </header>

      <div className="studioTipsBody">
        <section>
          <h3>The layout</h3>
          <ul>
            <Tip title="Outliner (left)">Every model, material, texture and animation in the file. The eye hides a model; the play button runs an animation.</Tip>
            <Tip title="Preview and graph (centre)">The model and its animation timeline on top, the material's shader graph below. Drag the bar between them to give either more room.</Tip>
            <Tip title="Details (right)">Whatever is selected: the whole material, or the one node you clicked in the graph.</Tip>
          </ul>
        </section>

        <section>
          <h3>Editing</h3>
          <ul>
            <Tip title="Pick a material">Click the model in the preview, or a material in the outliner.</Tip>
            <Tip title="Edit a texture">Click its node in the graph, or its row under Textures in Details, for tiling, scale, smoothing and more.</Tip>
            <Tip title="Replace a texture">Drop a PNG onto the texture's Details, or press Replace… to pick one. Save PNG gets the current one out.</Tip>
            <Tip title="Lost in the graph?">Start from… swaps in a ready-made shader; Reset rebuilds the graph from the material as it is. The graph's own ? button lists its controls.</Tip>
            <Tip title="Undo anything">
              <Kbd>Ctrl</Kbd> <Kbd>Z</Kbd> undoes, <Kbd>Ctrl</Kbd> <Kbd>Y</Kbd> redoes.
            </Tip>
          </ul>
        </section>

        <section>
          <h3>The preview</h3>
          <ul>
            <Tip title="Move around">Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom, <Kbd>F</Kbd> to frame the selection.</Tip>
            <Tip title="Animations">Press play on an animation in the outliner; the timeline under the preview scrubs, steps and loops it.</Tip>
            <Tip title="See it plainly">The switches over the preview turn textures, lighting, vertex colours and wireframe on and off. They only change the preview.</Tip>
          </ul>
        </section>

        <section>
          <h3>Keeping your work</h3>
          <ul>
            <Tip title="Export">Downloads the whole file with your edits. Untouched, it is byte for byte what was opened.</Tip>
            <Tip title="Save to My Assets">Keeps the model in the content browser, ready to place in a track.</Tip>
            <Tip title="From a track">A model opened from Model or Material mode writes every edit straight back into the track.</Tip>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <strong>{title}</strong>
      <span>{children}</span>
    </li>
  );
}
