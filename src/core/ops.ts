import { matchCodes } from './allocate';
import { OpError, type Pt } from './errors';
import { gradient, outline, shade } from './effects';
import { cloneDesign, countCodes, getVariant, maskFromCells, type Design, type Variant } from './model';
import { OpSchema, type Op } from './opSchema';
import { allowedCodes, stockCapacity, type Inventory, type Palette } from './palette';
import { ellipsePts, floodRegion, linePts, polygonPts, rectPts, regionPts } from './raster';
import { unrle } from './textCodec';
import { checkColor, getCell, inGrid, setCell, type Work } from './work';

export type OpCtx = { palette: Palette; inventory: Inventory };
export type Summary = { variant: string; total: number; counts: Record<string, number>; delta: Record<string, number>; clipped: number };

function parseOps(raw: unknown[]): Op[] {
  return raw.map((r, i) => {
    const res = OpSchema.safeParse(r);
    if (!res.success) {
      const issue = res.error.issues[0];
      throw new OpError('bad_op', `第 ${i} 條指令格式錯誤：${issue.path.join('.') || 'op'} ${issue.message}`, i);
    }
    return res.data;
  });
}

const paintPts = (w: Work, pts: Pt[], color: string) => pts.forEach(([x, y]) => setCell(w, x, y, color));

function runOp(w: Work, op: Op): void {
  switch (op.op) {
    case 'paste':
      op.rows.map((row) => {
        try { return unrle(row, 2048); } catch (e) { throw new OpError('bad_op', `第 ${w.opIndex} 條指令：${(e as Error).message}`, w.opIndex); }
      }).forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        if (ch === '_') return setCell(w, op.x + i, op.y + j, null);
        const code = op.legend[ch];
        if (!code) throw new OpError('bad_legend', `第 ${w.opIndex} 條指令：legend 沒有定義字元「${ch}」`, w.opIndex);
        setCell(w, op.x + i, op.y + j, code);
      }));
      return;
    case 'rect': return paintPts(w, rectPts(op.x, op.y, op.w, op.h, op.fill ?? true), op.color);
    case 'ellipse': return paintPts(w, ellipsePts(op.x, op.y, op.w, op.h, op.fill ?? true), op.color);
    case 'line': return paintPts(w, linePts(op.x1, op.y1, op.x2, op.y2), op.color);
    case 'polygon': return paintPts(w, polygonPts(op.points, op.fill ?? true), op.color);
    case 'fill': {
      if (!inGrid(w, op.x, op.y)) throw new OpError('out_of_bounds', `第 ${w.opIndex} 條指令：起點 (${op.x},${op.y}) 在格子外`, w.opIndex);
      return paintPts(w, floodRegion(w.cols, w.rows, op.x, op.y, (x, y) => String(getCell(w, x, y))), op.color);
    }
    case 'replace_color': {
      checkColor(w, op.to);
      const pts = op.region ? regionPts(op.region, w.cols, w.rows) : regionPts({ x: 0, y: 0, w: w.cols, h: w.rows }, w.cols, w.rows);
      return pts.forEach(([x, y]) => { if (getCell(w, x, y) === op.from) setCell(w, x, y, op.to); });
    }
    case 'clear': return regionPts(op.region, w.cols, w.rows).forEach(([x, y]) => setCell(w, x, y, null));
    case 'move': {
      const src = regionPts(op.region, w.cols, w.rows).map(([x, y]) => [x, y, getCell(w, x, y)] as const);
      src.forEach(([x, y]) => setCell(w, x, y, null));
      src.forEach(([x, y, c]) => { if (c !== null) setCell(w, x + op.dx, y + op.dy, c); });
      return;
    }
    case 'mirror': {
      const { x, y, w: rw, h: rh } = op.region;
      const copy = regionPts(op.region, w.cols, w.rows).map(([i, j]) => [i, j, getCell(w, i, j)] as const);
      copy.forEach(([i, j, c]) => {
        const ti = op.axis === 'h' ? x + rw - 1 - (i - x) : i;
        const tj = op.axis === 'v' ? y + rh - 1 - (j - y) : j;
        if (inGrid(w, ti, tj)) w.cells[tj * w.cols + ti] = c;
      });
      return;
    }
    case 'rotate': {
      const { x, y, w: rw, h: rh } = op.region;
      if (op.turns % 2 === 1 && rw !== rh) throw new OpError('bad_op', `第 ${w.opIndex} 條指令：旋轉 90°/270° 需要正方形範圍`, w.opIndex);
      const copy = regionPts(op.region, w.cols, w.rows).map(([i, j]) => [i - x, j - y, getCell(w, i, j)] as const);
      copy.forEach(([u, v]) => { if (inGrid(w, x + u, y + v)) w.cells[(y + v) * w.cols + x + u] = null; });
      copy.forEach(([u0, v0, c]) => {
        let u = u0, v = v0;
        for (let k = 0; k < op.turns; k++) [u, v] = [rw - 1 - v, u];
        setCell(w, x + u, y + v, c);
      });
      return;
    }
    case 'set_hole': {
      if (!inGrid(w, op.x, op.y)) throw new OpError('out_of_bounds', `第 ${w.opIndex} 條指令：掛孔 (${op.x},${op.y}) 在格子外`, w.opIndex);
      w.markers = w.markers.filter((m) => !(m.type === 'hole' && m.x === op.x && m.y === op.y));
      if (!op.remove) w.markers.push({ type: 'hole', x: op.x, y: op.y });
      return;
    }
    case 'outline': return outline(w, op);
    case 'gradient': return gradient(w, op);
    case 'shade': return shade(w, op);
  }
}

function assertStock(v: Variant, inv: Inventory): void {
  for (const [code, n] of Object.entries(countCodes(v.cells))) {
    const have = inv[code]?.owned ? inv[code].count : 0;
    if (n > have) throw new OpError('stock_exceeded', `版本「${v.name}」的 ${code} 需要 ${n} 顆，庫存只有 ${have} 顆`);
  }
}

export function syncOtherVariants(d: Design, from: Variant, ctx: OpCtx): void {
  for (const o of d.variants) {
    if (o === from) continue;
    const added: number[] = [];
    from.cells.forEach((c, i) => {
      if (c === null) o.cells[i] = null;
      else if (o.cells[i] === null) added.push(i);
    });
    if (added.length === 0) continue;
    let capacity: Map<string, number> | undefined;
    if (o.paletteMode === 'stock') {
      capacity = stockCapacity(ctx.inventory);
      for (const [code, n] of Object.entries(countCodes(o.cells))) capacity.set(code, (capacity.get(code) ?? 0) - n);
    }
    try {
      const allowed = allowedCodes(ctx.palette, ctx.inventory, o.paletteMode);
      const m = matchCodes(added.map((i) => ({ index: i, code: from.cells[i]! })), ctx.palette, allowed, capacity);
      m.forEach((code, i) => { o.cells[i] = code; });
    } catch (e) {
      if (e instanceof OpError) throw new OpError(e.code, `版本「${o.name}」無法補上新增的豆子：${e.message}`);
      throw e;
    }
  }
}

export function applyOps(design: Design, rawOps: unknown[], ctx: OpCtx, variantId?: string): { design: Design; summary: Summary } {
  const ops = parseOps(rawOps);
  const next = cloneDesign(design);
  const v = getVariant(next, variantId);
  const before = countCodes(v.cells);
  const w: Work = {
    cols: next.cols, rows: next.rows, cells: [...v.cells],
    allowed: allowedCodes(ctx.palette, ctx.inventory, v.paletteMode),
    palette: ctx.palette, markers: next.markers.map((m) => ({ ...m })), clipped: 0, opIndex: 0,
  };
  ops.forEach((op, i) => {
    w.opIndex = i;
    const mask = next.shapeLocked ? maskFromCells(w.cells) : '';
    runOp(w, op);
    if (next.shapeLocked) {
      const after = maskFromCells(w.cells);
      if (after !== mask) {
        const cells: Pt[] = [];
        for (let k = 0; k < after.length; k++) if (after[k] !== mask[k]) cells.push([k % w.cols, Math.floor(k / w.cols)]);
        throw new OpError('shape_locked', `形狀已鎖定：第 ${i} 條指令會改變 ${cells.length} 格的有無（例如 (${cells[0][0]},${cells[0][1]})），只能換色`, i, cells);
      }
    }
  });
  v.cells = w.cells;
  next.markers = w.markers;
  if (v.paletteMode === 'stock') assertStock(v, ctx.inventory);
  syncOtherVariants(next, v, ctx);
  next.mask = maskFromCells(v.cells);

  const counts = countCodes(v.cells);
  const delta: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(counts)])) {
    const dlt = (counts[k] ?? 0) - (before[k] ?? 0);
    if (dlt !== 0) delta[k] = dlt;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { design: next, summary: { variant: v.id, total, counts, delta, clipped: w.clipped } };
}
