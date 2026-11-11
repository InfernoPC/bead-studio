import { describe, it, expect } from 'vitest';
import { Palette, validatePalette, allowedCodes, stockCapacity } from '../src/core/palette';
import { FIX_COLORS, palette } from './fixtures';

describe('palette', () => {
  it('validates a good palette', () => {
    expect(validatePalette(FIX_COLORS)).toEqual([]);
  });
  it('reports duplicates, bad hex and series mismatch', () => {
    const errs = validatePalette([
      { code: 'A1', name: 'x', series: 'A', hex: '#FFFFFF' },
      { code: 'A1', name: 'y', series: 'A', hex: '#FFF' },
      { code: 'B2', name: 'z', series: 'A', hex: '#000000' },
    ]);
    expect(errs.join('\n')).toMatch(/重複.*A1/);
    expect(errs.join('\n')).toMatch(/hex.*#FFF/);
    expect(errs.join('\n')).toMatch(/系列.*B2/);
  });
  it('prefers calibratedHex for display and matching', () => {
    const p = new Palette([{ code: 'A1', name: 'x', series: 'A', hex: '#FF0000', calibratedHex: '#00FF00' }]);
    expect(p.get('A1')!.displayHex).toBe('#00FF00');
    expect(p.get('A1')!.rgb).toEqual([0, 255, 0]);
  });
  it('filters allowed codes by mode', () => {
    const inv = { A1: { owned: true, count: 5 }, A2: { owned: true, count: 0 }, B1: { owned: false, count: 9 } };
    expect(allowedCodes(palette, inv, 'all').size).toBe(FIX_COLORS.length);
    expect([...allowedCodes(palette, inv, 'owned')].sort()).toEqual(['A1', 'A2']);
    expect([...allowedCodes(palette, inv, 'stock')]).toEqual(['A1']);
  });
  it('finds nearest allowed color', () => {
    expect(palette.nearestIn('A4', new Set(['A1', 'C1', 'H1']))).toBe('A1');
    expect(palette.nearestIn('A4', new Set())).toBeNull();
  });
  it('builds stock capacity only for owned colors', () => {
    const cap = stockCapacity({ A1: { owned: true, count: 5 }, B1: { owned: false, count: 9 } });
    expect(cap.get('A1')).toBe(5);
    expect(cap.has('B1')).toBe(false);
  });
});
