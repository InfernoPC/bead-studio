import { describe, it, expect } from 'vitest';
import { applyOps } from '../src/core/ops';
import { getVariant } from '../src/core/model';
import { OpError } from '../src/core/errors';
import { smallDesign, paint, ctxAll } from './fixtures';

const cell = (d: any, x: number, y: number) => getVariant(d).cells[y * d.cols + x];
const block = (x0: number, y0: number, n: number, c: string) => {
  const pts: [number, number, string][] = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) pts.push([x, y, c]);
  return pts;
};

describe('effects', () => {
  it('outer outline (8-connected) surrounds a single bead', () => {
    const { summary } = applyOps(paint(smallDesign(), [[4, 4, 'A1']]), [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer' }], ctxAll);
    expect(summary.counts.H2).toBe(8);
  });
  it('outer outline with connect 4 skips diagonals', () => {
    const { summary } = applyOps(paint(smallDesign(), [[4, 4, 'A1']]), [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer', connect: 4 }], ctxAll);
    expect(summary.counts.H2).toBe(4);
  });
  it('inner outline recolors the border of a block', () => {
    const { design } = applyOps(paint(smallDesign(), block(2, 2, 3, 'A1')), [{ op: 'outline', target: 'A1', color: 'H2', side: 'inner' }], ctxAll);
    expect(cell(design, 3, 3)).toBe('A1');
    expect(cell(design, 2, 2)).toBe('H2');
    expect(cell(design, 4, 3)).toBe('H2');
  });
  it('horizontal gradient splits evenly', () => {
    const row: [number, number, string][] = [0, 1, 2, 3, 4, 5].map((x) => [x, 0, 'H1']);
    const { design } = applyOps(paint(smallDesign(), row), [{ op: 'gradient', target: 'H1', colors: ['A1', 'B1', 'C1'], direction: 'h' }], ctxAll);
    expect([0, 1, 2, 3, 4, 5].map((x) => cell(design, x, 0))).toEqual(['A1', 'A1', 'B1', 'B1', 'C1', 'C1']);
  });
  it('gradient never adds beads', () => {
    const { summary } = applyOps(paint(smallDesign(), [[1, 1, 'H1']]), [{ op: 'gradient', target: 'shape', colors: ['A1', 'C1'], direction: 'v', dither: true }], ctxAll);
    expect(summary.total).toBe(1);
  });
  it('shade from top-left lights top/left edges and darkens bottom/right', () => {
    const { design } = applyOps(paint(smallDesign(), block(0, 0, 3, 'A1')), [
      { op: 'shade', target: 'A1', light: 'tl', highlight: 'A3', shadow: 'A2' },
    ], ctxAll);
    expect(cell(design, 0, 0)).toBe('A3');
    expect(cell(design, 1, 0)).toBe('A3');
    expect(cell(design, 0, 1)).toBe('A3');
    expect(cell(design, 1, 1)).toBe('A1');
    expect(cell(design, 2, 2)).toBe('A2');
    expect(cell(design, 2, 1)).toBe('A2');
    expect(cell(design, 2, 0)).toBe('A1');
  });
  it('shade rejects depth above 16', () => {
    const d = paint(smallDesign(), block(0, 0, 3, 'A1'));
    let err: unknown;
    try {
      applyOps(d, [{ op: 'shade', target: 'A1', light: 'tl', highlight: 'A3', shadow: 'A2', depth: 1000 }], ctxAll);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OpError);
    expect((err as OpError).code).toBe('bad_op');
  });
  it('outer outline is rejected when shape is locked', () => {
    const d = { ...paint(smallDesign(), [[4, 4, 'A1']]), shapeLocked: true };
    expect(() => applyOps(d, [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer' }], ctxAll)).toThrow(/形狀已鎖定/);
  });
});
