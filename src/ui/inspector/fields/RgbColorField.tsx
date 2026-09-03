import type { RgbColor } from '../../../lib/posteffects';
import { ColorField } from '../../components/ColorField';

/** Opaque colour picker with a hex readout. */
export function RgbColorField({ value, onChange }: { value: RgbColor; onChange: (value: RgbColor) => void }) {
  return <ColorField value={value} onChange={(next) => onChange(next)} />;
}
