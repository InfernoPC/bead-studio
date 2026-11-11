import { describe, it, expect } from 'vitest';
import { createDesign, gridSize, getVariant, countCodes, bbox } from '../src/core/model';
import { smallDesign, paint } from './fixtures';

describe('model', () => {
  it('computes grid from physical size', () => {
    expect(gridSize({ widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 })).toEqual({ cols: 30, rows: 30 });
    expect(gridSize({ widthMm: 50, heightMm: 25, bead: 5, margin: 1 })).toEqual({ cols: 10, rows: 5 });
  });
  it('creates an empty design with one ideal variant', () => {
    const d = createDesign({ id: 'x', name: '測試', board: { widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    expect(d.cols * d.rows).toBe(100);
    expect(d.mask).toBe('0'.repeat(100));
    expect(d.variants).toHaveLength(1);
    expect(d.variants[0]).toMatchObject({ id: 'v1', name: '理想版', paletteMode: 'all' });
    expect(d.shapeLocked).toBe(false);
  });
  it('throws for unknown variant', () => {
    expect(() => getVariant(smallDesign(), 'nope')).toThrow(/找不到配色版本/);
  });
  it('counts codes and computes bbox', () => {
    const d = paint(smallDesign(), [[2, 3, 'A1'], [5, 4, 'A1'], [4, 4, 'H1']]);
    const v = getVariant(d);
    expect(countCodes(v.cells)).toEqual({ A1: 2, H1: 1 });
    expect(bbox(d, v.cells)).toEqual({ x0: 2, y0: 3, x1: 5, y1: 4 });
    expect(bbox(smallDesign(), getVariant(smallDesign()).cells)).toBeNull();
  });
});
