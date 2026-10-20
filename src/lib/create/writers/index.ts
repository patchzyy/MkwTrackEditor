/**
 * Create mode writers: generated geometry -> the binary files the game reads.
 *
 *   buildModelBrres   course_model.brres and live preview chunks (MDL0 + textures + animations)
 *   buildKcl          course.kcl (prisms + octree)
 *   buildMinimapBrres map_model.brres
 *
 * See README.md in this folder for what each one supports and expects.
 */

import type { CompileWriters } from '../types';
import { buildKcl } from './kclWriter';
import { buildMinimapBrres } from './minimapWriter';
import { buildModelBrres } from './modelWriter';

export { buildKcl, buildMinimapBrres, buildModelBrres };
export { KCL_DEFAULT_PRISM_THICKNESS, KCL_DEFAULT_SPHERE_RADIUS, type KclWriterOptions } from './kclWriter';
export { MAX_SHAPE_CORNERS, MAX_SHAPE_VERTICES } from './modelWriter';
export { MINIMAP_HEIGHT, MINIMAP_MARGIN } from './minimapWriter';
export * from './kclFlags';

export const writers: CompileWriters = { buildModelBrres, buildKcl, buildMinimapBrres };
