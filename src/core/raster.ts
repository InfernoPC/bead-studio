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

export function rectPts(x: number, y: number, w: number, h: number, fill: boolean): Pt[] {
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++)
      if (fill || i === x || j === y || i === x + w - 1 || j === y + h - 1) out.push([i, j]);
  return out;
}

export function ellipsePts(x: number, y: number, w: number, h: number, fill: boolean): Pt[] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const inside = (i: number, j: number) =>
    i >= x && j >= y && i < x + w && j < y + h &&
    ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 <= 1;
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      if (!inside(i, j)) continue;
      if (fill || !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1)) out.push([i, j]);
    }
  return out;
}

export function polygonPts(points: Pt[], fill: boolean): Pt[] {
  const set = new Map<string, Pt>();
  const add = (p: Pt) => set.set(`${p[0]},${p[1]}`, p);
  points.forEach((p, k) => {
    const q = points[(k + 1) % points.length];
    linePts(p[0], p[1], q[0], q[1]).forEach(add);
  });
  if (fill) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    for (let j = Math.min(...ys); j <= Math.max(...ys); j++)
      for (let i = Math.min(...xs); i <= Math.max(...xs); i++) {
        let inside = false;
        for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
          const [xa, ya] = points[a], [xb, yb] = points[b];
          if ((ya > j) !== (yb > j) && i < ((xb - xa) * (j - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) add([i, j]);
      }
  }
  return [...set.values()];
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
  return rectPts(r.x, r.y, r.w, r.h, true).filter(([i, j]) => i >= 0 && j >= 0 && i < cols && j < rows);
}
