/**
 * Where Create mode's panels plug in. `CreateMode.tsx` renders exactly these slots; each takes the
 * `CreateSession` plus the tool state (`useCreateTools`) and the shared object assets.
 */
import type { ReactNode } from 'react';
import type { ModeBottomDock } from '../modes/types';
import { BuildPanel } from './build/BuildPanel';
import { DetailsPanel } from './details/DetailsPanel';
import { PaletteDock } from './palette/PaletteDock';
import type { CreateAssets } from './palette/assets';
import type { CreateSession } from './session/types';
import type { CreateTools } from './tools/useCreateTools';
import { CreateChrome } from './viewport/CreateChrome';

export interface SlotProps {
  session: CreateSession;
  tools: CreateTools;
  assets: CreateAssets;
}

export function BuildSlot({ session, tools }: SlotProps) {
  return <BuildPanel session={session} tools={tools} />;
}

export function DetailsSlot({ session, tools, assets }: SlotProps) {
  return <DetailsPanel session={session} tools={tools} assets={assets} />;
}

/** The bottom dock. Returns null until a design is open (the shell then leaves the row empty). */
export function paletteSlot(props: SlotProps, dock: ModeBottomDock): ReactNode {
  if (!props.session.project) return null;
  return <PaletteDock dock={dock} session={props.session} tools={props.tools} assets={props.assets} />;
}

/** Viewport chrome: tool bar, hint strip, health chip, coach marks. */
export function ChromeSlot({ session, tools }: SlotProps) {
  return <CreateChrome session={session} tools={tools} />;
}
