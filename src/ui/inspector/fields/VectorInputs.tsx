import type { Vec3 } from '../../../lib/kmp';
import { VectorInput } from '../../components/VectorInput';

/**
 * X/Y/Z triple. Thin wrapper over the shared `VectorInput` primitive so the inspector
 * sections keep their existing call signature while gaining drag-to-scrub and axis colours.
 */
export function VectorInputs({ value, onChange, step = 1 }: { value: Vec3; onChange: (value: Vec3) => void; step?: number }) {
  return <VectorInput value={value} onChange={onChange} step={step} precision={4} />;
}
