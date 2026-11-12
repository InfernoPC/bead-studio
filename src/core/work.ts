import { OpError } from './errors';
import type { Marker } from './model';
import type { Palette } from './palette';

export type Work = {
  cols: number; rows: number;
  cells: (string | null)[];
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
}

export function setCell(w: Work, x: number, y: number, code: string | null): void {
  if (!inGrid(w, x, y)) { w.clipped++; return; }
  if (code !== null) checkColor(w, code);
  w.cells[y * w.cols + x] = code;
}

/** 搬移既有的豆子（move/rotate/mirror）：豆子已經在畫面上，不必再檢查色號 */
export function placeCell(w: Work, x: number, y: number, code: string | null): void {
  if (!inGrid(w, x, y)) { w.clipped++; return; }
  w.cells[y * w.cols + x] = code;
}
