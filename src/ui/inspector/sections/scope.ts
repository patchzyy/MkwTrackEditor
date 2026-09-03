/**
 * Which half of the inspector a section is being asked to render.
 *
 * `essentials` is what a track author sees straight away; `advanced` is what sits behind the
 * single Advanced disclosure. `recordSummary.ts` decides which field ids belong where; each
 * section just answers to the scope it is handed.
 */
export type InspectorScope = 'essentials' | 'advanced';
