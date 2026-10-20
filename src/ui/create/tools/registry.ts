import { paintTool } from './paintTool';
import { pieceTool } from './pieceTool';
import { roadTool } from './roadTool';
import { sceneryTool } from './sceneryTool';
import { sculptTool } from './sculptTool';
import { sectionTool } from './sectionTool';
import { selectTool } from './selectTool';
import { startTool } from './startTool';
import type { ToolId, ToolModule } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolModule = ToolModule<any>;

export const TOOL_MODULES: Record<ToolId, AnyToolModule> = {
  select: selectTool,
  road: roadTool,
  sections: sectionTool,
  pieces: pieceTool,
  paint: paintTool,
  sculpt: sculptTool,
  scenery: sceneryTool,
  start: startTool,
};

export function initialToolStates(): Record<ToolId, unknown> {
  const states = {} as Record<ToolId, unknown>;
  for (const id of Object.keys(TOOL_MODULES) as ToolId[]) states[id] = TOOL_MODULES[id].initial();
  return states;
}
