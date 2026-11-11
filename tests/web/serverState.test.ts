import { describe, it, expect } from 'vitest';
import { reduceServer, type ClientState } from '../../src/web/lib/serverState';
import { smallDesign } from '../fixtures';

const snap = (current: any) => ({ designs: [{ id: current.id, name: current.name, version: current.version, current: true }], current, palette: [], inventory: {}, checks: { thinChainMin: 4, holeMinNeighbors: 3, minAdjacentDeltaE: 10 }, mcpUrl: 'x' });

describe('reduceServer', () => {
  const d1 = { ...smallDesign(), version: 3 };
  const base: ClientState = { conn: 'online', snapshot: snap(d1) as any };
  it('server state supersedes optimistic preview by version', () => {
    expect(reduceServer(base, { type: 'design', design: { ...d1, version: 4, name: 'new' } }).snapshot!.current!.name).toBe('new');
    expect(reduceServer(base, { type: 'design', design: { ...d1, version: 2, name: 'old' } }).snapshot!.current!.name).toBe(d1.name);
  });
  it('switches to another design when a different id arrives', () => {
    const other = { ...smallDesign(), id: 'other', version: 0, name: '另一個' };
    const s = reduceServer(base, { type: 'design', design: other });
    expect(s.snapshot!.current!.id).toBe('other');
    expect(s.snapshot!.designs.find((x) => x.id === 'other')!.current).toBe(true);
  });
  it('tracks connection state without touching data', () => {
    const s = reduceServer(base, { type: 'conn', conn: 'offline' });
    expect(s.conn).toBe('offline');
    expect(s.snapshot).toBe(base.snapshot);
  });
});
