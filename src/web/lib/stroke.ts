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

/**
 * 拖曳畫圓：起點與目前格子是外框的兩個角（任何方向都可以）。
 * circle：取較長的一邊做正圓，往指標的方向長；filled：實心，否則只畫外框。
 */
export function ellipseFromDrag(from: Cell, to: Cell, color: string, o: { circle?: boolean; filled?: boolean }): Op {
  let dx = to[0] - from[0], dy = to[1] - from[1];
  if (o.circle) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  return {
    op: 'ellipse', x: Math.min(from[0], from[0] + dx), y: Math.min(from[1], from[1] + dy),
    w: Math.abs(dx) + 1, h: Math.abs(dy) + 1, color, fill: !!o.filled,
  };
}
