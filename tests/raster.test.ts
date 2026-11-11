import { describe, it, expect } from 'vitest';
import { linePts, rectPts, ellipsePts, polygonPts, floodRegion, regionPts } from '../src/core/raster';

// 舊的暴力法實作，作為 polygonPts 的對照組
function polygonRef(points: [number, number][], fill: boolean): [number, number][] {
  const set = new Map<string, [number, number]>();
  const add = (p: [number, number]) => set.set(`${p[0]},${p[1]}`, p);
  points.forEach((p, k) => { const q = points[(k + 1) % points.length]; linePts(p[0], p[1], q[0], q[1]).forEach(add); });
  if (fill) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    for (let j = Math.min(...ys); j <= Math.max(...ys); j++)
      for (let i = Math.min(...xs); i <= Math.max(...xs); i++) {
        let inside = false;
        for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
          const [xa, ya] = points[a], [xb, yb] = points[b];
          if ((ya > j) !== (yb > j) && i < ((xb - xa) * (j - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) add([i, j]);
      }
  }
  return [...set.values()];
}

const key = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).sort();

describe('raster', () => {
  it('draws bresenham lines both directions', () => {
    expect(linePts(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(key(linePts(3, 3, 0, 0))).toEqual(key([[0, 0], [1, 1], [2, 2], [3, 3]]));
  });
  it('rect fill vs outline', () => {
    expect(rectPts(0, 0, 3, 3, true)).toHaveLength(9);
    expect(rectPts(0, 0, 3, 3, false)).toHaveLength(8);
  });
  it('ellipse 1x1 is one cell; 5x5 disc is symmetric', () => {
    expect(ellipsePts(2, 2, 1, 1, true)).toEqual([[2, 2]]);
    const disc = ellipsePts(0, 0, 5, 5, true);
    expect(disc).toContainEqual([2, 0]);
    expect(disc).not.toContainEqual([0, 0]);
    const ring = ellipsePts(0, 0, 5, 5, false);
    expect(ring).not.toContainEqual([2, 2]);
    expect(ring).toContainEqual([2, 0]);
  });
  it('polygon fill includes outline cells', () => {
    const tri = polygonPts([[0, 0], [4, 0], [0, 4]], true);
    expect(tri).toContainEqual([1, 1]);
    expect(tri).toContainEqual([4, 0]);
    expect(tri).not.toContainEqual([4, 4]);
  });
  it('flood fills 4-connected same key only', () => {
    const g = ['aab', 'abb', 'aaa'];
    const pts = floodRegion(3, 3, 0, 0, (x, y) => g[y][x]);
    expect(key(pts)).toEqual(key([[0, 0], [1, 0], [0, 1], [0, 2], [1, 2], [2, 2]]));
  });
  it('clips regions to the grid', () => {
    expect(regionPts({ x: -1, y: -1, w: 3, h: 3 }, 5, 5)).toHaveLength(4);
  });
  it('polygon matches the brute-force reference on random shapes', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return (seed % (2 * n + 1)) - n; };
    for (let t = 0; t < 200; t++) {
      const pts = Array.from({ length: 3 + (t % 5) }, () => [rnd(12), rnd(12)] as [number, number]);
      for (const fill of [true, false]) expect(key(polygonPts(pts, fill))).toEqual(key(polygonRef(pts, fill)));
    }
  });
  it('clip keeps only in-grid points and counts the rest', () => {
    const pts: [number, number][] = [[-3, -2], [9, 1], [4, 12], [-1, 6]];
    const ref = polygonRef(pts, true);
    const clip = { cols: 5, rows: 5, outside: 0 };
    const got = polygonPts(pts, true, clip);
    const inGrid = ref.filter(([x, y]) => x >= 0 && y >= 0 && x < 5 && y < 5);
    expect(key(got)).toEqual(key(inGrid));
    expect(clip.outside).toBe(ref.length - inGrid.length);
    const rc = { cols: 5, rows: 5, outside: 0 };
    expect(rectPts(3, 3, 4, 4, true, rc)).toHaveLength(4);
    expect(rc.outside).toBe(12);
    const ec = { cols: 3, rows: 3, outside: 0 };
    const e = ellipsePts(0, 0, 5, 5, true, ec);
    expect(e.length + ec.outside).toBe(ellipsePts(0, 0, 5, 5, true).length);
  });
});
