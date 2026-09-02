import { ChevronUp } from 'lucide-react';

export function FillBetweenPanel({
  objectLabel,
  count,
  onChangeCount,
  onApply,
  onClose,
}: {
  objectLabel: string;
  count: number;
  onChangeCount: (value: number) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="viewportOverlayPanel">
      <div className="viewportOverlayHeader">
        <strong>Fill Between</strong>
        <button className="iconButton" type="button" onClick={onClose} aria-label="Close fill between" title="Close fill between">
          <ChevronUp size={16} />
        </button>
      </div>
      <span className="viewportOverlayDetail">{objectLabel}</span>
      <label className="viewportOverlayField">
        In-between Count
        <input
          type="number"
          min="1"
          max="255"
          value={count}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChangeCount(Math.max(1, Math.min(255, Math.trunc(next))));
          }}
        />
      </label>
      <div className="viewportOverlayActions">
        <button className="inlineAction" type="button" onClick={onApply}>
          Apply
        </button>
      </div>
      <span className="viewportOverlayHint">Select two matching objects, press Ctrl/Cmd+L, then apply the number of new objects you want between them.</span>
    </div>
  );
}
