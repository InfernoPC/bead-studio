import { allocate } from './allocate';
import { cloneDesign, getVariant, type Design } from './model';
import type { OpCtx } from './ops';
import { allowedCodes, stockCapacity, type PaletteMode } from './palette';

export function recolorVariant(d: Design, variantId: string, ctx: OpCtx, opts: { mode?: PaletteMode; from?: string } = {}): Design {
  const next = cloneDesign(d);
  const v = getVariant(next, variantId);
  const src = getVariant(next, opts.from ?? variantId);
  const mode = opts.mode ?? v.paletteMode;
  // transparent colors are never chosen by automatic matching
  const allowed = ctx.palette.entries(allowedCodes(ctx.palette, ctx.inventory, mode)).filter((e) => !e.transparent);
  const targets = src.cells.flatMap((c, i) => (c === null ? [] : [{ index: i, lab: ctx.palette.get(c)!.lab }]));
  const m = allocate(targets, allowed, mode === 'stock' ? stockCapacity(ctx.inventory) : undefined);
  v.cells = src.cells.map((c, i) => (c === null ? null : m.get(i)!));
  v.paletteMode = mode;
  return next;
}

export function createVariant(d: Design, a: { name: string; paletteMode: PaletteMode; from?: string }, ctx: OpCtx): { design: Design; id: string } {
  const next = cloneDesign(d);
  const n = Math.max(0, ...next.variants.map((v) => Number(v.id.slice(1)) || 0)) + 1;
  const id = `v${n}`;
  const from = getVariant(next, a.from);
  next.variants.push({ id, name: a.name, paletteMode: a.paletteMode, cells: [...from.cells] });
  return { design: recolorVariant(next, id, ctx, { mode: a.paletteMode, from: from.id }), id };
}

export function selectVariant(d: Design, id: string): Design {
  getVariant(d, id);
  return { ...cloneDesign(d), activeVariant: id };
}
