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
  it('respects stock capacity', () => {
    const rgba = img(3, 1, () => [232, 67, 79, 255]);
    const cells = imageToCells(rgba, 3, 1, { cols: 3, rows: 1, margin: 0, allowed, capacity: new Map([['A1', 1], ['H2', 5]]) });
    expect(cells.filter((c) => c === 'A1')).toHaveLength(1);
  });
  it('preserves aspect ratio', () => {
    const rgba = img(4, 2, () => [17, 17, 17, 255]);
    const cells = imageToCells(rgba, 4, 2, { cols: 4, rows: 4, margin: 0, allowed });
    expect(cells.filter(Boolean)).toHaveLength(8);
  });
});
