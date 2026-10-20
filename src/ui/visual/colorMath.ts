// Small colour helpers for the Environment panel and the look presets. Colours are 0-255 RGB
// triples, the way the posteffect files store them. Pure; no DOM.
import type { RgbColor } from '../../lib/posteffects';

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

export function clampColor(color: readonly number[]): RgbColor {
  return [clampChannel(color[0] ?? 0), clampChannel(color[1] ?? 0), clampChannel(color[2] ?? 0)];
}

export function sameColor(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Rec. 601 luma of a 0-255 colour, 0-255. */
export function lumaOf(color: readonly number[]): number {
  return 0.299 * (color[0] ?? 0) + 0.587 * (color[1] ?? 0) + 0.114 * (color[2] ?? 0);
}

/** Linear blend: `amount` 0 keeps `from`, 1 gives `to`. */
export function mixColor(from: readonly number[], to: readonly number[], amount: number): RgbColor {
  const t = Math.max(0, Math.min(1, amount));
  return clampColor([0, 1, 2].map((i) => (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * t));
}

/** `rgb(...)` for inline styles. */
export function cssColor(color: readonly number[]): string {
  const [r, g, b] = clampColor(color);
  return `rgb(${r} ${g} ${b})`;
}

export function colorToHex(color: readonly number[]): string {
  return `#${clampColor(color)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToColor(hex: string): RgbColor {
  const value = hex.replace('#', '').trim();
  if (value.length !== 6) return [255, 255, 255];
  const channels = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return clampColor(channels.map((channel) => (Number.isFinite(channel) ? channel : 255)));
}

/** How bright a light colour is: its strongest channel as a 0-1 fraction. */
export function brightnessOf(color: readonly number[]): number {
  return Math.max(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0) / 255;
}

/**
 * Rescales a colour so its strongest channel sits at `brightness` (0-1), keeping its hue. A black
 * colour becomes a grey, so dragging brightness up from zero still shows something.
 */
export function withBrightness(color: readonly number[], brightness: number): RgbColor {
  const target = Math.max(0, Math.min(1, brightness)) * 255;
  const peak = Math.max(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0);
  if (peak <= 0) return clampColor([target, target, target]);
  const scale = target / peak;
  return clampColor([(color[0] ?? 0) * scale, (color[1] ?? 0) * scale, (color[2] ?? 0) * scale]);
}

/**
 * A relative colour change: pull towards or away from grey (`saturation`), multiply by a per
 * channel `tint`, scale by `gain`, then blend towards a colour (`mix`). Every field is optional;
 * an empty op returns the colour unchanged.
 */
export interface ColorOp {
  /** 1 keeps the colour, 0 is grey, above 1 pushes it away from grey. */
  saturation?: number;
  /** Per-channel multiplier (1 = unchanged). */
  tint?: readonly [number, number, number];
  /** Overall multiplier (1 = unchanged). */
  gain?: number;
  /** Blend towards a colour after the above. */
  mix?: { toward: readonly [number, number, number]; amount: number };
}

export function applyColorOp(color: readonly number[], op: ColorOp | undefined): RgbColor {
  if (!op) return clampColor(color);
  let out: number[] = [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0];
  if (op.saturation !== undefined && op.saturation !== 1) {
    const grey = lumaOf(out);
    out = out.map((channel) => grey + (channel - grey) * (op.saturation as number));
  }
  if (op.tint) out = out.map((channel, index) => channel * (op.tint as readonly number[])[index]);
  if (op.gain !== undefined && op.gain !== 1) out = out.map((channel) => channel * (op.gain as number));
  let result = clampColor(out);
  if (op.mix && op.mix.amount > 0) result = mixColor(result, op.mix.toward, op.mix.amount);
  return result;
}
