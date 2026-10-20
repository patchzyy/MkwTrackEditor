/** Lane maths for placing gameplay pieces on a road. Pure and unit tested. */
import { defaultPiece } from '../../../lib/create/pieces';
import type { Piece, PieceKind } from '../../../lib/create/types';
import { LANE_ORDER, type Lane, type LaneMode } from './types';

/** Which third of the road a normalised lateral offset (-1..1) falls in. */
export function laneFromLateral(lateralNorm: number): Lane {
  if (lateralNorm < -1 / 3) return 'left';
  if (lateralNorm > 1 / 3) return 'right';
  return 'centre';
}

/** The lane an `auto` lane mode resolves to for a piece kind under the cursor. */
export function resolveLane(mode: LaneMode, kind: PieceKind, lateralNorm: number): Lane {
  if (mode !== 'auto') return mode;
  if (kind === 'itemRow') return 'full';
  if (kind === 'boostRamp' || kind === 'trickRamp') return 'centre';
  return laneFromLateral(lateralNorm);
}

export type PiecePlacement = Omit<Piece, 'id' | 'roadId' | 'param'>;

/** The piece fields (lateral, width, count...) for `kind` in `lane` on a road `roadWidth` wide. */
export function placementForLane(kind: PieceKind, lane: Lane, roadWidth: number, objectId?: number): PiecePlacement {
  const base = defaultPiece(kind, roadWidth, objectId);
  const piece: PiecePlacement = { ...base };
  const lateral = lane === 'left' ? -0.5 : lane === 'right' ? 0.5 : 0;
  piece.lateral = lateral;
  if (kind !== 'object') {
    if (lane === 'full') {
      piece.width = Math.max(600, roadWidth - (kind === 'itemRow' ? 600 : 300));
    } else if (lane === 'left' || lane === 'right') {
      piece.width = Math.max(500, Math.min(base.width, roadWidth / 3 - 100));
    }
    if (kind === 'itemRow') piece.count = Math.max(1, Math.round(piece.width / 550));
  }
  return piece;
}

export function nextLaneMode(mode: LaneMode, direction: 1 | -1): LaneMode {
  const i = LANE_ORDER.indexOf(mode);
  return LANE_ORDER[(i + direction + LANE_ORDER.length) % LANE_ORDER.length];
}

export function laneLabel(mode: LaneMode): string {
  switch (mode) {
    case 'auto':
      return 'Follows cursor';
    case 'left':
      return 'Left lane';
    case 'centre':
      return 'Centre';
    case 'right':
      return 'Right lane';
    case 'full':
      return 'Full width';
  }
}
