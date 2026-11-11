import { describe, it, expect } from 'vitest';
import { cellAt, zoomAround } from '../../src/web/lib/viewport';

describe('viewport', () => {
  const view = { cell: 10, pad: 18, offsetX: 10, offsetY: 20, zoom: 2 };

  it('maps a canvas point to a cell at zoom 2 with offset (10,20)', () => {
    // x: 10 + 2 × (18 + 3×10 + 5) = 116 → 第 3 欄；y: 20 + 2 × (18 + 4×10 + 1) = 138 → 第 4 列
    expect(cellAt(116, 138, view, 30, 30)).toEqual([3, 4]);
    // 剛好在第 0 格左上角
    expect(cellAt(10 + 2 * 18, 20 + 2 * 18, view, 30, 30)).toEqual([0, 0]);
  });

  it('returns null outside the grid', () => {
    expect(cellAt(10 + 2 * 17, 100, view, 30, 30)).toBeNull(); // 尺規區
    expect(cellAt(10 + 2 * (18 + 30 * 10), 100, view, 30, 30)).toBeNull(); // 右邊界外
    expect(cellAt(100, 20 + 2 * (18 + 5 * 10), view, 30, 5)).toBeNull(); // 下邊界外
  });

  it('keeps the cell under the cursor fixed while zooming', () => {
    const px = 237, py = 151;
    const before = cellAt(px, py, view, 30, 30);
    for (const f of [1.25, 0.8, 3]) {
      const next = zoomAround(view, f, px, py);
      expect(next.zoom).toBeCloseTo(view.zoom * f);
      expect(cellAt(px, py, next, 30, 30)).toEqual(before);
      // 游標下的面板座標完全不變
      expect((px - next.offsetX) / next.zoom).toBeCloseTo((px - view.offsetX) / view.zoom);
      expect((py - next.offsetY) / next.zoom).toBeCloseTo((py - view.offsetY) / view.zoom);
    }
  });

  it('clamps zoom to 0.25–8', () => {
    expect(zoomAround(view, 100, 0, 0).zoom).toBe(8);
    expect(zoomAround(view, 0.001, 0, 0).zoom).toBe(0.25);
  });
});
