import { describe, it, expect } from 'vitest';
import { allocate } from '../src/core/allocate';
import { palette } from './fixtures';

const lab = (code: string) => palette.get(code)!.lab;
const allowed = (...codes: string[]) => palette.entries(codes);

describe('allocate', () => {
  it('assigns nearest colors without capacity', () => {
    const m = allocate([{ index: 0, lab: lab('A4') }, { index: 5, lab: lab('H1') }], allowed('A1', 'H1', 'C1'));
    expect(m.get(0)).toBe('A1');
    expect(m.get(5)).toBe('H1');
  });
  it('respects capacity by moving the cheapest cells to next-best colors', () => {
    const targets = [0, 1, 2].map((i) => ({ index: i, lab: lab('A1') }));
    const m = allocate(targets, allowed('A1', 'A2', 'H1'), new Map([['A1', 1], ['A2', 5], ['H1', 5]]));
    const vals = [...m.values()];
    expect(vals.filter((c) => c === 'A1')).toHaveLength(1);
    expect(vals.filter((c) => c === 'A2')).toHaveLength(2);
  });
  it('throws with the missing count when stock is insufficient', () => {
    const targets = [0, 1, 2].map((i) => ({ index: i, lab: lab('A1') }));
    expect(() => allocate(targets, allowed('A1'), new Map([['A1', 1]]))).toThrow(/缺 2 顆/);
  });
  it('throws when no colors are allowed', () => {
    expect(() => allocate([{ index: 0, lab: lab('A1') }], [])).toThrow(/沒有可用的顏色/);
  });
});
