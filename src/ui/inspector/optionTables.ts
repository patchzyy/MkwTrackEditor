// Shared dropdown option tables for the route / area / cannon inspector sections.
// Extracted from src/ui/App.tsx.

export const enemyRouteSetting1Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Requires Mushroom' },
  { value: 2, label: 'Use Mushroom' },
  { value: 3, label: 'Allow Wheelie' },
  { value: 4, label: 'End Wheelie' },
];
export const enemyRouteSetting2Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'End Drift' },
  { value: 2, label: 'Forbid Drift(?)' },
  { value: 3, label: 'Force Drift' },
];
export const itemRouteSetting1Options = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Bullet Bill uses gravity' },
  { value: 2, label: 'Bullet Bill ignores gravity' },
];
export const itemRouteSetting2Options = [
  { value: 0, label: 'None' },
  { value: 1, label: "Bullet Bill can't stop" },
  { value: 0x0a, label: 'Low-priority route' },
  { value: 0x0b, label: "Bullet Bill can't stop + low priority" },
];
export const potiRouteShapeOptions = [
  { value: 0, label: 'Straight Edges' },
  { value: 1, label: 'Curved Edges' },
];
export const potiRouteMotionOptions = [
  { value: 0, label: 'Cyclic Motion' },
  { value: 1, label: 'Back-and-Forth Motion' },
];
export const areaTypeOptions = [
  { value: 0, label: 'Camera' },
  { value: 1, label: 'Environment Effect' },
  { value: 2, label: 'Fog Effect' },
  { value: 3, label: 'Moving Water' },
  { value: 4, label: 'Force Recalc' },
  { value: 5, label: 'Minimap Control' },
  { value: 6, label: 'Bloom Effect' },
  { value: 7, label: 'Enable Boos' },
  { value: 8, label: 'Object Group' },
  { value: 9, label: 'Object Unload' },
  { value: 10, label: 'Fall Boundary' },
];
export const areaShapeOptions = [
  { value: 0, label: 'Box' },
  { value: 1, label: 'Cylinder' },
];
export const cannonEffectOptions = [
  { value: 0, label: 'Fast, Straight Line' },
  { value: 1, label: 'Curved' },
  { value: 2, label: 'Curved (Slow)' },
];
