import { describe, it, expect } from 'vitest';
import { DEFAULT_UNIT_WEIGHTS, gramsToCount, loadUnitWeights, parseWeight, saveUnitWeights, UNIT_WEIGHT_KEY } from '../../src/web/lib/weight';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('gramsToCount', () => {
  it('divides by the unit weight and rounds to the nearest bead', () => {
    expect(gramsToCount(6, 0.06)).toBe(100);
    expect(gramsToCount(6.02, 0.06)).toBe(100);
    expect(gramsToCount(6.04, 0.06)).toBe(101);
    expect(gramsToCount(0, 0.06)).toBe(0);
  });
  it('rejects negative or non-numeric grams and zero or negative unit weights', () => {
    expect(gramsToCount(-1, 0.06)).toBeNull();
    expect(gramsToCount(Number.NaN, 0.06)).toBeNull();
    expect(gramsToCount(6, 0)).toBeNull();
    expect(gramsToCount(6, -0.06)).toBeNull();
    expect(gramsToCount(Infinity, 0.06)).toBeNull();
  });
});

describe('parseWeight', () => {
  it('accepts non-negative decimals and trims spaces', () => {
    expect(parseWeight(' 6 ')).toBe(6);
    expect(parseWeight('0.06')).toBe(0.06);
    expect(parseWeight('.5')).toBe(0.5);
    expect(parseWeight('0')).toBe(0);
  });
  it('rejects empty, negative and non-numeric input', () => {
    for (const s of ['', ' ', '-1', 'abc', '1e3', '1.2.3', '6g']) expect(parseWeight(s)).toBeNull();
  });
});

describe('unit weights storage', () => {
  it('defaults to 0.06 g for both kinds', () => {
    expect(DEFAULT_UNIT_WEIGHTS).toEqual({ normal: 0.06, clear: 0.06 });
    expect(loadUnitWeights(mem())).toEqual(DEFAULT_UNIT_WEIGHTS);
    expect(loadUnitWeights(null)).toEqual(DEFAULT_UNIT_WEIGHTS);
  });
  it('round-trips saved values', () => {
    const s = mem();
    saveUnitWeights({ normal: 0.055, clear: 0.07 }, s);
    expect(loadUnitWeights(s)).toEqual({ normal: 0.055, clear: 0.07 });
  });
  it('falls back per field when stored data is damaged or invalid', () => {
    expect(loadUnitWeights(mem({ [UNIT_WEIGHT_KEY]: '{oops' }))).toEqual(DEFAULT_UNIT_WEIGHTS);
    expect(loadUnitWeights(mem({ [UNIT_WEIGHT_KEY]: JSON.stringify({ normal: 0, clear: 0.08 }) }))).toEqual({ normal: 0.06, clear: 0.08 });
  });
  it('does not throw when storage throws', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadUnitWeights(bad)).toEqual(DEFAULT_UNIT_WEIGHTS);
    expect(() => saveUnitWeights(DEFAULT_UNIT_WEIGHTS, bad)).not.toThrow();
  });
});
