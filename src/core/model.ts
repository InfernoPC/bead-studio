import { OpError } from './errors';
import type { PaletteMode } from './palette';

export type BeadSize = 2.6 | 5;
export type Board = { widthMm: number; heightMm: number; bead: BeadSize; margin: number };
export type Marker = { type: 'hole'; x: number; y: number };
export type Variant = { id: string; name: string; paletteMode: PaletteMode; cells: (string | null)[] };
export type DesignCore = {
  id: string; name: string; version: number; board: Board; cols: number; rows: number;
  mask: string; variants: Variant[]; activeVariant: string; shapeLocked: boolean; markers: Marker[];
};
export type Snapshot = { id: string; name: string; at: string; design: DesignCore };
export type Design = DesignCore & { snapshots: Snapshot[] };

export function gridSize(b: Board) {
  return {
    cols: Math.max(1, Math.floor(b.widthMm / b.bead + 1e-6)),
    rows: Math.max(1, Math.floor(b.heightMm / b.bead + 1e-6)),
  };
}

export function createDesign(a: { id: string; name: string; board: Board }): Design {
  const { cols, rows } = gridSize(a.board);
  return {
    id: a.id, name: a.name, version: 0, board: { ...a.board }, cols, rows,
    mask: '0'.repeat(cols * rows),
    variants: [{ id: 'v1', name: '理想版', paletteMode: 'all', cells: Array(cols * rows).fill(null) }],
    activeVariant: 'v1', shapeLocked: false, markers: [], snapshots: [],
  };
}

export const cloneDesign = (d: Design): Design => structuredClone(d);

export function coreOf(d: Design): DesignCore {
  const { snapshots: _s, ...core } = d;
  return structuredClone(core);
}

export function getVariant(d: Design, id?: string): Variant {
  const want = id ?? d.activeVariant;
  const v = d.variants.find((x) => x.id === want);
  if (!v) throw new OpError('no_variant', `找不到配色版本 ${want}`);
  return v;
}

export function countCodes(cells: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cells) if (c) out[c] = (out[c] ?? 0) + 1;
  return out;
}

export const maskFromCells = (cells: (string | null)[]) => cells.map((c) => (c === null ? '0' : '1')).join('');

export function bbox(d: Design, cells: (string | null)[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  cells.forEach((c, i) => {
    if (c === null) return;
    const x = i % d.cols, y = Math.floor(i / d.cols);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
