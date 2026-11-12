import { describe, it, expect } from 'vitest';
import { createDesign, gridSize, countCodes, bbox } from '../src/core/model';
import { smallDesign, paint } from './fixtures';

describe('model', () => {
  it('computes grid from physical size', () => {
    expect(gridSize({ widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 })).toEqual({ cols: 30, rows: 30 });
    expect(gridSize({ widthMm: 50, heightMm: 25, bead: 5, margin: 1 })).toEqual({ cols: 10, rows: 5 });
  });
  it('creates an empty design with a single set of cells', () => {
    const d = createDesign({ id: 'x', name: '測試', board: { widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    expect(d.cells).toEqual(Array(100).fill(null));
    expect(Object.keys(d).sort()).toEqual(['board', 'cells', 'cols', 'id', 'markers', 'name', 'rows', 'snapshots', 'version']);
  });
  it('counts codes and computes bbox', () => {
    const d = paint(smallDesign(), [[2, 3, 'A1'], [5, 4, 'A1'], [4, 4, 'H1']]);
    expect(countCodes(d.cells)).toEqual({ A1: 2, H1: 1 });
    expect(bbox(d, d.cells)).toEqual({ x0: 2, y0: 3, x1: 5, y1: 4 });
    expect(bbox(smallDesign(), smallDesign().cells)).toBeNull();
  });
});
