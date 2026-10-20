/** One icon per concept, used everywhere (toolbar, layers, palette tabs, details headers). */
import {
  Boxes,
  Bridge,
  Cylinder,
  Flag,
  Gift,
  Map as MapIcon,
  Milestone,
  Mountain,
  MousePointer2,
  Paintbrush,
  Route,
  Scissors,
  Sparkles,
  TreePine,
  Unlink2,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { PieceKind, SectionKind } from '../../../lib/create/types';
import type { ToolId } from '../tools/types';

export const TOOL_ICONS: Record<ToolId, (size?: number) => ReactNode> = {
  select: (size = 18) => <MousePointer2 size={size} />,
  road: (size = 18) => <Route size={size} />,
  sections: (size = 18) => <Scissors size={size} />,
  pieces: (size = 18) => <Zap size={size} />,
  paint: (size = 18) => <Paintbrush size={size} />,
  sculpt: (size = 18) => <Mountain size={size} />,
  scenery: (size = 18) => <TreePine size={size} />,
  start: (size = 18) => <Flag size={size} />,
};

export const TOP_VIEW_ICON = (size = 18): ReactNode => <MapIcon size={size} />;

export const SECTION_ICONS: Record<SectionKind, (size?: number) => ReactNode> = {
  road: (size = 14) => <Route size={size} />,
  bridge: (size = 14) => <Bridge size={size} />,
  gap: (size = 14) => <Unlink2 size={size} />,
  tunnel: (size = 14) => <Cylinder size={size} />,
};

export const PIECE_ICONS: Record<PieceKind, (size?: number) => ReactNode> = {
  boostPanel: (size = 14) => <Zap size={size} />,
  boostRamp: (size = 14) => <Milestone size={size} />,
  trickRamp: (size = 14) => <Sparkles size={size} />,
  itemRow: (size = 14) => <Gift size={size} />,
  object: (size = 14) => <Boxes size={size} />,
};
