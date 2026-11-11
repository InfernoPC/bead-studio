import { describe, it, expect } from 'vitest';
import { strokeToPaste, interpolate, ellipseFromDrag } from '../../src/web/lib/stroke';

describe('strokeToPaste', () => {
  it('strokeToPaste emits a single paste op', () => {
    const cells: [number, number][] = [];
    for (let x = 0; x < 40; x++) for (let y = 0; y < 15; y++) cells.push([x, y]);
    const op: any = strokeToPaste(cells, 'A1');
    expect(op.op).toBe('paste');
    expect(op.rows).toHaveLength(15);
    expect(op.legend).toEqual({ a: 'A1' });
  });
  it('erases with "_" and leaves untouched cells as "."', () => {
    const op: any = strokeToPaste([[2, 3], [4, 3]], null);
    expect(op).toMatchObject({ x: 2, y: 3, rows: ['_._'] });
  });
  it('returns null for an empty stroke', () => {
    expect(strokeToPaste([], 'A1')).toBeNull();
  });
  it('interpolates without gaps', () => {
    expect(interpolate([0, 0], [3, 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
});

describe('ellipseFromDrag', () => {
  it('uses the dragged corners as the bounding box in any direction', () => {
    expect(ellipseFromDrag([5, 2], [1, 8], 'A1', {})).toEqual({ op: 'ellipse', x: 1, y: 2, w: 5, h: 7, color: 'A1', fill: false });
  });
  it('makes a perfect circle with circle: true, growing toward the pointer', () => {
    expect(ellipseFromDrag([5, 5], [2, 9], 'A1', { circle: true })).toEqual({ op: 'ellipse', x: 1, y: 5, w: 5, h: 5, color: 'A1', fill: false });
  });
  it('fills when asked', () => {
    expect(ellipseFromDrag([0, 0], [0, 0], 'B2', { filled: true })).toEqual({ op: 'ellipse', x: 0, y: 0, w: 1, h: 1, color: 'B2', fill: true });
  });
});
