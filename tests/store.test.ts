import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignStore } from '../src/server/store';
import { applyOps } from '../src/core/ops';
import { FIX_COLORS } from './fixtures';

let dir: string;
const board = { widthMm: 50, heightMm: 50, bead: 5 as const, margin: 1 };

function mkStore() {
  const s = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  s.load();
  return s;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beads-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  writeFileSync(join(dir, 'config/checks.json'), JSON.stringify({ thinChainMin: 5, holeMinNeighbors: 3, minAdjacentDeltaE: 10 }));
});

describe('DesignStore', () => {
  it('loads palette and checks config; inventory defaults to empty', () => {
    const s = mkStore();
    expect(s.palette.has('A1')).toBe(true);
    expect(s.checks.thinChainMin).toBe(5);
    expect(s.inventory).toEqual({});
  });
  it('creates, persists and reloads designs including current id', () => {
    const s = mkStore();
    const d = s.create('蘑菇', board);
    expect(s.currentId).toBe(d.id);
    expect(existsSync(join(dir, 'data/designs', `${d.id}.json`))).toBe(true);
    const s2 = mkStore();
    expect(s2.list()).toEqual([{ id: d.id, name: '蘑菇', version: 0, current: true }]);
  });
  it('update bumps version, emits change and supports undo/redo', () => {
    const s = mkStore();
    s.create('x', board);
    let changes = 0;
    s.on('change', () => changes++);
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], s.ctx()).design);
    expect(s.get().version).toBe(1);
    expect(s.get().mask[0]).toBe('1');
    s.undo();
    expect(s.get().mask[0]).toBe('0');
    s.redo();
    expect(s.get().mask[0]).toBe('1');
    expect(changes).toBe(3);
  });
  it('undo with empty history throws a friendly error', () => {
    const s = mkStore();
    s.create('x', board);
    expect(() => s.undo()).toThrow(/沒有可以復原/);
  });
  it('snapshots survive reload and can be restored', () => {
    const s = mkStore();
    s.create('x', board);
    const snap = s.snapshot(undefined, '大改前');
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], s.ctx()).design);
    const s2 = mkStore();
    s2.restoreSnapshot(undefined, snap.id);
    expect(s2.get().mask[0]).toBe('0');
    expect(s2.get().snapshots).toHaveLength(1);
  });
  it('setInventory merges and persists', () => {
    const s = mkStore();
    s.setInventory([{ code: 'A1', owned: true, count: 100 }]);
    s.setInventory([{ code: 'A1', count: 80 }, { code: 'H1', owned: true }]);
    expect(JSON.parse(readFileSync(join(dir, 'data/inventory.json'), 'utf8'))).toEqual({
      A1: { owned: true, count: 80 }, H1: { owned: true, count: 0 },
    });
  });
  it('rejects unknown colors in setInventory', () => {
    expect(() => mkStore().setInventory([{ code: 'ZZ1', owned: true }])).toThrow(/未知色號 ZZ1/);
  });
  it('get without a current design throws', () => {
    expect(() => mkStore().get()).toThrow(/沒有開啟中的作品/);
  });
});
