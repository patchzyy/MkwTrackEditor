export interface OutlinePoint {
  x: number;
  z: number;
}

/**
 * A top-down drawing of a road: the saved designs on the home screen and the layout cards in the
 * wizard. `points` are normalised to 0..1 (north is up, like the editor's top view); the stroke
 * is drawn as a dark casing with a lighter road on top so a lap reads as a road, not a scribble.
 */
export function TrackOutline({
  points,
  closed = true,
  className,
  title,
  emptyLabel = 'Empty',
}: {
  points: readonly OutlinePoint[];
  closed?: boolean;
  className?: string;
  /** Accessible name; the drawing is decorative when omitted. */
  title?: string;
  /** What to say when there is no road to draw (a blank design). */
  emptyLabel?: string;
}) {
  const size = 100;
  const path = pathFor(points, size, closed);
  const first = points[0];
  const box = viewBoxFor(points, size);
  return (
    <svg
      className={['createOutline', className].filter(Boolean).join(' ')}
      viewBox={path ? `${box.x} ${box.y} ${box.w} ${box.h}` : `0 0 ${size} ${size}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      preserveAspectRatio="xMidYMid meet"
    >
      {path ? (
        <>
          <path d={path} className="createOutlineCasing" />
          <path d={path} className="createOutlineRoad" />
          <path d={path} className="createOutlineCenter" />
          {first && <circle cx={first.x * size} cy={first.z * size} r={Math.max(box.w, box.h) * 0.03} className="createOutlineStart" />}
        </>
      ) : (
        <text x="50" y="54" textAnchor="middle" className="createOutlineEmpty">
          {emptyLabel}
        </text>
      )}
    </svg>
  );
}

/** The drawing's own bounds (plus a margin for the stroke), so a long thin lap fills its frame. */
function viewBoxFor(points: readonly OutlinePoint[], size: number): { x: number; y: number; w: number; h: number } {
  if (points.length < 2) return { x: 0, y: 0, w: size, h: size };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x * size);
    maxX = Math.max(maxX, p.x * size);
    minZ = Math.min(minZ, p.z * size);
    maxZ = Math.max(maxZ, p.z * size);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxZ - minZ, 1);
  // Never closer than a 5:3 frame, so a flat oval is not stretched into a banner.
  const pad = Math.max(w, h) * 0.08;
  return { x: minX - pad, y: minZ - pad, w: w + pad * 2, h: h + pad * 2 };
}

function pathFor(points: readonly OutlinePoint[], size: number, closed: boolean): string {
  if (points.length < 2) return '';
  const coords = points.map((p) => `${(p.x * size).toFixed(2)} ${(p.z * size).toFixed(2)}`);
  return `M${coords.join(' L')}${closed ? ' Z' : ''}`;
}
