import { describe, it, expect } from 'vitest';
import { physicalSize } from '../../src/web/components/Preview3D';
import { paint, smallDesign } from '../fixtures';

describe('physicalSize', () => {
  it('uses the content bbox times the 5mm bead size', () => {
    // smallDesign 是 10×10 格、5mm 豆；內容從 (1,2) 到 (4,8)：4 × 7 顆 = 20 × 35 mm
    const d = paint(smallDesign(), [[1, 2, 'A1'], [4, 8, 'H2']]);
    expect(physicalSize(d)).toBe('1:1 實際大小約 2 × 3.5 cm');
  });
  it('falls back to the board size when there are no beads', () => {
    expect(physicalSize(smallDesign(12, 9))).toBe('面板實際大小約 6 × 4.5 cm');
  });
});
