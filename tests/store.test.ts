import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  writeFileSync(join(dir, 'config/checks.json'), JSON.stringify({ thinChainMin: 5, holeMinNeighbors: 4, holeMaxInset: 1, minAdjacentDeltaE: 10 }));
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
  it('reports undo / redo depth per design', () => {
    const s = mkStore();
    const d = s.create('x', board);
    expect(s.historyDepth(d.id)).toEqual({ undo: 0, redo: 0 });
    s.update(undefined, (x) => applyOps(x, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], s.ctx()).design);
    expect(s.historyDepth(d.id)).toEqual({ undo: 1, redo: 0 });
    s.undo();
    expect(s.historyDepth(d.id)).toEqual({ undo: 0, redo: 1 });
    expect(s.historyDepth('nope')).toEqual({ undo: 0, redo: 0 });
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
  it('saving a snapshot broadcasts the design (same version) so open browsers list it', () => {
    const s = mkStore();
    const d = s.create('x', board);
    const seen: { version: number; snapshots: unknown[] }[] = [];
    s.on('change', (x) => seen.push(x));
    s.snapshot(undefined, '大改前');
    expect(seen).toHaveLength(1);
    expect(seen[0].version).toBe(d.version);
    expect(seen[0].snapshots).toHaveLength(1);
  });
  it('setInventory merges and persists', () => {
    const s = mkStore();
    s.setInventory([{ code: 'A1', owned: true, count: 100 }]);
    s.setInventory([{ code: 'A1', count: 80 }, { code: 'H1', owned: true }]);
    expect(JSON.parse(readFileSync(join(dir, 'data/inventory.json'), 'utf8'))).toEqual({
      A1: { owned: true, count: 80 }, H1: { owned: true, count: 0 },
    });
  });
  it('deductInventory subtracts the active variant usage from owned colors, never below zero', () => {
    const s = mkStore();
    s.create('x', board);
    s.update(undefined, (d) => applyOps(d, [
      { op: 'rect', x: 0, y: 0, w: 3, h: 1, color: 'A1' }, { op: 'rect', x: 0, y: 1, w: 4, h: 1, color: 'B1' },
      { op: 'rect', x: 0, y: 2, w: 2, h: 1, color: 'C1' }, { op: 'rect', x: 0, y: 3, w: 1, h: 1, color: 'T1' },
    ], s.ctx()).design);
    s.setInventory([
      { code: 'A1', owned: true, count: 10 }, { code: 'B1', owned: true, count: 2 },
      { code: 'C1', owned: false, count: 50 }, { code: 'H1', owned: true, count: 7 },
    ]);
    let metas = 0;
    s.on('meta', () => metas++);
    const plan = s.deductInventory(s.get());
    expect(metas).toBe(1);
    expect(s.inventory.A1).toEqual({ owned: true, count: 7 });
    expect(s.inventory.B1).toEqual({ owned: true, count: 0 }); // 不會變負數
    expect(s.inventory.C1).toEqual({ owned: false, count: 50 }); // 未擁有的色號不受影響
    expect(s.inventory.T1).toBeUndefined(); // 透明豆一樣：沒有登記擁有就不動
    expect(s.inventory.H1).toEqual({ owned: true, count: 7 }); // 沒用到的不動
    expect(plan.deducted.map((r) => r.code)).toEqual(['B1', 'A1']);
    expect(plan.skipped.map((r) => r.code)).toEqual(['C1', 'T1']);
    expect(JSON.parse(readFileSync(join(dir, 'data/inventory.json'), 'utf8')).A1).toEqual({ owned: true, count: 7 });
  });
  it('deductInventory treats owned colors with 0 beads as out of stock and does not write or emit when nothing changes', () => {
    const s = mkStore();
    s.create('x', board);
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 3, h: 1, color: 'A1' }], s.ctx()).design);
    s.setInventory([{ code: 'A1', owned: true, count: 0 }]);
    const path = join(dir, 'data/inventory.json');
    writeFileSync(path, '{"marker":1}'); // 有寫入就會被蓋掉
    let metas = 0;
    s.on('meta', () => metas++);
    const plan = s.deductInventory(s.get());
    expect(plan.deducted).toEqual([]);
    expect(plan.outOfStock).toEqual([{ code: 'A1', used: 3 }]);
    expect(metas).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('{"marker":1}');
  });
  it('deductInventory uses the given variant and does not touch design history', () => {
    const s = mkStore();
    s.create('x', board);
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1' }], s.ctx()).design);
    const d = s.get();
    s.update(undefined, (x) => ({ ...x, variants: [...x.variants, { ...structuredClone(x.variants[0]), id: 'v2', name: '二', cells: x.variants[0].cells.map((c) => (c ? 'A2' : c)) }] }));
    s.setInventory([{ code: 'A1', owned: true, count: 5 }, { code: 'A2', owned: true, count: 5 }]);
    const depth = s.historyDepth(d.id);
    const version = s.get().version;
    s.deductInventory(s.get(), 'v2');
    expect(s.inventory.A1.count).toBe(5);
    expect(s.inventory.A2.count).toBe(3);
    expect(s.historyDepth(d.id)).toEqual(depth);
    expect(s.get().version).toBe(version);
    expect(() => s.deductInventory(s.get(), 'v9')).toThrow(/找不到配色版本 v9/);
  });
  it('rejects unknown colors in setInventory', () => {
    expect(() => mkStore().setInventory([{ code: 'ZZ1', owned: true }])).toThrow(/未知色號 ZZ1/);
  });
  it('get without a current design throws', () => {
    expect(() => mkStore().get()).toThrow(/沒有開啟中的作品/);
  });
  it('skips unreadable or invalid design files with a warning instead of failing to start', () => {
    const s = mkStore();
    const d = s.create('好的', board);
    writeFileSync(join(dir, 'data/designs/broken.json'), '{ not json');
    writeFileSync(join(dir, 'data/designs/wrong.json'), JSON.stringify({ id: 'wrong', cols: 2 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const s2 = mkStore();
      expect(s2.list().map((x) => x.id)).toEqual([d.id]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toMatch(/略過/);
    } finally {
      warn.mockRestore();
    }
  });
});
