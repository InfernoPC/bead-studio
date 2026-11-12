import { OpError, type Pt } from './errors';
import { gradient, outline, shade } from './effects';
import { cloneDesign, countCodes, type DesignCore } from './model';
import { MAX_OPS, OpSchema, type Op } from './opSchema';
import type { Inventory, Palette } from './palette';
import { ellipsePts, floodRegion, linePts, polygonPts, rectPts, regionPts, type Clip } from './raster';
import { unrle } from './textCodec';
import { checkColor, getCell, inGrid, placeCell, setCell, type Work } from './work';

export type OpCtx = { palette: Palette; inventory: Inventory };
export type Summary = { total: number; counts: Record<string, number>; delta: Record<string, number>; clipped: number };

function parseOps(raw: unknown[]): Op[] {
  if (raw.length > MAX_OPS) throw new OpError('bad_op', `一次最多 ${MAX_OPS} 條指令（收到 ${raw.length} 條），請分批送出`);
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
/** 只產生格子內的點；格子外的直接計入 clipped */
function paintClipped(w: Work, color: string, draw: (clip: Clip) => Pt[]) {
  const clip: Clip = { cols: w.cols, rows: w.rows, outside: 0 };
  const pts = draw(clip);
  w.clipped += clip.outside;
  paintPts(w, pts, color);
}

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
    case 'rect': return paintClipped(w, op.color, (c) => rectPts(op.x, op.y, op.w, op.h, op.fill ?? true, c));
    case 'ellipse': return paintClipped(w, op.color, (c) => ellipsePts(op.x, op.y, op.w, op.h, op.fill ?? true, c));
    case 'line': return paintPts(w, linePts(op.x1, op.y1, op.x2, op.y2), op.color);
    case 'polygon': return paintClipped(w, op.color, (c) => polygonPts(op.points, op.fill ?? true, c));
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
      src.forEach(([x, y, c]) => { if (c !== null) placeCell(w, x + op.dx, y + op.dy, c); });
      return;
    }
    case 'mirror': {
      const { x, y, w: rw, h: rh } = op.region;
      const copy = regionPts(op.region, w.cols, w.rows).map(([i, j]) => [i, j, getCell(w, i, j)] as const);
      copy.forEach(([i, j, c]) => {
        const ti = op.axis === 'h' ? x + rw - 1 - (i - x) : i;
        const tj = op.axis === 'v' ? y + rh - 1 - (j - y) : j;
        if (inGrid(w, ti, tj)) w.cells[tj * w.cols + ti] = c; // 既有豆子直接寫入
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
        placeCell(w, x + u, y + v, c);
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

export function applyOps<D extends DesignCore>(design: D, rawOps: unknown[], ctx: OpCtx): { design: D; summary: Summary } {
  const ops = parseOps(rawOps);
  const next = cloneDesign(design);
  const before = countCodes(next.cells);
  const w: Work = {
    cols: next.cols, rows: next.rows, cells: [...next.cells],
    palette: ctx.palette, markers: next.markers.map((m) => ({ ...m })), clipped: 0, opIndex: 0,
  };
  ops.forEach((op, i) => {
    w.opIndex = i;
    runOp(w, op);
  });
  next.cells = w.cells;
  next.markers = w.markers;

  const counts = countCodes(next.cells);
  const delta: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(counts)])) {
    const dlt = (counts[k] ?? 0) - (before[k] ?? 0);
    if (dlt !== 0) delta[k] = dlt;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { design: next, summary: { total, counts, delta, clipped: w.clipped } };
}
