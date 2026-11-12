import { describe, it, expect } from 'vitest';
import { describeDesign } from '../src/core/describe';
import { Palette } from '../src/core/palette';
import { createDesign } from '../src/core/model';
import { smallDesign, paint, palette } from './fixtures';

describe('describeDesign', () => {
  it('reports symmetry, color blocks, contrast and a thumbnail', () => {
    const d = paint(smallDesign(), [
      [3, 3, 'H2'], [4, 3, 'H2'], [5, 3, 'H2'], [6, 3, 'H2'],
      [3, 4, 'H2'], [4, 4, 'A1'], [5, 4, 'A1'], [6, 4, 'A4'],
      [3, 5, 'H2'], [4, 5, 'H2'], [5, 5, 'H2'], [6, 5, 'H2'],
    ]);
    const text = describeDesign(d, palette);
    expect(text).toMatch(/尺寸 10×10 格/);
    expect(text).toMatch(/左右對稱 \d+%/);
    expect(text).toMatch(/H2 黑 9 顆 1 塊/);
    expect(text).toMatch(/A1 紅 2 顆 1 塊/);
    expect(text).toMatch(/A1↔A4/);
    expect(text).toMatch(/縮圖/);
  });
  it('handles an empty design', () => {
    expect(describeDesign(smallDesign(), palette)).toMatch(/空白/);
  });
  it('skips the thumbnail instead of emitting ambiguous chars when there are too many colors', () => {
    const hex = (i: number) => `#${(i * 2).toString(16).padStart(2, '0')}${(255 - i).toString(16).padStart(2, '0')}80`;
    const big = new Palette(Array.from({ length: 120 }, (_, i) => ({ code: `X${i}`, name: `色${i}`, series: 'X', hex: hex(i) })));
    const d = createDesign({ id: 't', name: 't', board: { widthMm: 100, heightMm: 100, bead: 5, margin: 0 } });
    d.cells = d.cells.map((_, i) => (i < 120 ? `X${i}` : null));
    const text = describeDesign(d, big);
    expect(text).toMatch(/顏色太多/);
    expect(text).not.toMatch(/縮圖（/);
  });
});
