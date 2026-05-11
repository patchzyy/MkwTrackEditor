import { describe, expect, it } from 'vitest';
import {
  patchBrresMeshMatrixIndex,
  patchBrresMeshSlotBinding,
  patchBrresNodeBillboardSettings,
  patchBrresNodeTransform,
  patchBrresNodeVisibility,
} from './brresEditor';

describe('BRRES editor patch helpers', () => {
  it('patches MDL0 node scale, rotation, and translation at the recorded source offset', () => {
    const source = new Uint8Array(0x80);
    const patched = patchBrresNodeTransform(
      source,
      { sourceOffset: 0x10 },
      {
        scale: { x: 1.5, y: 2.5, z: 3.5 },
        rotation: { x: 10, y: 20, z: 30 },
        translation: { x: 100, y: 200, z: 300 },
      },
    );
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    expect(view.getFloat32(0x30)).toBeCloseTo(1.5);
    expect(view.getFloat32(0x34)).toBeCloseTo(2.5);
    expect(view.getFloat32(0x38)).toBeCloseTo(3.5);
    expect(view.getFloat32(0x3c)).toBeCloseTo(10);
    expect(view.getFloat32(0x40)).toBeCloseTo(20);
    expect(view.getFloat32(0x44)).toBeCloseTo(30);
    expect(view.getFloat32(0x48)).toBeCloseTo(100);
    expect(view.getFloat32(0x4c)).toBeCloseTo(200);
    expect(view.getFloat32(0x50)).toBeCloseTo(300);
  });

  it('patches the MDL0 node visibility flag without disturbing the other node bits', () => {
    const source = new Uint8Array(0x40);
    const seeded = new DataView(source.buffer, source.byteOffset, source.byteLength);
    seeded.setUint32(0x14, 0x0000010f);

    const hidden = patchBrresNodeVisibility(source, { sourceOffset: 0x00 }, false);
    const hiddenView = new DataView(hidden.buffer, hidden.byteOffset, hidden.byteLength);
    expect(hiddenView.getUint32(0x14)).toBe(0x0000000f);

    const visible = patchBrresNodeVisibility(hidden, { sourceOffset: 0x00 }, true);
    const visibleView = new DataView(visible.buffer, visible.byteOffset, visible.byteLength);
    expect(visibleView.getUint32(0x14)).toBe(0x0000010f);
  });

  it('patches the MDL0 node billboard mode and reference node id at the recorded source offset', () => {
    const source = new Uint8Array(0x40);
    const patched = patchBrresNodeBillboardSettings(source, { sourceOffset: 0x00 }, { billboardMode: 5, billboardRefNodeId: 12 });
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    expect(view.getUint32(0x18)).toBe(5);
    expect(view.getUint32(0x1c)).toBe(12);
  });

  it('patches MDL0 mesh-slot material and node bindings at the recorded draw bytecode offset', () => {
    const source = new Uint8Array(0x40);
    const patched = patchBrresMeshSlotBinding(source, { drawSourceOffset: 0x10 }, { materialIndex: 7, nodeId: 12 });
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    expect(view.getUint16(0x11)).toBe(7);
    expect(view.getUint16(0x15)).toBe(12);
    expect(patchBrresMeshSlotBinding(source, { drawSourceOffset: null }, { materialIndex: 0, nodeId: 0 })).toBe(source);
  });

  it('patches MDL0 shape matrix indices at the recorded mesh source offset', () => {
    const source = new Uint8Array(0x40);
    const patched = patchBrresMeshMatrixIndex(source, { sourceOffset: 0x08 }, 7);
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    expect(view.getInt32(0x10)).toBe(7);
    expect(patchBrresMeshMatrixIndex(source, { sourceOffset: null }, 3)).toBe(source);
  });
});
