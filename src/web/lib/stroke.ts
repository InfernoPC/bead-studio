import { linePts } from '../../core/raster';
import type { Op } from '../../core/opSchema';

export type Cell = [number, number];

/** 把一筆（可能上千格）轉成一個 paste op：bbox 內未觸及的格子為 '.'，畫的格子為 'a'（或 '_' 代表清除） */
export function strokeToPaste(cells: Cell[], color: string | null): Op | null {
  if (cells.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const ch = color ? 'a' : '_';
  const grid = Array.from({ length: y1 - y0 + 1 }, () => Array<string>(x1 - x0 + 1).fill('.'));
  for (const [x, y] of cells) grid[y - y0][x - x0] = ch;
  return { op: 'paste', x: x0, y: y0, rows: grid.map((r) => r.join('')), legend: color ? { a: color } : {} };
}

/** 兩點之間補成連續格子（滑鼠移動很快時避免斷線），用 core linePts */
export function interpolate(a: Cell, b: Cell): Cell[] {
  return linePts(a[0], a[1], b[0], b[1]);
}
