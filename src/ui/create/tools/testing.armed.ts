import { pieceItem, roadStyleItem, sculptItem, surfaceItem } from './armed';
import { kit } from './testing';
import type { ArmedItem, SculptMode } from './types';

export const roadStyleItemForTest = (styleId: string): ArmedItem => roadStyleItem(styleId);
export const pieceItemForTest = (piece: Parameters<typeof pieceItem>[0], objectId?: number): ArmedItem => pieceItem(piece, objectId);
export const sculptItemForTest = (mode: SculptMode): ArmedItem => sculptItem(mode);
export const surfaceItemForTest = (id: string): ArmedItem => {
  const surface = kit.surface(id);
  if (!surface) throw new Error(`no surface ${id}`);
  return surfaceItem(surface);
};
export const sceneryItemForTest = (objectId = 303): ArmedItem => ({ kind: 'scenery', objectId, label: 'Round tree', scale: 1, spacing: 600 });
