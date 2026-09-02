import { describe, expect, it } from 'vitest';
import {
  appendKmpCheckpoint,
  appendKmpGobj,
  appendKmpPoint,
  appendKmpPotiPoint,
  appendKmpPotiRoute,
  deleteKmpEntity,
  parseKmp,
  patchKmpCheckpointField,
  patchKmpEntityRotation,
  patchKmpEntityScale,
  patchKmpGobjPresenceFlags,
  patchKmpGobjSetting,
  type KmpDocument,
  type KmpEntity,
} from './kmp';
import {
  appendCopiedEntity,
  countSectionEntities,
  createClipboardEntity,
  decodeWrappedSpin,
  encodeWrappedSpin,
  getReferenceCounts,
  getSelectionIdAfterRoutePointDeletion,
  offsetCheckpointPoint,
  parseGroupLinkText,
  setMaskedBits,
  sortClipboardEntriesForPaste,
  toSigned16,
  toUnsigned16,
} from './kmpEdit';

const SECTION_NAMES = ['KTPT', 'ENPT', 'ENPH', 'ITPT', 'ITPH', 'CKPT', 'CKPH', 'GOBJ', 'POTI', 'AREA', 'CAME', 'JGPT', 'CNPT', 'MSPT', 'STGI'];

/** Builds a valid but completely empty course.kmp so the tests do not need a real track file. */
function createEmptyKmp(): KmpDocument {
  const headerSize = 0x10 + SECTION_NAMES.length * 4;
  const bytes = new Uint8Array(headerSize + SECTION_NAMES.length * 8);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RKMD'), 0);
  view.setUint32(0x04, bytes.length, false);
  view.setUint16(0x08, SECTION_NAMES.length, false);
  view.setUint16(0x0a, headerSize, false);
  view.setUint32(0x0c, 2520, false);
  SECTION_NAMES.forEach((name, index) => {
    const sectionOffset = headerSize + index * 8;
    view.setUint32(0x10 + index * 4, sectionOffset - headerSize, false);
    bytes.set(encoder.encode(name), sectionOffset);
    view.setUint16(sectionOffset + 4, 0, false);
    view.setUint16(sectionOffset + 6, 0, false);
  });
  return parseKmp(bytes);
}

function entity(document: KmpDocument, id: string): KmpEntity {
  const found = document.entities.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing entity ${id}`);
  return found;
}

describe('createEmptyKmp fixture', () => {
  it('parses as an empty but structurally complete KMP', () => {
    const document = createEmptyKmp();
    expect(document.sections.map((section) => section.name)).toEqual(SECTION_NAMES);
    expect(document.entities).toHaveLength(0);
  });
});

describe('appendCopiedEntity', () => {
  it('copies a GOBJ with its object id, settings, presence flags, rotation and scale', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpGobj(document, 0x65, { x: 10, y: 20, z: 30 }));
    document = parseKmp(patchKmpEntityRotation(document, entity(document, 'GOBJ-0'), { x: 1, y: 2, z: 3 }));
    document = parseKmp(patchKmpEntityScale(document, entity(document, 'GOBJ-0'), { x: 2, y: 3, z: 4 }));
    document = parseKmp(patchKmpGobjSetting(document, entity(document, 'GOBJ-0'), 1, 0x1234));
    document = parseKmp(patchKmpGobjPresenceFlags(document, entity(document, 'GOBJ-0'), 0x0005));

    const source = entity(document, 'GOBJ-0');
    const result = appendCopiedEntity(document, source, { x: 310, y: 20, z: 330 });
    expect(result.selectedId).toBe('GOBJ-1');

    const next = parseKmp(result.bytes);
    const copy = entity(next, 'GOBJ-1');
    expect(countSectionEntities(next.entities, 'GOBJ')).toBe(2);
    expect(copy.position).toEqual({ x: 310, y: 20, z: 330 });
    expect(copy.objectId).toBe(source.objectId);
    expect(copy.rotation).toEqual(source.rotation);
    expect(copy.scale).toEqual(source.scale);
    expect(copy.objectSettings).toEqual(source.objectSettings);
    expect(copy.presenceFlags).toBe(0x0005);
    // The original is untouched.
    expect(entity(next, 'GOBJ-0').position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('copies a route point into the same route right after its source node', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPotiRoute(document, { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpPotiPoint(document, 0, 0, { x: 100, y: 0, z: 0 }));
    expect(document.routes[0].points).toHaveLength(2);

    const source = entity(document, 'POTI-0-0');
    const result = appendCopiedEntity(document, source, { x: 50, y: 5, z: 50 });
    expect(result.selectedId).toBe('POTI-0-1');

    const next = parseKmp(result.bytes);
    expect(next.routes).toHaveLength(1);
    expect(next.routes[0].points).toHaveLength(3);
    expect(next.routes[0].points[1].position).toEqual({ x: 50, y: 5, z: 50 });
    expect(next.routes[0].points[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(next.routes[0].points[2].position).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('copies a checkpoint and moves both endpoints by the same delta', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpCheckpoint(document, { x: 0, y: 0, z: 0 }));
    document = parseKmp(patchKmpCheckpointField(document, entity(document, 'CKPT-0'), 'type', 0));
    const source = entity(document, 'CKPT-0');
    expect(source.checkpoint).toBeDefined();

    const target = { x: 1000, y: 0, z: 2000 };
    const result = appendCopiedEntity(document, source, target);
    expect(result.selectedId).toBe('CKPT-1');

    const next = parseKmp(result.bytes);
    const copy = entity(next, 'CKPT-1');
    expect(countSectionEntities(next.entities, 'CKPT')).toBe(2);
    expect(copy.checkpoint!.left).toEqual(offsetCheckpointPoint(source.checkpoint!.left, source.position, target));
    expect(copy.checkpoint!.right).toEqual(offsetCheckpointPoint(source.checkpoint!.right, source.position, target));
    expect(copy.checkpoint!.respawnIndex).toBe(source.checkpoint!.respawnIndex);
    expect(copy.checkpoint!.type).toBe(source.checkpoint!.type);
  });
});

describe('clipboard helpers', () => {
  it('anchors a multi-entity copy on the primary selection and keeps relative offsets', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpGobj(document, 0x65, { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpGobj(document, 0x65, { x: 100, y: 0, z: 200 }));
    const entities = [entity(document, 'GOBJ-0'), entity(document, 'GOBJ-1')];

    const clipboard = createClipboardEntity(entities, 'GOBJ-1');
    expect(clipboard.primaryId).toBe('GOBJ-1');
    expect(clipboard.anchor).toEqual({ x: 100, y: 0, z: 200 });
    expect(clipboard.entries.map((item) => item.relativeOffset)).toEqual([
      { x: -100, y: 0, z: -200 },
      { x: 0, y: 0, z: 0 },
    ]);
  });

  it('pastes route nodes from the end of the route backwards so earlier indices stay valid', () => {
    const makeEntry = (id: string, routeIndex: number | null, pointIndex: number, order: number) => ({
      entity: {
        id,
        section: 'POTI',
        index: 0,
        position: { x: 0, y: 0, z: 0 },
        rawOffset: 0,
        recordSize: 0,
        routePoint: routeIndex === null ? undefined : { routeIndex, pointIndex },
      } as unknown as KmpEntity,
      relativeOffset: { x: 0, y: 0, z: 0 },
      order,
    });
    const sorted = sortClipboardEntriesForPaste([
      makeEntry('POTI-0-0', 0, 0, 0),
      makeEntry('GOBJ-0', null, 0, 1),
      makeEntry('POTI-0-2', 0, 2, 2),
    ]);
    expect(sorted.map((item) => item.entity.id)).toEqual(['POTI-0-2', 'POTI-0-0', 'GOBJ-0']);
  });
});

describe('getSelectionIdAfterRoutePointDeletion', () => {
  it('selects the previous node of the same route after deleting a route point', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPotiRoute(document, { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpPotiPoint(document, 0, 0, { x: 100, y: 0, z: 0 }));
    document = parseKmp(appendKmpPotiPoint(document, 0, 1, { x: 200, y: 0, z: 0 }));
    const deleted = entity(document, 'POTI-0-1');

    const after = parseKmp(deleteKmpEntity(document, deleted));
    expect(after.routes[0].points).toHaveLength(2);
    expect(getSelectionIdAfterRoutePointDeletion(document, after, deleted)).toBe('POTI-0-0');
  });

  it('clamps to the first node when the deleted node was the first one', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPotiRoute(document, { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpPotiPoint(document, 0, 0, { x: 100, y: 0, z: 0 }));
    const deleted = entity(document, 'POTI-0-0');

    const after = parseKmp(deleteKmpEntity(document, deleted));
    expect(getSelectionIdAfterRoutePointDeletion(document, after, deleted)).toBe('POTI-0-0');
  });

  it('returns null when the route has no points left', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPotiRoute(document, { x: 0, y: 0, z: 0 }));
    const deleted = entity(document, 'POTI-0-0');
    const after = parseKmp(deleteKmpEntity(document, deleted));
    expect(getSelectionIdAfterRoutePointDeletion(document, after, deleted)).toBeNull();
  });

  it('returns null for sections that are not grouped path points', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPoint(document, 'JGPT', { x: 0, y: 0, z: 0 }));
    const deleted = entity(document, 'JGPT-0');
    const after = parseKmp(deleteKmpEntity(document, deleted));
    expect(getSelectionIdAfterRoutePointDeletion(document, after, deleted)).toBeNull();
  });
});

describe('reference counts', () => {
  it('counts the records other KMP sections can point at', () => {
    let document = createEmptyKmp();
    document = parseKmp(appendKmpPoint(document, 'JGPT', { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpPoint(document, 'ENPT', { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpCheckpoint(document, { x: 0, y: 0, z: 0 }));
    document = parseKmp(appendKmpPotiRoute(document, { x: 0, y: 0, z: 0 }));

    expect(getReferenceCounts(document)).toEqual({ routes: 1, cameras: 0, enemyPoints: 1, checkpoints: 1, respawns: 1 });
    expect(getReferenceCounts(null)).toEqual({ routes: 0, cameras: 0, enemyPoints: 0, checkpoints: 0, respawns: 0 });
  });
});

describe('numeric field codecs', () => {
  it('round-trips signed 16-bit object settings', () => {
    expect(toSigned16(0xffff)).toBe(-1);
    expect(toSigned16(0x7fff)).toBe(32767);
    expect(toUnsigned16(-1)).toBe(0xffff);
    expect(toUnsigned16(-40000)).toBe(0x8000);
    expect(toSigned16(toUnsigned16(-1234))).toBe(-1234);
  });

  it('round-trips wrapped spin speed/direction pairs', () => {
    expect(decodeWrappedSpin(0x0064)).toEqual({ direction: 1, speed: 100 });
    expect(decodeWrappedSpin(0xff9c)).toEqual({ direction: 0, speed: 100 });
    expect(encodeWrappedSpin(100, 1)).toBe(0x0064);
    expect(encodeWrappedSpin(100, 0)).toBe(0xff9c);
    expect(encodeWrappedSpin(0, 0)).toBe(0);
  });

  it('sets and clears individual presence bits', () => {
    expect(setMaskedBits(0x0004, 0x0001, true)).toBe(0x0005);
    expect(setMaskedBits(0x0005, 0x0001, false)).toBe(0x0004);
  });

  it('parses free-form path group link text', () => {
    expect(parseGroupLinkText('1, 2 3')).toEqual([1, 2, 3]);
    expect(parseGroupLinkText('')).toEqual([]);
    expect(parseGroupLinkText('300, -4, x')).toEqual([255, 0]);
  });
});
