import { useState } from 'react';
import { GripVertical, Play, TriangleAlert, X } from 'lucide-react';
import { formatFrames, getCameraTypeInfo } from '../../lib/cameraPreview';
import { reorderChain, type CameraChainInfo, type CameraChainKind, type CameraRow } from './cameraDocument';

export interface ChainEditorProps {
  kind: CameraChainKind;
  title: string;
  /** One line explaining when the game plays this chain. */
  description: string;
  chain: CameraChainInfo;
  rows: CameraRow[];
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (index: number) => void;
  onPlay: () => void;
  /** Rewrites the hand-over links so the chain plays in this order. */
  onReorder: (order: number[]) => void;
  /** Detaches a camera from the chain. */
  onRemove: (index: number) => void;
}

/**
 * The ordered play list of one camera chain. Dragging a row rewrites the hand-over links, so the
 * user never has to think in "next camera" indices.
 */
export function ChainEditor({ kind, title, description, chain, rows, selectedId, canEdit, onSelect, onPlay, onReorder, onRemove }: ChainEditorProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const byIndex = new Map(rows.map((row) => [row.index, row]));

  function handleDrop(to: number) {
    const from = dragFrom;
    setDragFrom(null);
    setDragOver(null);
    if (from === null || from === to) return;
    onReorder(reorderChain(chain.order, from, to));
  }

  return (
    <section className={`cameraChain cameraChain-${kind}`}>
      <header className="cameraChainHeader">
        <div>
          <strong>{title}</strong>
          <p className="panelSubtle">{description}</p>
        </div>
        <button type="button" className="iconButton" onClick={onPlay} disabled={chain.order.length === 0} title={`Play the ${title.toLowerCase()}`}>
          <Play size={14} />
        </button>
      </header>

      {chain.order.length === 0 ? (
        <p className="cameraChainEmpty">
          {chain.missingAt !== null
            ? `This pan starts at camera ${chain.missingAt}, which does not exist.`
            : 'Nothing plays here yet. Select a camera and use the "set as start" button above.'}
        </p>
      ) : (
        <ol className="cameraChainList">
          {chain.order.map((cameraIndex, position) => {
            const row = byIndex.get(cameraIndex);
            const step = chain.steps[position];
            const id = `CAME-${cameraIndex}`;
            return (
              <li
                key={cameraIndex}
                className={[
                  'cameraChainItem',
                  id === selectedId ? 'isSelected' : '',
                  dragOver === position && dragFrom !== null && dragFrom !== position ? 'isDropTarget' : '',
                  chain.zeroDurationAt.includes(cameraIndex) ? 'hasWarning' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={canEdit}
                onDragStart={(event) => {
                  setDragFrom(position);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox needs some payload before it starts a drag.
                  event.dataTransfer.setData('text/plain', String(cameraIndex));
                }}
                onDragOver={(event) => {
                  if (dragFrom === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOver(position);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(position);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <span className="cameraChainGrip" aria-hidden="true">
                  <GripVertical size={13} />
                </span>
                <button type="button" className="cameraChainButton" onClick={() => onSelect(cameraIndex)} title="Select this camera">
                  <span className="cameraChainOrder">{position + 1}</span>
                  <span className="cameraChainName">
                    Camera {cameraIndex}
                    <span className="cameraChainType">{getCameraTypeInfo(row?.type ?? 0).label}</span>
                  </span>
                  <span className="cameraChainTime">{step ? `${Math.round(step.durationFrames)}f` : ''}</span>
                </button>
                <button type="button" className="iconButton cameraChainRemove" disabled={!canEdit} onClick={() => onRemove(cameraIndex)} title="Take this camera out of the pan">
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {chain.order.length > 0 && <p className="cameraChainTotal">Total: {formatFrames(chain.totalFrames)}</p>}
      {chain.warnings.map((warning) => (
        <p key={warning} className="cameraChainWarning">
          <TriangleAlert size={13} />
          {warning}
        </p>
      ))}
    </section>
  );
}
