import { Palette, type PaletteColor, type Inventory } from '../src/core/palette';
import { createDesign, cloneDesign, getVariant, maskFromCells, type Design } from '../src/core/model';

export const FIX_COLORS: PaletteColor[] = [
  { code: 'A1', name: '紅', series: 'A', hex: '#E8434F' },
  { code: 'A2', name: '深紅', series: 'A', hex: '#C9302C' },
  { code: 'A3', name: '粉紅', series: 'A', hex: '#FFC2C7' },
  { code: 'A4', name: '近紅', series: 'A', hex: '#E64652' },
  { code: 'B1', name: '黃', series: 'B', hex: '#FFE066' },
  { code: 'C1', name: '藍', series: 'C', hex: '#2E7EC4' },
  { code: 'H1', name: '白', series: 'H', hex: '#FFFFFF' },
  { code: 'H2', name: '黑', series: 'H', hex: '#111111' },
  { code: 'H3', name: '灰', series: 'H', hex: '#A3A19E' },
  { code: 'T1', name: '透明', series: 'T', hex: '#E9F1F3', transparent: true },
];

export const palette = new Palette(FIX_COLORS);

export const invAll: Inventory = Object.fromEntries(
  FIX_COLORS.map((c) => [c.code, { owned: true, count: 1000 }]),
);

export const ctxAll = { palette, inventory: invAll };

export function smallDesign(cols = 10, rows = 10): Design {
  return createDesign({ id: 't', name: '測試', board: { widthMm: cols * 5, heightMm: rows * 5, bead: 5, margin: 1 } });
}

export function paint(d: Design, pts: [number, number, string][], variant?: string): Design {
  const n = cloneDesign(d);
  const v = getVariant(n, variant);
  for (const [x, y, c] of pts) v.cells[y * n.cols + x] = c;
  n.mask = maskFromCells(v.cells);
  for (const o of n.variants) if (o !== v) for (const [x, y, c] of pts) o.cells[y * n.cols + x] = c;
  return n;
}
