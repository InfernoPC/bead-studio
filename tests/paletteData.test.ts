import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePalette, Palette, type PaletteColor } from '../src/core/palette';
import { deltaE00 } from '../src/core/color';

const colors: PaletteColor[] = JSON.parse(readFileSync('data/palette.json', 'utf8'));

describe('MARD palette data', () => {
  it('is valid', () => {
    expect(validatePalette(colors)).toEqual([]);
  });
  it('covers the full MARD set', () => {
    expect(colors.length).toBe(222);
    const series = new Set(colors.map((c) => c.series));
    for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M']) expect(series.has(s)).toBe(true);
  });
  it('uses Traditional Chinese names', () => {
    for (const c of colors) expect(c.name).not.toMatch(/[黄绿蓝红浅]/);
  });
  it('keeps transparent entries visually distinct from opaque ones', () => {
    const all = new Palette(colors).all();
    for (const t of all.filter((e) => e.transparent))
      for (const o of all.filter((e) => !e.transparent))
        expect(deltaE00(t.lab, o.lab), `${t.code} vs ${o.code}`).toBeGreaterThanOrEqual(3);
  });
  it('uses MARD-style codes', () => {
    for (const c of colors) expect(c.code).toMatch(/^[A-Z]{1,2}\d{1,3}$/);
  });
  it('has at least one transparent bead flagged', () => {
    expect(colors.some((c) => c.transparent)).toBe(true);
  });
});
