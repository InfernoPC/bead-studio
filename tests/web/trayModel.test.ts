import { describe, it, expect } from 'vitest';
import type { Inventory, PaletteColor } from '../../src/core/palette';
import { traySlots, usageRows } from '../../src/web/lib/trayModel';

const c = (code: string, name: string, hex = '#808080', extra: Partial<PaletteColor> = {}): PaletteColor =>
  ({ code, name, series: code[0], hex, ...extra });

const palette: PaletteColor[] = [
  c('A10', '黃橙10'), c('A2', '黃橙2'), c('A1', '黃橙1'),
  c('F2', '紅色2', '#FC3D46', { calibratedHex: '#F0404A' }), c('B7', '淺綠'),
  c('T1', '透明', '#DDEBEE', { transparent: true }),
];

describe('traySlots', () => {
  it('maps stock counts to bead levels at the boundaries', () => {
    const inv: Inventory = {
      A1: { owned: true, count: 0 }, A2: { owned: true, count: 1 }, A10: { owned: true, count: 49 },
      F2: { owned: true, count: 50 }, B7: { owned: true, count: 199 }, T1: { owned: true, count: 200 },
    };
    const level = Object.fromEntries(traySlots(palette, inv, 'all', '').map((s) => [s.code, s.level]));
    expect(level).toEqual({ A1: 0, A2: 1, A10: 1, F2: 2, B7: 2, T1: 3 });
  });

  it('gives level 0 to colors that are not owned, whatever the count', () => {
    const [s] = traySlots([c('A1', 'x')], { A1: { owned: false, count: 500 } }, 'all', '');
    expect(s).toMatchObject({ owned: false, level: 0 });
    const [missing] = traySlots([c('A1', 'x')], {}, 'all', '');
    expect(missing).toMatchObject({ owned: false, count: 0, level: 0 });
  });

  it('filters all / owned / stock', () => {
    const inv: Inventory = { A1: { owned: true, count: 0 }, F2: { owned: true, count: 30 }, B7: { owned: false, count: 0 } };
    const codes = (f: 'all' | 'owned' | 'stock') => traySlots(palette, inv, f, '').map((s) => s.code);
    expect(codes('all')).toHaveLength(palette.length);
    expect(codes('owned')).toEqual(['A1', 'F2']);
    expect(codes('stock')).toEqual(['F2']);
  });

  it('sorts codes naturally (A2 before A10)', () => {
    expect(traySlots([c('A10', 'x'), c('A2', 'x'), c('A1', 'x')], {}, 'all', '').map((s) => s.code)).toEqual(['A1', 'A2', 'A10']);
  });

  it('matches codes case-insensitively, by prefix, ignoring leading zeros', () => {
    expect(traySlots(palette, {}, 'all', 'a1').map((s) => s.code)).toEqual(['A1', 'A10']);
    expect(traySlots(palette, {}, 'all', 'f2').map((s) => s.code)).toEqual(['F2']);
    expect(traySlots(palette, {}, 'all', 'A02').map((s) => s.code)).toEqual(['A2']);
    expect(traySlots(palette, {}, 'all', '  A2 ').map((s) => s.code)).toEqual(['A2']);
    // 不是前綴就不算色號比對（「2」不會撈出 A2、F2）
    expect(traySlots(palette, {}, 'all', '2').map((s) => s.code)).toEqual(['A2', 'F2']); // 名稱「黃橙2」「紅色2」
  });

  it('matches color names by substring, listing code-prefix matches first', () => {
    expect(traySlots(palette, {}, 'all', '紅').map((s) => s.code)).toEqual(['F2']);
    expect(traySlots(palette, {}, 'all', '綠').map((s) => s.code)).toEqual(['B7']);
    const named = [c('B1', '黑B'), c('B10', '白'), c('C1', '灰b')];
    // 「b1」是 B1、B10 的色號前綴；名稱不含 b1 → 只有色號
    expect(traySlots(named, {}, 'all', 'b1').map((s) => s.code)).toEqual(['B1', 'B10']);
    // 「b」：色號前綴 B1、B10 在前，名稱含 b 的 C1 在後
    expect(traySlots(named, {}, 'all', 'b').map((s) => s.code)).toEqual(['B1', 'B10', 'C1']);
  });

  it('combines the filter with the search', () => {
    const inv: Inventory = { A1: { owned: true, count: 5 } };
    expect(traySlots(palette, inv, 'stock', 'a1').map((s) => s.code)).toEqual(['A1']);
  });

  it('uses the calibrated hex when present and flags transparent beads', () => {
    const slots = traySlots(palette, {}, 'all', '');
    expect(slots.find((s) => s.code === 'F2')!.hex).toBe('#F0404A');
    expect(slots.find((s) => s.code === 'A1')!.hex).toBe('#808080');
    expect(slots.find((s) => s.code === 'T1')!.transparent).toBe(true);
    expect(slots.find((s) => s.code === 'A1')!.transparent).toBe(false);
  });
});

describe('usageRows', () => {
  it('counts beads per color, most used first, with stock and shortfall', () => {
    const cells = ['A1', 'A1', 'F2', null, 'A1', 'F2', 'B7', null];
    const inv: Inventory = { A1: { owned: true, count: 10 }, F2: { owned: true, count: 1 }, B7: { owned: false, count: 40 } };
    expect(usageRows(cells, inv)).toEqual([
      { code: 'A1', used: 3, stock: 10, short: 0 },
      { code: 'F2', used: 2, stock: 1, short: 1 },
      { code: 'B7', used: 1, stock: 0, short: 1 },
    ]);
  });

  it('breaks ties by natural code order and treats unknown inventory as zero', () => {
    expect(usageRows(['A10', 'A2', 'A10', 'A2'], {})).toEqual([
      { code: 'A2', used: 2, stock: 0, short: 2 },
      { code: 'A10', used: 2, stock: 0, short: 2 },
    ]);
    expect(usageRows([null, null], {})).toEqual([]);
  });
});
