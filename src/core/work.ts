import { OpError } from './errors';
import type { Marker } from './model';
import type { Palette } from './palette';

export type Work = {
  cols: number; rows: number;
  cells: (string | null)[];
  allowed: Set<string>;
  palette: Palette;
  markers: Marker[];
  clipped: number;
  opIndex: number;
};

export const inGrid = (w: Work, x: number, y: number) => x >= 0 && y >= 0 && x < w.cols && y < w.rows;

export function getCell(w: Work, x: number, y: number): string | null {
  return inGrid(w, x, y) ? w.cells[y * w.cols + x] : null;
}

export function checkColor(w: Work, code: string): void {
  if (!w.palette.has(code)) throw new OpError('unknown_color', `第 ${w.opIndex} 條指令：未知色號 ${code}`, w.opIndex);
  if (!w.allowed.has(code)) {
    const near = w.palette.nearestIn(code, w.allowed);
    throw new OpError('color_not_allowed', `第 ${w.opIndex} 條指令：色號 ${code} 不在此版本的色彩範圍內，最接近的可用色是 ${near ?? '（無）'}`, w.opIndex);
  }
}

export function setCell(w: Work, x: number, y: number, code: string | null): void {
  if (!inGrid(w, x, y)) { w.clipped++; return; }
  if (code !== null) checkColor(w, code);
  w.cells[y * w.cols + x] = code;
}

/** 搬移既有的豆子（move/rotate/mirror）：不重新檢查色彩範圍，因為庫存可能已經變動 */
export function placeCell(w: Work, x: number, y: number, code: string | null): void {
  if (!inGrid(w, x, y)) { w.clipped++; return; }
  w.cells[y * w.cols + x] = code;
}
