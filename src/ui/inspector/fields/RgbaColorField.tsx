import type { RgbaColor } from '../../../lib/posteffects';
import { ColorField } from '../../components/ColorField';
import { clampByte } from '../postEffectResources';

/** Colour picker plus a 0-255 opacity field. */
export function RgbaColorField({ value, onChange }: { value: RgbaColor; onChange: (value: RgbaColor) => void }) {
  return (
    <ColorField
      value={[value[0], value[1], value[2]]}
      alpha={value[3]}
      onChange={([r, g, b]) => onChange([r, g, b, value[3]])}
      onChangeAlpha={(alpha) => onChange([value[0], value[1], value[2], clampByte(alpha)])}
    />
  );
}
