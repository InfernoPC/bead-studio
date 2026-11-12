import { describe, it, expect } from 'vitest';
import { DesignSchema, parseDesign } from '../src/core/designSchema';
import { smallDesign, paint } from './fixtures';

const base = () => JSON.parse(JSON.stringify(paint(smallDesign(), [[1, 1, 'A1']])));

describe('DesignSchema', () => {
  it('accepts a valid design', () => {
    const d = base();
    expect(DesignSchema.parse(d)).toEqual(d);
  });
  it('fills missing markers and snapshots with defaults', () => {
    const { markers: _m, snapshots: _s, ...rest } = base();
    const r = DesignSchema.parse(rest);
    expect(r.markers).toEqual([]);
    expect(r.snapshots).toEqual([]);
  });
  it('drops invalid snapshots but keeps valid ones', () => {
    const d = base();
    const { snapshots: _s, ...core } = base();
    d.snapshots = [{ id: 's1', name: 'ok', at: 'now', design: core }, { id: 's2', name: 'bad', at: 'now', design: { cols: 'x' } }];
    expect(DesignSchema.parse(d).snapshots.map((s) => s.id)).toEqual(['s1']);
  });
  it.each([
    ['bad bead', (d: any) => { d.board.bead = 3; }],
    ['non-integer cols', (d: any) => { d.cols = 9.5; }],
    ['cells length', (d: any) => { d.cells.pop(); }],
    ['cell type', (d: any) => { d.cells[0] = 5; }],
    ['missing cells', (d: any) => { delete d.cells; }],
  ])('rejects %s', (_, mutate) => {
    const d = base();
    mutate(d);
    expect(DesignSchema.safeParse(d).success).toBe(false);
  });
  it('rejects the old multi-variant format', () => {
    const old = { id: 'd-1', name: 'x', version: 0, board: { widthMm: 10, heightMm: 10, bead: 5, margin: 0 }, cols: 2, rows: 2,
      mask: '0000', variants: [{ id: 'v1', name: '理想版', paletteMode: 'all', cells: [null, null, null, null] }],
      activeVariant: 'v1', shapeLocked: false, markers: [], snapshots: [] };
    expect(parseDesign(old)).toBeNull();
  });
});
