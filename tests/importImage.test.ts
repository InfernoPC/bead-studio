import { describe, it, expect } from 'vitest';
import { imageToCells } from '../src/core/importImage';
import { palette } from './fixtures';

function img(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const a = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(px(x, y), (y * w + x) * 4);
  return a;
}
const allowed = palette.entries(['A1', 'H1', 'H2', 'C1']);

describe('imageToCells', () => {
  it('scales into the area inside the margin and matches colors', () => {
    const rgba = img(2, 2, (x) => (x === 0 ? [232, 67, 79, 255] : [255, 255, 255, 255]));
    const cells = imageToCells(rgba, 2, 2, { cols: 4, rows: 4, margin: 1, allowed });
    expect(cells[1 * 4 + 1]).toBe('A1');
    expect(cells[1 * 4 + 2]).toBe('H1');
    expect(cells[0]).toBeNull();
  });
  it('transparent pixels become empty', () => {
    const rgba = img(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [17, 17, 17, 255]));
    const cells = imageToCells(rgba, 2, 1, { cols: 2, rows: 1, margin: 0, allowed });
    expect(cells).toEqual([null, 'H2']);
  });
  it('removes a uniform background', () => {
    const rgba = img(4, 4, (x, y) => (x > 0 && x < 3 && y > 0 && y < 3 ? [46, 126, 196, 255] : [255, 255, 255, 255]));
    const cells = imageToCells(rgba, 4, 4, { cols: 4, rows: 4, margin: 0, allowed, removeBg: true });
    expect(cells.filter(Boolean)).toEqual(['C1', 'C1', 'C1', 'C1']);
  });
  it('keeps background-colored areas enclosed by an outline', () => {
    // 5×5：白底、深色外框圍住中間一顆白
    const rgba = img(5, 5, (x, y) => {
      const ring = x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
      return ring ? [17, 17, 17, 255] : [255, 255, 255, 255];
    });
    const cells = imageToCells(rgba, 5, 5, { cols: 5, rows: 5, margin: 0, allowed, removeBg: true });
    expect(cells[2 * 5 + 2]).toBe('H1'); // 圍起來的白色身體保留
    expect(cells[0]).toBeNull(); // 外面的背景去掉
    expect(cells.filter(Boolean)).toHaveLength(9);
  });
  it('crops and excludes regions of the source image', () => {
    // 4×2：左半紅、右半藍；只取右半，並把右上角當背景略過
    const rgba = img(4, 2, (x) => (x < 2 ? [232, 67, 79, 255] : [46, 126, 196, 255]));
    const cells = imageToCells(rgba, 4, 2, { cols: 2, rows: 2, margin: 0, allowed, crop: { x: 2, y: 0, w: 2, h: 2 }, exclude: [{ x: 3, y: 0, w: 1, h: 1 }] });
    expect(cells).toEqual(['C1', null, 'C1', 'C1']);
    expect(() => imageToCells(rgba, 4, 2, { cols: 2, rows: 2, margin: 0, allowed, crop: { x: 9, y: 0, w: 2, h: 2 } })).toThrow(/裁切範圍/);
  });
  it('preserves aspect ratio', () => {
    const rgba = img(4, 2, () => [17, 17, 17, 255]);
    const cells = imageToCells(rgba, 4, 2, { cols: 4, rows: 4, margin: 0, allowed });
    expect(cells.filter(Boolean)).toHaveLength(8);
  });
  it('removeBg also removes extra background colors reachable from the border', () => {
    // 7×7：白底外圈、淡藍天空、黑框圍住的白色身體
    const rgba = img(7, 7, (x, y) => {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (d === 3) return [255, 255, 255, 255];
      if (d === 2) return [199, 232, 250, 255];
      if (d === 1) return [17, 17, 17, 255];
      return [255, 255, 255, 255];
    });
    const base = { cols: 7, rows: 7, margin: 0, allowed, removeBg: true };
    expect(imageToCells(rgba, 7, 7, base).filter(Boolean).length).toBeGreaterThan(9); // 天空沒去掉
    const cells = imageToCells(rgba, 7, 7, { ...base, bgColors: [[199, 232, 250]] });
    expect(cells.filter(Boolean)).toHaveLength(9);
    expect(cells[3 * 7 + 3]).toBe('H1'); // 被框住的白色身體保留
  });
  it('bgTolerance widens what counts as background', () => {
    const rgba = img(3, 1, (x) => (x === 1 ? [17, 17, 17, 255] : x === 0 ? [255, 255, 255, 255] : [235, 235, 228, 255]));
    const tight = imageToCells(rgba, 3, 1, { cols: 3, rows: 1, margin: 0, allowed, removeBg: true, bgTolerance: 2 });
    expect(tight[2]).toBe('H1');
    const loose = imageToCells(rgba, 3, 1, { cols: 3, rows: 1, margin: 0, allowed, removeBg: true, bgTolerance: 15 });
    expect(loose[2]).toBeNull();
  });
  it('dominant sampling takes the most common color instead of averaging', () => {
    // 一格 3×3：5 白 4 紅，平均是粉紅
    const rgba = img(3, 3, (x, y) => (y * 3 + x < 4 ? [232, 67, 79, 255] : [255, 255, 255, 255]));
    const opts = { cols: 1, rows: 1, margin: 0, allowed: palette.entries(['A1', 'A3', 'H1']) };
    expect(imageToCells(rgba, 3, 3, opts)[0]).toBe('A3');
    expect(imageToCells(rgba, 3, 3, { ...opts, sampling: 'dominant' })[0]).toBe('H1');
  });
  it('lineBoost keeps thin dark lines that cover only part of a cell', () => {
    // 一格 5×5，只有一條 1px 黑線（20%）
    const rgba = img(5, 5, (x) => (x === 2 ? [17, 17, 17, 255] : [255, 255, 255, 255]));
    const opts = { cols: 1, rows: 1, margin: 0, allowed };
    expect(imageToCells(rgba, 5, 5, { ...opts, sampling: 'dominant' })[0]).toBe('H1');
    expect(imageToCells(rgba, 5, 5, { ...opts, sampling: 'dominant', lineBoost: 0.2 })[0]).toBe('H2');
    expect(imageToCells(rgba, 5, 5, { ...opts, lineBoost: 0.2 })[0]).toBe('H2'); // average 模式也適用
  });
  it('cleanup merges tiny specks of a similar color but keeps distinct details', () => {
    // 藍底上：一顆深紅（跟紅色底相近→會被併）放在紅底區、一顆黃（跟藍差很多→保留）、一顆黑（深色→保留）
    const rgba = img(6, 5, (x, y) => {
      if (x === 1 && y === 1) return [201, 48, 44, 255]; // A2 深紅
      if (x < 3) return [232, 67, 79, 255]; // A1 紅底
      if (x === 4 && y === 1) return [255, 224, 102, 255]; // B1 黃
      if (x === 4 && y === 3) return [17, 17, 17, 255]; // H2 黑
      return [46, 126, 196, 255]; // C1 藍底
    });
    const cells = imageToCells(rgba, 6, 5, { cols: 6, rows: 5, margin: 0, allowed: palette.entries(['A1', 'A2', 'B1', 'C1', 'H2']), cleanup: 2 });
    expect(cells[1 * 6 + 1]).toBe('A1');
    expect(cells[1 * 6 + 4]).toBe('B1');
    expect(cells[3 * 6 + 4]).toBe('H2');
  });
  it('rejects dither with dominant sampling', () => {
    const rgba = img(1, 1, () => [255, 255, 255, 255]);
    expect(() => imageToCells(rgba, 1, 1, { cols: 1, rows: 1, margin: 0, allowed, sampling: 'dominant', dither: true })).toThrow(/dither/);
  });
});
