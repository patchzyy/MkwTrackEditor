import type { RgbColor } from '../../../lib/posteffects';
import { hexToRgb, rgbToHex } from '../postEffectResources';

export function RgbColorField({ value, onChange }: { value: RgbColor; onChange: (value: RgbColor) => void }) {
  return <input type="color" value={rgbToHex(value)} onChange={(event) => onChange(hexToRgb(event.currentTarget.value))} />;
}
