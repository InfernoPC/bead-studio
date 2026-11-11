import { describe, it, expect } from 'vitest';
import { createVariant, recolorVariant, selectVariant } from '../src/core/variants';
import { getVariant } from '../src/core/model';
import { smallDesign, paint, palette } from './fixtures';

describe('variants', () => {
  it('creates an owned-colors variant mapping to nearest owned color, same shape', () => {
    const d = paint(smallDesign(), [[0, 0, 'A4'], [1, 0, 'H1']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 9 }, H1: { owned: true, count: 9 } } };
    const { design, id } = createVariant(d, { name: '有的色', paletteMode: 'owned' }, ctx);
    expect(id).toBe('v2');
    const v = getVariant(design, id);
    expect(v.cells[0]).toBe('A1');
    expect(v.cells[1]).toBe('H1');
    expect(v.cells.filter(Boolean)).toHaveLength(2);
  });
  it('stock variant respects counts', () => {
    const d = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1'], [2, 0, 'A1']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 }, A2: { owned: true, count: 9 } } };
    const { design, id } = createVariant(d, { name: '庫存版', paletteMode: 'stock' }, ctx);
    const v = getVariant(design, id);
    expect(v.cells.filter((c) => c === 'A1')).toHaveLength(1);
    expect(v.cells.filter((c) => c === 'A2')).toHaveLength(2);
  });
  it('recolorVariant changes mode in place', () => {
    const d = paint(smallDesign(), [[0, 0, 'A4']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 9 } } };
    const out = recolorVariant(d, 'v1', ctx, { mode: 'owned' });
    expect(getVariant(out, 'v1').paletteMode).toBe('owned');
    expect(getVariant(out, 'v1').cells[0]).toBe('A1');
  });
  it('selectVariant switches the active variant', () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    const ctx = { palette, inventory: {} };
    const { design, id } = createVariant(d, { name: 'x', paletteMode: 'all' }, ctx);
    expect(selectVariant(design, id).activeVariant).toBe('v2');
    expect(() => selectVariant(design, 'v9')).toThrow(/找不到配色版本/);
  });
  it('automatic matching never picks a transparent color', () => {
    const d = paint(smallDesign(), [[0, 0, 'T1'], [1, 0, 'A1']]);
    const ctx = { palette, inventory: {} };
    const { design, id } = createVariant(d, { name: '不透明', paletteMode: 'all' }, ctx);
    const v = getVariant(design, id);
    expect(v.cells[0]).not.toBe('T1');
    expect(v.cells[0]).toBe('H1');
    expect(v.cells[1]).toBe('A1');
  });
});
