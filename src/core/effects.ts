import type { Op, Region, Light } from './opSchema';
import { checkColor, setCell, type Work } from './work';

type OpOf<K extends Op['op']> = Extract<Op, { op: K }>;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS: Record<Light, [number, number]> = {
  tl: [-1, -1], t: [0, -1], tr: [1, -1], l: [-1, 0], r: [1, 0], bl: [-1, 1], b: [0, 1], br: [1, 1],
};

function targetSet(w: Work, target: string, region?: Region): Set<number> {
  const s = new Set<number>();
  w.cells.forEach((c, i) => {
    if (c === null || (target !== 'shape' && c !== target)) return;
    if (region) {
      const x = i % w.cols, y = Math.floor(i / w.cols);
      if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return;
    }
    s.add(i);
  });
  return s;
}

const idxOf = (w: Work, x: number, y: number) => (x >= 0 && y >= 0 && x < w.cols && y < w.rows ? y * w.cols + x : -1);

export function outline(w: Work, op: OpOf<'outline'>): void {
  const T = targetSet(w, op.target);
  const nbs = op.side === 'outer' && op.connect !== 4 ? N8 : N4;
  const hits: number[] = [];
  for (let i = 0; i < w.cells.length; i++) {
    const x = i % w.cols, y = Math.floor(i / w.cols);
    const around = nbs.map(([dx, dy]) => idxOf(w, x + dx, y + dy));
    if (op.side === 'outer' && !T.has(i) && around.some((k) => T.has(k))) hits.push(i);
    if (op.side === 'inner' && T.has(i) && around.some((k) => !T.has(k))) hits.push(i);
  }
  hits.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.color));
}

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

export function gradient(w: Work, op: OpOf<'gradient'>): void {
  op.colors.forEach((c) => checkColor(w, c));
  const T = [...targetSet(w, op.target, op.region)];
  if (T.length === 0) return;
  const pos = T.map((i) => [i % w.cols, Math.floor(i / w.cols)] as const);
  let val: number[];
  if (op.direction === 'radial') {
    const cx = pos.reduce((s, p) => s + p[0], 0) / pos.length, cy = pos.reduce((s, p) => s + p[1], 0) / pos.length;
    val = pos.map(([x, y]) => Math.hypot(x - cx, y - cy));
  } else {
    const deg = op.direction === 'h' ? 0 : op.direction === 'v' ? 90 : op.direction;
    const ux = Math.cos((deg * Math.PI) / 180), uy = Math.sin((deg * Math.PI) / 180);
    val = pos.map(([x, y]) => x * ux + y * uy);
  }
  const lo = Math.min(...val), hi = Math.max(...val), n = op.colors.length;
  T.forEach((i, k) => {
    const t = hi === lo ? 0 : (val[k] - lo) / (hi - lo);
    const [x, y] = pos[k];
    let ci: number;
    if (op.dither) {
      const p = t * (n - 1), base = Math.floor(p), frac = p - base;
      ci = Math.min(n - 1, frac > BAYER[y % 4][x % 4] / 16 + 1 / 32 ? base + 1 : base);
    } else {
      ci = Math.min(n - 1, Math.floor(t * n));
    }
    setCell(w, x, y, op.colors[ci]);
  });
}

export function shade(w: Work, op: OpOf<'shade'>): void {
  checkColor(w, op.highlight);
  checkColor(w, op.shadow);
  const T = targetSet(w, op.target);
  const [dx, dy] = DIRS[op.light];
  const depth = op.depth ?? 1;
  const hi: number[] = [], sh: number[] = [];
  for (const i of T) {
    const x = i % w.cols, y = Math.floor(i / w.cols);
    let lit = false, dark = false;
    for (let k = 1; k <= depth; k++) {
      if (!T.has(idxOf(w, x + dx * k, y + dy * k))) lit = true;
      if (!T.has(idxOf(w, x - dx * k, y - dy * k))) dark = true;
    }
    if (lit && !dark) hi.push(i);
    else if (dark && !lit) sh.push(i);
  }
  hi.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.highlight));
  sh.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.shadow));
}
