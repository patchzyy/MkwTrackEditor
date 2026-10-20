import type { CSSProperties } from 'react';
import { resolveEdge } from '../../../lib/create/roadStyles';
import type { CreateKit, EdgeWall, RoadEdge, RoadStyle, SurfaceRef } from '../../../lib/create/types';
import { kitImageUrl } from '../kitImages';

const WALL_HEIGHT: Record<EdgeWall, number> = { none: 0, barrier: 20, wall: 40, fence: 30, invisible: 0 };

function surfaceStyle(kit: CreateKit | null, ref: SurfaceRef, themeId: string): CSSProperties {
  if (!kit) return {};
  const surface = kit.resolveSurface(ref, themeId);
  const url = kitImageUrl(kit, surface.thumbnail);
  return url ? { backgroundImage: `url(${url})` } : {};
}

function wallRef(kind: EdgeWall): SurfaceRef {
  return { slot: kind === 'barrier' ? 'barrier' : kind === 'fence' ? 'fence' : 'wall' };
}

/**
 * A little side-on cross-section of a road style: walls, shoulder, curb and road surface drawn with
 * the world's own textures, so a card shows what the road will actually look like.
 */
export function RoadProfileArt({ kit, themeId, style, edge }: { kit: CreateKit | null; themeId: string; style: Pick<RoadStyle, 'surface' | 'left' | 'right'>; edge?: { left?: Partial<RoadEdge>; right?: Partial<RoadEdge>; surface?: SurfaceRef } }) {
  const surface = edge?.surface ?? style.surface;
  const sides: Array<{ side: 'left' | 'right'; edge: RoadEdge }> = [
    { side: 'left', edge: resolveEdge(style.left, edge?.left) },
    { side: 'right', edge: resolveEdge(style.right, edge?.right) },
  ];
  const render = ({ side, edge: e }: { side: 'left' | 'right'; edge: RoadEdge }) => {
    const parts = [
      e.wall !== 'none' && (
        <i
          key="wall"
          className={`crProfileWall${e.wall === 'invisible' ? ' is-invisible' : ''}${e.wall === 'fence' ? ' is-fence' : ''}`}
          style={{ height: Math.max(8, WALL_HEIGHT[e.wall]), ...surfaceStyle(kit, wallRef(e.wall), themeId) }}
        />
      ),
      e.shoulder && <i key="shoulder" className="crProfileShoulder" style={{ width: Math.max(10, Math.min(30, e.shoulderWidth / 30)), ...surfaceStyle(kit, e.shoulder, themeId) }} />,
      e.curb && <i key="curb" className="crProfileCurb" style={surfaceStyle(kit, { slot: 'curb' }, themeId)} />,
    ].filter(Boolean);
    return side === 'left' ? parts : parts.reverse();
  };
  return (
    <span className="crProfile" aria-hidden="true">
      <span className="crProfileRow">
        {render(sides[0])}
        <i className="crProfileRoad" style={surfaceStyle(kit, surface, themeId)} />
        {render(sides[1])}
      </span>
      <span className="crProfileGround" style={surfaceStyle(kit, { slot: 'ground' }, themeId)} />
    </span>
  );
}
