import { describe, it, expect } from 'vitest';
import { describeDesign } from '../src/core/describe';
import { smallDesign, paint, palette } from './fixtures';

describe('describeDesign', () => {
  it('reports symmetry, color blocks, contrast and a thumbnail', () => {
    const d = paint(smallDesign(), [
      [3, 3, 'H2'], [4, 3, 'H2'], [5, 3, 'H2'], [6, 3, 'H2'],
      [3, 4, 'H2'], [4, 4, 'A1'], [5, 4, 'A1'], [6, 4, 'A4'],
      [3, 5, 'H2'], [4, 5, 'H2'], [5, 5, 'H2'], [6, 5, 'H2'],
    ]);
    const text = describeDesign(d, undefined, palette);
    expect(text).toMatch(/尺寸 10×10 格/);
    expect(text).toMatch(/左右對稱 \d+%/);
    expect(text).toMatch(/H2 黑 9 顆 1 塊/);
    expect(text).toMatch(/A1 紅 2 顆 1 塊/);
    expect(text).toMatch(/A1↔A4/);
    expect(text).toMatch(/縮圖/);
  });
  it('handles an empty design', () => {
    expect(describeDesign(smallDesign(), undefined, palette)).toMatch(/空白/);
  });
});
