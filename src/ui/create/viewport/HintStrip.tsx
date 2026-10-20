import { Fragment } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { KbdSequence } from '../../components/Tooltip';
import type { HintSpec, ToolId } from '../tools/types';
import { TOOL_ICONS } from './icons';
import { TOOL_INFO } from './toolInfo';

/**
 * The strip under the tool bar. It always says what the current tool does right now and which
 * modifier keys change that ("Click the first point to close the loop.").
 */
export function HintStrip({ tool, hint, brushLabel }: { tool: ToolId; hint: HintSpec; brushLabel?: string | null }) {
  const info = TOOL_INFO.find((t) => t.id === tool) ?? TOOL_INFO[0];
  const tone = hint.tone ?? 'info';
  return (
    <div className={`crHint crHint--${tone}`} role="status" aria-live="polite" style={{ ['--tool-accent' as string]: info.accent }} data-create-hint>
      <span className="crHintTool" aria-hidden="true">
        {TOOL_ICONS[tool](13)}
        {info.label}
      </span>
      <span className="crHintIcon" aria-hidden="true">
        {tone === 'warn' ? <TriangleAlert size={13} /> : <Info size={13} />}
      </span>
      <span className="crHintText" data-create-hint-text>
        {hint.text}
      </span>
      {hint.chips.length > 0 && (
        <span className="crHintChips">
          {hint.chips.map((chip, index) => (
            <Fragment key={`${chip.keys}-${index}`}>
              <span className="crHintChip">
                <KbdSequence shortcut={chip.keys.replace(/ \/ /g, ' + ')} />
                <span>{chip.label}</span>
              </span>
            </Fragment>
          ))}
        </span>
      )}
      {brushLabel && <span className="crHintBrush">{brushLabel}</span>}
    </div>
  );
}
