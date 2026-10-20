import { Fragment } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { Toolbar } from '../../components/Toolbar';
import type { ToolId } from '../tools/types';
import { TOOL_ICONS, TOP_VIEW_ICON } from './icons';
import { TOOL_INFO } from './toolInfo';

/**
 * The floating tool bar at the top centre of the viewport: Mario-Maker style, big icon, a label
 * under it and the shortcut letter in the corner. Group order: Select, the road tools, the ground
 * tools, Start, then the Top view toggle.
 */
export function CreateToolbar({
  activeTool,
  onSelectTool,
  topView,
  onToggleTopView,
  disabled = false,
  disabledReason,
}: {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  topView: boolean;
  onToggleTopView: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Toolbar label="Create tools" floating className="crToolbar">
      {TOOL_INFO.map((tool, index) => {
        const active = tool.id === activeTool;
        const previous = TOOL_INFO[index - 1];
        return (
          <Fragment key={tool.id}>
            {previous && previous.group !== tool.group && <span className="crToolbarGap" role="separator" aria-orientation="vertical" />}
            <Tooltip label={disabled && disabledReason ? disabledReason : tool.description} shortcut={tool.key} side="bottom">
              <button
                type="button"
                className={`crTool${active ? ' is-active' : ''}`}
                style={{ ['--tool-accent' as string]: tool.accent }}
                aria-pressed={active}
                aria-label={`${tool.label} tool`}
                aria-keyshortcuts={tool.key}
                data-create-tool={tool.id}
                disabled={disabled}
                onClick={() => onSelectTool(tool.id)}
              >
                <span className="crToolIcon">{TOOL_ICONS[tool.id](20)}</span>
                <span className="crToolLabel">{tool.label}</span>
                <span className="crToolKey" aria-hidden="true">
                  {tool.key}
                </span>
              </button>
            </Tooltip>
          </Fragment>
        );
      })}
      <span className="crToolbarGap crToolbarGap--wide" role="separator" aria-orientation="vertical" />
      <Tooltip label={topView ? 'Back to the free camera.' : 'Look straight down on the track. Drawing roads is easiest from above.'} shortcut="T" side="bottom">
        <button
          type="button"
          className={`crTool${topView ? ' is-active' : ''}`}
          style={{ ['--tool-accent' as string]: 'var(--text)' }}
          aria-pressed={topView}
          aria-label="Top view"
          aria-keyshortcuts="T"
          data-create-tool="topView"
          disabled={disabled}
          onClick={onToggleTopView}
        >
          <span className="crToolIcon">{TOP_VIEW_ICON(20)}</span>
          <span className="crToolLabel">Top view</span>
          <span className="crToolKey" aria-hidden="true">
            T
          </span>
        </button>
      </Tooltip>
    </Toolbar>
  );
}
