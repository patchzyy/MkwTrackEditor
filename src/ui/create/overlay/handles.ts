/**
 * Overlay handle ids. The viewport reports the id of the pickable overlay point under the cursor;
 * the overlay builder encodes what each point is, and the tools decode it again here. Ids are
 * `kind|a|b` (design ids never contain a pipe).
 */
export type HandleRef =
  | { type: 'point'; roadId: string; pointId: string }
  | { type: 'close'; roadId: string }
  | { type: 'piece'; pieceId: string }
  | { type: 'prop'; propId: string }
  | { type: 'start' }
  | { type: 'boundary'; roadId: string; sectionId: string }
  | { type: 'section'; roadId: string; sectionId: string };

export function encodeHandle(ref: HandleRef): string {
  switch (ref.type) {
    case 'point':
      return `pt|${ref.roadId}|${ref.pointId}`;
    case 'close':
      return `close|${ref.roadId}`;
    case 'piece':
      return `piece|${ref.pieceId}`;
    case 'prop':
      return `prop|${ref.propId}`;
    case 'start':
      return 'start';
    case 'boundary':
      return `bnd|${ref.roadId}|${ref.sectionId}`;
    case 'section':
      return `sec|${ref.roadId}|${ref.sectionId}`;
  }
}

export function parseHandle(id: string | null | undefined): HandleRef | null {
  if (!id) return null;
  const parts = id.split('|');
  switch (parts[0]) {
    case 'pt':
      return parts.length === 3 ? { type: 'point', roadId: parts[1], pointId: parts[2] } : null;
    case 'close':
      return parts.length === 2 ? { type: 'close', roadId: parts[1] } : null;
    case 'piece':
      return parts.length === 2 ? { type: 'piece', pieceId: parts[1] } : null;
    case 'prop':
      return parts.length === 2 ? { type: 'prop', propId: parts[1] } : null;
    case 'start':
      return { type: 'start' };
    case 'bnd':
      return parts.length === 3 ? { type: 'boundary', roadId: parts[1], sectionId: parts[2] } : null;
    case 'sec':
      return parts.length === 3 ? { type: 'section', roadId: parts[1], sectionId: parts[2] } : null;
    default:
      return null;
  }
}
