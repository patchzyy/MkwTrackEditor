export interface Preset {
  value: number;
  label: string;
  tooltip?: string;
}

/** The preset a value belongs to (within a hair, so 1.1 typed as 1.10 still counts), or null. */
export function matchPreset(presets: readonly Preset[], value: number): Preset | null {
  return presets.find((p) => Math.abs(p.value - value) <= Math.max(1e-6, Math.abs(p.value) * 0.002)) ?? null;
}

/**
 * The race speed the stage info takes (`speedFactor`, a multiplier on every kart's speed). 1 is the
 * normal game; 1.1 and 1.2 are noticeably quicker, and beyond about 1.25 karts get hard to steer,
 * which is why the friendly choices stop at 1.2 (the exact box still allows 0.5 to 2). The file
 * stores it as a half-precision float, so 1.1 comes back as 1.094 and 1.2 as 1.195.
 */
export const SPEED_PRESETS: readonly Preset[] = [
  { value: 1, label: 'Normal', tooltip: 'The usual speed' },
  { value: 1.1, label: 'Fast', tooltip: 'Every kart is 10% quicker' },
  { value: 1.2, label: 'Faster', tooltip: 'Every kart is 20% quicker' },
];

/** Friendly choices for the generated spacings (game units between gates / route points). */
export const CHECKPOINT_PRESETS: readonly Preset[] = [
  { value: 3500, label: 'Close', tooltip: 'Gates close together: hard to cut corners' },
  { value: 5000, label: 'Normal' },
  { value: 8000, label: 'Far apart', tooltip: 'Fewer gates: easier to skip a corner' },
];
export const DRIVER_ROUTE_PRESETS: readonly Preset[] = [
  { value: 2500, label: 'Smooth', tooltip: 'Computer drivers follow the road closely' },
  { value: 3500, label: 'Normal' },
  { value: 5500, label: 'Loose', tooltip: 'Fewer route points: cuts corners more' },
];
export const ITEM_ROUTE_PRESETS: readonly Preset[] = [
  { value: 2500, label: 'Smooth', tooltip: 'Homing items follow the road closely' },
  { value: 3300, label: 'Normal' },
  { value: 5500, label: 'Loose', tooltip: 'Fewer route points: homing items cut corners' },
];
