import { describe, expect, it } from 'vitest';
import { collisionTypes, describeKclFlag } from '../../kcl';
import * as flags from './kclFlags';
import { kclFlag, splitKclFlag, withBlight, withVariant } from './kclFlags';
import { writers } from './index';

describe('kclFlag', () => {
  it('has a named constant for every collision type kcl.ts lists, with the right value', () => {
    const named = Object.entries(flags).filter(([name, value]) => name.startsWith('KCL_') && typeof value === 'number') as Array<[string, number]>;
    const values = new Set(named.map(([, value]) => value));
    expect(values.size).toBe(collisionTypes.length);
    for (let type = 0; type < collisionTypes.length; type++) expect(values.has(type), `type ${type} (${collisionTypes[type]})`).toBe(true);
    expect(flags.KCL_ROAD).toBe(0x00);
    expect(flags.KCL_BOOST_PANEL).toBe(0x06);
    expect(flags.KCL_BOOST_RAMP).toBe(0x07);
    expect(flags.KCL_WALL).toBe(0x0c);
    expect(flags.KCL_INVISIBLE_WALL).toBe(0x0d);
    expect(flags.KCL_FALL_BOUNDARY).toBe(0x10);
    expect(flags.KCL_INVISIBLE_WALL_2).toBe(0x1f);
  });

  it('packs the bit fields where describeKclFlag reads them', () => {
    for (let type = 0; type < 32; type++) {
      const flag = kclFlag(type, 5, { blight: 6, wheelDepth: 2, trickable: true, softWall: true });
      const info = describeKclFlag(flag);
      expect(info.basicType).toBe(type);
      expect(info.variant).toBe(5);
      expect(info.blightEffect).toBe(6);
      expect(info.wheelDepth).toBe(2);
      expect(info.trickable).toBe(true);
      expect(info.softWall).toBe(true);
    }
    expect(kclFlag(flags.KCL_ROAD)).toBe(0);
    expect(kclFlag(flags.KCL_BOOST_PANEL, 1)).toBe(0x26);
    expect(kclFlag(flags.KCL_WALL, 0, { rejectRoad: true })).toBe(0x400c);
    expect(kclFlag(0, 0, { trickable: true })).toBe(0x2000);
    expect(kclFlag(0, 0, { softWall: true })).toBe(0x8000);
  });

  it('round-trips through splitKclFlag and the with* helpers', () => {
    const flag = kclFlag(flags.KCL_ROAD_2, 3, { blight: 2, wheelDepth: 1, rejectRoad: true });
    expect(splitKclFlag(flag)).toEqual({ type: 0x17, variant: 3, blight: 2, wheelDepth: 1, trickable: false, rejectRoad: true, softWall: false });
    expect(splitKclFlag(withBlight(flag, 7)).blight).toBe(7);
    expect(splitKclFlag(withVariant(flag, 0)).variant).toBe(0);
    expect(splitKclFlag(withVariant(withBlight(flag, 7), 0)).type).toBe(0x17);
  });

  it('rejects out-of-range fields', () => {
    expect(() => kclFlag(32)).toThrow(RangeError);
    expect(() => kclFlag(-1)).toThrow(RangeError);
    expect(() => kclFlag(0, 8)).toThrow(RangeError);
    expect(() => kclFlag(0, 0, { blight: 8 })).toThrow(RangeError);
    expect(() => kclFlag(0, 0, { wheelDepth: 4 })).toThrow(RangeError);
    expect(() => kclFlag(0.5)).toThrow(RangeError);
  });
});

describe('writers', () => {
  it('exposes the three functions the compiler expects', () => {
    expect(typeof writers.buildModelBrres).toBe('function');
    expect(typeof writers.buildKcl).toBe('function');
    expect(typeof writers.buildMinimapBrres).toBe('function');
  });
});
