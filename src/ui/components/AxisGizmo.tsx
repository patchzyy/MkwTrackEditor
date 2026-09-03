import { useEffect, useState } from 'react';

const AXES = [
  { key: 'x', label: 'X', vector: [1, 0, 0] as const, color: 'var(--axis-x)' },
  { key: 'y', label: 'Y', vector: [0, 1, 0] as const, color: 'var(--axis-y)' },
  { key: 'z', label: 'Z', vector: [0, 0, 1] as const, color: 'var(--axis-z)' },
];

/**
 * Yaw (rotation about world Y) of a column-major 4x4 camera world matrix. The camera looks
 * down its local -Z, so the forward vector is the negated third basis column.
 */
export function yawFromCameraMatrix(matrix: ArrayLike<number> | null | undefined): number {
  if (!matrix || matrix.length < 12) return 0;
  const forwardX = -matrix[8];
  const forwardZ = -matrix[10];
  if (forwardX === 0 && forwardZ === 0) return 0;
  return Math.atan2(forwardX, forwardZ);
}

/** Pitch of the same matrix, clamped so the gizmo never flips upside down. */
export function pitchFromCameraMatrix(matrix: ArrayLike<number> | null | undefined): number {
  if (!matrix || matrix.length < 12) return 0;
  const forwardY = -matrix[9];
  return Math.asin(Math.max(-1, Math.min(1, forwardY)));
}

/**
 * Three-axis orientation hint for the viewport's bottom-right corner.
 *
 * Pass `getCameraMatrix` to make it follow the camera; without it the gizmo renders a
 * fixed three-quarter view, which is still a useful legend for the axis colours used by the
 * transform gizmos.
 */
export function AxisGizmo({
  getCameraMatrix,
  size = 62,
}: {
  getCameraMatrix?: () => ArrayLike<number> | null | undefined;
  size?: number;
}) {
  const [orientation, setOrientation] = useState({ yaw: -Math.PI * 0.75, pitch: 0.45 });

  useEffect(() => {
    if (!getCameraMatrix || typeof window === 'undefined') return;
    let handle = 0;
    let last = { yaw: Number.NaN, pitch: Number.NaN };
    const tick = () => {
      const matrix = getCameraMatrix();
      const yaw = yawFromCameraMatrix(matrix);
      const pitch = pitchFromCameraMatrix(matrix);
      // Only re-render when the camera actually moved by a visible amount.
      if (Math.abs(yaw - last.yaw) > 0.004 || Math.abs(pitch - last.pitch) > 0.004) {
        last = { yaw, pitch };
        setOrientation({ yaw, pitch });
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [getCameraMatrix]);

  const half = size / 2;
  const radius = half - 11;
  const cosYaw = Math.cos(orientation.yaw);
  const sinYaw = Math.sin(orientation.yaw);
  const cosPitch = Math.cos(orientation.pitch);
  const sinPitch = Math.sin(orientation.pitch);

  const projected = AXES.map((axis) => {
    const [x, y, z] = axis.vector;
    // Yaw about Y, then pitch about the resulting X, then drop the depth component.
    const rx = x * cosYaw - z * sinYaw;
    const rz = x * sinYaw + z * cosYaw;
    const ry = y;
    const screenX = rx;
    const screenY = ry * cosPitch - rz * sinPitch;
    const depth = ry * sinPitch + rz * cosPitch;
    return { ...axis, screenX, screenY, depth };
  }).sort((a, b) => a.depth - b.depth);

  return (
    <svg className="uiAxisGizmo" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Viewport orientation">
      <circle cx={half} cy={half} r={half - 1} className="uiAxisGizmoDisc" />
      {projected.map((axis) => {
        const tipX = half + axis.screenX * radius;
        const tipY = half - axis.screenY * radius;
        const negX = half - axis.screenX * radius;
        const negY = half + axis.screenY * radius;
        return (
          <g key={axis.key} opacity={axis.depth < -0.35 ? 0.45 : 1}>
            <line x1={negX} y1={negY} x2={tipX} y2={tipY} stroke={axis.color} strokeWidth={1.5} strokeLinecap="round" opacity={0.55} />
            <circle cx={tipX} cy={tipY} r={7} fill={axis.color} />
            <text x={tipX} y={tipY + 3.2} textAnchor="middle" className="uiAxisGizmoLabel">
              {axis.label}
            </text>
            <circle cx={negX} cy={negY} r={3.2} fill={axis.color} opacity={0.35} />
          </g>
        );
      })}
    </svg>
  );
}
