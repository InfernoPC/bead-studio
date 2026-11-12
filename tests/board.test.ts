import { describe, it, expect } from 'vitest';
import { setBoard } from '../src/core/board';
import { smallDesign, paint } from './fixtures';

const at = (d: ReturnType<typeof smallDesign>, x: number, y: number) => d.cells[y * d.cols + x];

describe('setBoard', () => {
  it('grows the board and keeps content centered', () => {
    const d = paint(smallDesign(10, 10), [[0, 0, 'A1']]);
    const { design, cropped } = setBoard(d, { widthMm: 60, heightMm: 60 }, { keep: 'size' });
    expect(design.cols).toBe(12);
    expect(cropped).toBe(0);
    expect(at(design, 1, 1)).toBe('A1');
  });
  it('refuses to crop without force and leaves design unchanged', () => {
    const d = paint(smallDesign(10, 10), [[0, 0, 'A1']]);
    expect(() => setBoard(d, { widthMm: 40, heightMm: 40 }, { keep: 'size' })).toThrow(/裁掉 1 顆/);
    expect(d.cols).toBe(10);
    const { design, cropped } = setBoard(d, { widthMm: 40, heightMm: 40 }, { keep: 'size', force: true });
    expect(design.cols).toBe(8);
    expect(cropped).toBe(1);
  });
  it('switching bead size keeping cells changes physical size', () => {
    const d = smallDesign(10, 10);
    const { design } = setBoard(d, { bead: 2.6 }, { keep: 'cells' });
    expect(design.cols).toBe(10);
    expect(design.board.widthMm).toBe(26);
  });
  it('switching bead size keeping size resamples', () => {
    const d = paint(smallDesign(10, 10), [[9, 9, 'A1']]);
    const { design } = setBoard(d, { bead: 2.6 }, { keep: 'size' });
    expect(design.cols).toBe(19);
    expect(design.board.widthMm).toBe(50);
    expect(at(design, 18, 18)).toBe('A1');
    expect(at(design, 0, 0)).toBeNull();
  });
  it('moves markers with recentering', () => {
    const d = { ...smallDesign(10, 10), markers: [{ type: 'hole' as const, x: 2, y: 2 }] };
    const { design } = setBoard(d, { widthMm: 60, heightMm: 60 }, { keep: 'size' });
    expect(design.markers).toEqual([{ type: 'hole', x: 3, y: 3 }]);
  });
});
