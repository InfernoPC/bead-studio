import { describe, it, expect } from 'vitest';
import { strokeToPaste, interpolate } from '../../src/web/lib/stroke';

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
