/**
 * The hint strip text. Each tool module owns its own sentences (they depend on its private state);
 * this is the one entry point the strip uses, plus the sentence shown for a flash message.
 */
import { TOOL_MODULES } from './registry';
import type { HintSpec, HoverTarget, Modifiers, ToolCtx, ToolId } from './types';

export function hintFor(tool: ToolId, ctx: ToolCtx, state: unknown, hover: HoverTarget | null, mods: Modifiers): HintSpec {
  return TOOL_MODULES[tool].hint(ctx, state, hover, mods);
}

/** A short-lived message (a tool explaining why nothing happened) replaces the usual hint. */
export function flashHint(message: string, tone: 'warn' | 'ready' = 'warn'): HintSpec {
  return { text: message, chips: [], tone };
}
