import { describe, it, expect } from 'vitest';
import { DesignSchema } from '../src/core/designSchema';
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
    ['mask length mismatch', (d: any) => { d.mask = d.mask.slice(1); }],
    ['mask chars', (d: any) => { d.mask = d.mask.replace('0', '2'); }],
    ['no variants', (d: any) => { d.variants = []; }],
    ['cells length', (d: any) => { d.variants[0].cells.pop(); }],
    ['cell type', (d: any) => { d.variants[0].cells[0] = 5; }],
    ['missing activeVariant', (d: any) => { d.activeVariant = 'v9'; }],
    ['shapeLocked type', (d: any) => { d.shapeLocked = 'yes'; }],
    ['cells disagree with mask', (d: any) => { d.variants[0].cells[0] = 'A1'; }],
  ])('rejects %s', (_, mutate) => {
    const d = base();
    mutate(d);
    expect(DesignSchema.safeParse(d).success).toBe(false);
  });
});
