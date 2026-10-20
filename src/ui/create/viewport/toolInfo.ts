import { TOOL_KEYS, TOOL_LABELS, TOOL_ORDER, type ToolId } from '../tools/types';

export interface ToolInfo {
  id: ToolId;
  label: string;
  key: string;
  /** One sentence for the tooltip: what the tool is for. */
  description: string;
  /** CSS variable (from `create.css`) holding the concept colour of this tool. */
  accent: string;
  /** Toolbar group: a thin separator is drawn between groups. */
  group: number;
}

const DESCRIPTIONS: Record<ToolId, string> = {
  select: 'Select and move things. Drag road points, pieces, objects and the start line.',
  road: 'Draw the road. Click the ground to add points, click the first point to close the loop.',
  sections: 'Split the road into stretches, then make them bridges, gaps or tunnels.',
  pieces: 'Place boost panels, ramps, item boxes and hazards on the road.',
  paint: 'Paint sand, mud, water or lava onto the ground.',
  sculpt: 'Raise and lower the ground to make hills and valleys.',
  scenery: 'Place trees, signs and other objects, one by one or with a brush.',
  start: 'Move the start line to another spot on the main road.',
};

const ACCENTS: Record<ToolId, string> = {
  select: 'var(--text)',
  road: 'var(--create-road)',
  sections: 'var(--create-section)',
  pieces: 'var(--create-piece)',
  paint: 'var(--create-terrain)',
  sculpt: 'var(--create-terrain)',
  scenery: 'var(--create-scenery)',
  start: 'var(--create-start)',
};

const GROUPS: Record<ToolId, number> = { select: 0, road: 1, sections: 1, pieces: 1, paint: 2, sculpt: 2, scenery: 2, start: 3 };

export const TOOL_INFO: ToolInfo[] = TOOL_ORDER.map((id) => ({
  id,
  label: TOOL_LABELS[id],
  key: TOOL_KEYS[id],
  description: DESCRIPTIONS[id],
  accent: ACCENTS[id],
  group: GROUPS[id],
}));
