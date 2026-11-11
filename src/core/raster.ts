import type { Pt } from './errors';

export function linePts(x1: number, y1: number, x2: number, y2: number): Pt[] {
  const out: Pt[] = [];
  let x = x1, y = y1;
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** 裁切到格子：只回傳格子內的點，格子外的只計數到 outside（不產生點） */
export type Clip = { cols: number; rows: number; outside: number };

/** 依 clip 收集一段水平連續格 [x0, x1]（第 y 列） */
function pushRun(out: Pt[], y: number, x0: number, x1: number, clip?: Clip) {
  let lo = x0, hi = x1;
  if (clip) {
    if (y < 0 || y >= clip.rows) { clip.outside += x1 - x0 + 1; return; }
    lo = Math.max(x0, 0); hi = Math.min(x1, clip.cols - 1);
    clip.outside += (x1 - x0 + 1) - Math.max(0, hi - lo + 1);
  }
  for (let x = lo; x <= hi; x++) out.push([x, y]);
}

export function rectPts(x: number, y: number, w: number, h: number, fill: boolean, clip?: Clip): Pt[] {
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++) {
    if (fill || j === y || j === y + h - 1) pushRun(out, j, x, x + w - 1, clip);
    else { pushRun(out, j, x, x, clip); if (w > 1) pushRun(out, j, x + w - 1, x + w - 1, clip); }
  }
  return out;
}

export function ellipsePts(x: number, y: number, w: number, h: number, fill: boolean, clip?: Clip): Pt[] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const inside = (i: number, j: number) =>
    i >= x && j >= y && i < x + w && j < y + h &&
    ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 <= 1;
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      if (!inside(i, j)) continue;
      if (fill || !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1)) pushRun(out, j, i, i, clip);
    }
  return out;
}

/** 沿 Bresenham 線走一次，回報每列經過的連續 x 範圍 */
function lineRuns(x1: number, y1: number, x2: number, y2: number, run: (y: number, x0: number, x1: number) => void) {
  let x = x1, y = y1, rx0 = x, rx1 = x;
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; run(y, rx0, rx1); y += sy; rx0 = rx1 = x; }
    else { rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); }
  }
  run(y, rx0, rx1);
}

/** 掃描線填色：每列以區間處理，邊線與內部合併去重，超大多邊形也不會逐點展開 */
export function polygonPts(points: Pt[], fill: boolean, clip?: Clip): Pt[] {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rows: [number, number][][] = Array.from({ length: maxY - minY + 1 }, () => []);
  points.forEach((p, k) => {
    const q = points[(k + 1) % points.length];
    lineRuns(p[0], p[1], q[0], q[1], (y, a, b) => rows[y - minY].push([Math.min(a, b), Math.max(a, b)]));
  });
  if (fill) {
    for (let j = minY; j <= maxY; j++) {
      const cross: number[] = [];
      for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
        const [xa, ya] = points[a], [xb, yb] = points[b];
        if ((ya > j) !== (yb > j)) cross.push(((xb - xa) * (j - ya)) / (yb - ya) + xa);
      }
      cross.sort((u, v) => u - v);
      // 整數 i 在內部 ⇔ 大於 i 的交點數為奇數；在 [ceil(c[m-1]), ceil(c[m])-1] 區間內恰有 m 個交點 ≤ i
      for (let m = 0; m < cross.length; m++) {
        if ((cross.length - m) % 2 === 0) continue;
        const lo = m === 0 ? minX : Math.max(minX, Math.ceil(cross[m - 1]));
        const hi = Math.min(maxX, Math.ceil(cross[m]) - 1);
        if (lo <= hi) rows[j - minY].push([lo, hi]);
      }
    }
  }
  const out: Pt[] = [];
  rows.forEach((runs, k) => {
    runs.sort((a, b) => a[0] - b[0]);
    let cur: [number, number] | null = null;
    for (const r of runs) {
      if (cur && r[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], r[1]);
      else { if (cur) pushRun(out, minY + k, cur[0], cur[1], clip); cur = [r[0], r[1]]; }
    }
    if (cur) pushRun(out, minY + k, cur[0], cur[1], clip);
  });
  return out;
}

export function floodRegion(cols: number, rows: number, x: number, y: number, key: (x: number, y: number) => string): Pt[] {
  const target = key(x, y);
  const seen = new Uint8Array(cols * rows);
  const out: Pt[] = [];
  const stack: Pt[] = [[x, y]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= cols || j >= rows || seen[j * cols + i] || key(i, j) !== target) continue;
    seen[j * cols + i] = 1;
    out.push([i, j]);
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return out;
}

export function regionPts(r: { x: number; y: number; w: number; h: number }, cols: number, rows: number): Pt[] {
  return rectPts(r.x, r.y, r.w, r.h, true, { cols, rows, outside: 0 });
}
