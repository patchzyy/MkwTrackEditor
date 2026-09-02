import type { Vec3 } from '../../../lib/kmp';

export function VectorInputs({ value, onChange, step = 1 }: { value: Vec3; onChange: (value: Vec3) => void; step?: number }) {
  return (
    <div className="vectorInputs">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <input
          key={axis}
          aria-label={axis.toUpperCase()}
          type="number"
          step={step}
          value={Number.isFinite(value[axis]) ? Number(value[axis].toFixed(4)) : 0}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange({ ...value, [axis]: next });
          }}
        />
      ))}
    </div>
  );
}
