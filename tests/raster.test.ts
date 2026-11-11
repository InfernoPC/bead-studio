import { describe, it, expect } from 'vitest';
import { linePts, rectPts, ellipsePts, polygonPts, floodRegion, regionPts } from '../src/core/raster';

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
});
