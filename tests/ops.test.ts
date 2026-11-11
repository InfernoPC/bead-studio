import { describe, it, expect } from 'vitest';
import { applyOps } from '../src/core/ops';
import { getVariant, cloneDesign } from '../src/core/model';
import { OpError } from '../src/core/errors';
import { smallDesign, paint, palette, ctxAll } from './fixtures';

const cell = (d: any, x: number, y: number, v?: string) => getVariant(d, v).cells[y * d.cols + x];

function twoVariants(mode: 'all' | 'owned' | 'stock') {
  const d = smallDesign();
  d.variants.push({ id: 'v2', name: '庫存版', paletteMode: mode, cells: Array(100).fill(null) });
  return d;
}

describe('applyOps', () => {
  it('paste uses legend, "." keeps, "_" clears', () => {
    const d0 = paint(smallDesign(), [[3, 1, 'H1']]);
    const { design } = applyOps(d0, [
      { op: 'paste', x: 1, y: 1, rows: ['ab_', '.a.'], legend: { a: 'A1', b: 'H2' } },
    ], ctxAll);
    expect(cell(design, 1, 1)).toBe('A1');
    expect(cell(design, 2, 1)).toBe('H2');
    expect(cell(design, 3, 1)).toBeNull();
    expect(cell(design, 1, 2)).toBeNull();
    expect(cell(design, 2, 2)).toBe('A1');
    expect(design.mask[1 * 10 + 1]).toBe('1');
  });

  it('draws rect / ellipse / line / polygon and summarizes counts', () => {
    const { design, summary } = applyOps(smallDesign(), [
      { op: 'rect', x: 0, y: 0, w: 3, h: 3, color: 'A1', fill: false },
      { op: 'line', x1: 5, y1: 5, x2: 8, y2: 5, color: 'H2' },
    ], ctxAll);
    expect(summary.counts).toEqual({ A1: 8, H2: 4 });
    expect(summary.delta).toEqual({ A1: 8, H2: 4 });
    expect(summary.total).toBe(12);
    expect(cell(design, 1, 1)).toBeNull();
  });

  it('clips out-of-grid drawing and reports clipped count', () => {
    const { design, summary } = applyOps(smallDesign(), [{ op: 'rect', x: 8, y: 8, w: 4, h: 4, color: 'A1', fill: true }], ctxAll);
    expect(summary.counts.A1).toBe(4);
    expect(summary.clipped).toBe(12);
    expect(cell(design, 9, 9)).toBe('A1');
  });

  it('atomic: a failing op leaves the original untouched', () => {
    const d0 = smallDesign();
    const before = JSON.stringify(d0);
    expect(() => applyOps(d0, [
      { op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1', fill: true },
      { op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'ZZ9', fill: true },
    ], ctxAll)).toThrow(/未知色號 ZZ9/);
    expect(JSON.stringify(d0)).toBe(before);
  });

  it('reports schema errors with op index', () => {
    try {
      applyOps(smallDesign(), [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1' }, { op: 'nope' }], ctxAll);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(OpError);
      expect((e as OpError).code).toBe('bad_op');
      expect((e as OpError).opIndex).toBe(1);
    }
  });

  it('flood fill replaces a connected region', () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1'], [2, 0, 'H1'], [0, 1, 'A1']]);
    const { design } = applyOps(d0, [{ op: 'fill', x: 0, y: 0, color: 'C1' }], ctxAll);
    expect(cell(design, 1, 0)).toBe('C1');
    expect(cell(design, 0, 1)).toBe('C1');
    expect(cell(design, 2, 0)).toBe('H1');
  });

  it('replace_color, clear, move, mirror, rotate', () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'H1']]);
    let d = applyOps(d0, [{ op: 'replace_color', from: 'A1', to: 'C1' }], ctxAll).design;
    expect(cell(d, 0, 0)).toBe('C1');
    d = applyOps(d, [{ op: 'move', region: { x: 0, y: 0, w: 2, h: 1 }, dx: 2, dy: 3 }], ctxAll).design;
    expect(cell(d, 0, 0)).toBeNull();
    expect(cell(d, 2, 3)).toBe('C1');
    expect(cell(d, 3, 3)).toBe('H1');
    d = applyOps(d, [{ op: 'mirror', region: { x: 2, y: 3, w: 2, h: 1 }, axis: 'h' }], ctxAll).design;
    expect(cell(d, 2, 3)).toBe('H1');
    d = applyOps(d, [{ op: 'rotate', region: { x: 2, y: 2, w: 2, h: 2 }, turns: 1 }], ctxAll).design;
    // 區域 (2,2)-(3,3)：左下 H1、右下 C1 → 順時針 90° → 左上 H1、左下 C1
    expect(cell(d, 2, 2)).toBe('H1');
    expect(cell(d, 2, 3)).toBe('C1');
    d = applyOps(d, [{ op: 'clear', region: { x: 0, y: 0, w: 10, h: 10 } }], ctxAll).design;
    expect(d.mask).toBe('0'.repeat(100));
  });

  it('rotate 90 on a non-square region is rejected', () => {
    expect(() => applyOps(smallDesign(), [{ op: 'rotate', region: { x: 0, y: 0, w: 2, h: 3 }, turns: 1 }], ctxAll)).toThrow(/正方形/);
  });

  it('shape lock rejects adding beads but allows recoloring', () => {
    const d0 = { ...paint(smallDesign(), [[0, 0, 'A1']]), shapeLocked: true };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctxAll))
      .toThrow(/形狀已鎖定/);
    const { design } = applyOps(d0, [{ op: 'replace_color', from: 'A1', to: 'H2' }], ctxAll);
    expect(cell(design, 0, 0)).toBe('H2');
  });

  it('shape lock allows transforms that keep occupancy', () => {
    const d0 = { ...paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'H1']]), shapeLocked: true };
    const { design } = applyOps(d0, [{ op: 'mirror', region: { x: 0, y: 0, w: 2, h: 1 }, axis: 'h' }], ctxAll);
    expect(cell(design, 0, 0)).toBe('H1');
  });

  it('palette mode rejects colors outside the range with a suggestion', () => {
    const d0 = twoVariants('owned');
    const ctx = { palette, inventory: { A1: { owned: true, count: 10 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A4' }], ctx, 'v2'))
      .toThrow(/A4 不在.*最接近的可用色是 A1/);
  });

  it('adding beads propagates to other variants with nearest allowed color; removing clears all', () => {
    const d0 = twoVariants('owned');
    const ctx = { palette, inventory: { A1: { owned: true, count: 10 }, H1: { owned: true, count: 10 } } };
    let d = applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A4' }], ctx).design;
    expect(cell(d, 0, 0, 'v1')).toBe('A4');
    expect(cell(d, 0, 0, 'v2')).toBe('A1');
    d = applyOps(d, [{ op: 'clear', region: { x: 0, y: 0, w: 1, h: 1 } }], ctx).design;
    expect(cell(d, 0, 0, 'v2')).toBeNull();
  });

  it('stock variant gets next-best stocked color when the nearest runs out', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 }, A2: { owned: true, count: 5 } } };
    const { design } = applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx);
    const v2 = [cell(design, 0, 0, 'v2'), cell(design, 1, 0, 'v2')].sort();
    expect(v2).toEqual(['A1', 'A2']);
  });

  it('rejects when a stock variant cannot cover new beads', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx))
      .toThrow(/庫存版.*缺 1 顆/);
  });

  it('rejects painting a stock variant beyond its stock', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx, 'v2'))
      .toThrow(/A1 需要 2 顆，庫存只有 1 顆/);
  });

  it('set_hole adds and removes markers', () => {
    let d = applyOps(smallDesign(), [{ op: 'set_hole', x: 4, y: 0 }], ctxAll).design;
    expect(d.markers).toEqual([{ type: 'hole', x: 4, y: 0 }]);
    d = applyOps(d, [{ op: 'set_hole', x: 4, y: 0, remove: true }], ctxAll).design;
    expect(d.markers).toEqual([]);
  });

  it('does not mutate its input', () => {
    const d0 = smallDesign();
    const copy = cloneDesign(d0);
    applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1', fill: true }], ctxAll);
    expect(d0).toEqual(copy);
  });

  it('automatic matching never picks transparent colors', () => {
    const d0 = twoVariants('all');
    const { design } = applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'T1' }], ctxAll);
    expect(cell(design, 0, 0, 'v1')).toBe('T1');
    const v2 = cell(design, 0, 0, 'v2');
    expect(v2).not.toBeNull();
    expect(v2).not.toBe('T1');
  });

  it('rejects unbounded geometry with bad_op', () => {
    for (const op of [
      { op: 'rect', x: 0, y: 0, w: 1_000_000, h: 1, color: 'A1' },
      { op: 'clear', region: { x: -1e7, y: 0, w: 1, h: 1 } },
    ]) {
      try {
        applyOps(smallDesign(), [op], ctxAll);
        throw new Error('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(OpError);
        expect((e as OpError).code).toBe('bad_op');
        expect((e as OpError).opIndex).toBe(0);
      }
    }
  });
});
