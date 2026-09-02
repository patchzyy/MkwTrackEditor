import type { RgbaColor } from '../../../lib/posteffects';
import { clampByte, hexToRgb, rgbToHex } from '../postEffectResources';

export function RgbaColorField({ value, onChange }: { value: RgbaColor; onChange: (value: RgbaColor) => void }) {
  return (
    <div className="colorField">
      <input
        type="color"
        value={rgbToHex([value[0], value[1], value[2]])}
        onChange={(event) => {
          const [r, g, b] = hexToRgb(event.currentTarget.value);
          onChange([r, g, b, value[3]]);
        }}
      />
      <input
        type="number"
        min="0"
        max="255"
        value={value[3]}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange([value[0], value[1], value[2], clampByte(next)]);
        }}
      />
    </div>
  );
}
