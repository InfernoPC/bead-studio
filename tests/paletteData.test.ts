import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePalette, type PaletteColor } from '../src/core/palette';

const colors: PaletteColor[] = JSON.parse(readFileSync('data/palette.json', 'utf8'));

describe('MARD palette data', () => {
  it('is valid', () => {
    expect(validatePalette(colors)).toEqual([]);
  });
  it('covers the full MARD set', () => {
    expect(colors.length).toBeGreaterThanOrEqual(120);
  });
  it('uses MARD-style codes', () => {
    for (const c of colors) expect(c.code).toMatch(/^[A-Z]{1,2}\d{1,3}$/);
  });
  it('has at least one transparent bead flagged', () => {
    expect(colors.some((c) => c.transparent)).toBe(true);
  });
});
