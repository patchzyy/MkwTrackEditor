// Lazily loads `src/lib/gxMaterial/`, so the BRRES writer it sits on is only fetched when somebody
// actually opens Material mode. Every function it exposes is synchronous once loaded — this is
// only about *when* the module arrives, not about making the contract async.
//
// The facade is the module's own type rather than a hand-written interface, so an addition to the
// library is available here without a second declaration to keep in step.
export type GxMaterialLibrary = typeof import('../../lib/gxMaterial');

let pending: Promise<GxMaterialLibrary> | null = null;

export function loadMaterialLibrary(): Promise<GxMaterialLibrary> {
  if (pending === null) pending = import('../../lib/gxMaterial');
  return pending;
}
