import { allocate } from './allocate';
import { deltaE00, rgbToLab, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

export type ImportOpts = {
  cols: number; rows: number; margin: number; allowed: PaletteEntry[];
  capacity?: Map<string, number>; removeBg?: boolean; dither?: boolean;
};

function nearest(lab: Lab, allowed: PaletteEntry[]): PaletteEntry {
  let best = allowed[0], bd = Infinity;
  for (const e of allowed) { const d = deltaE00(lab, e.lab); if (d < bd) { bd = d; best = e; } }
  return best;
}

export function imageToCells(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, o: ImportOpts): (string | null)[] {
  if (o.allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  const availW = Math.max(1, o.cols - 2 * o.margin), availH = Math.max(1, o.rows - 2 * o.margin);
  const scale = Math.min(availW / w, availH / h);
  const outW = Math.max(1, Math.min(availW, Math.round(w * scale)));
  const outH = Math.max(1, Math.min(availH, Math.round(h * scale)));
  const ox = Math.floor((o.cols - outW) / 2), oy = Math.floor((o.rows - outH) / 2);

  const px = (x: number, y: number) => rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4);
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const bgLab = rgbToLab([0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4) as [number, number, number]);

  const samples: ([number, number, number] | null)[] = [];
  for (let ty = 0; ty < outH; ty++) for (let tx = 0; tx < outW; tx++) {
    const x0 = Math.floor((tx * w) / outW), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / outW));
    const y0 = Math.floor((ty * h) / outH), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / outH));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = px(x, y), al = p[3] / 255;
      r += p[0] * al; g += p[1] * al; b += p[2] * al; a += al; n++;
    }
    if (a / n < 0.5) { samples.push(null); continue; }
    const rgb: [number, number, number] = [r / a, g / a, b / a];
    if (o.removeBg && deltaE00(rgbToLab(rgb), bgLab) < 10) { samples.push(null); continue; }
    samples.push(rgb);
  }

  const local: (string | null)[] = Array(outW * outH).fill(null);
  if (o.capacity) {
    const targets = samples.flatMap((s, i) => (s ? [{ index: i, lab: rgbToLab(s) }] : []));
    allocate(targets, o.allowed, o.capacity).forEach((code, i) => { local[i] = code; });
  } else if (o.dither) {
    const buf = samples.map((s) => (s ? [...s] : null));
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i];
      if (!s) continue;
      const clamped = s.map((c) => Math.max(0, Math.min(255, c))) as [number, number, number];
      const e = nearest(rgbToLab(clamped), o.allowed);
      local[i] = e.code;
      const err = [0, 1, 2].map((k) => clamped[k] - e.rgb[k]);
      const cx = i % outW, cy = Math.floor(i / outW);
      // Floyd-Steinberg: right, below-left, below, below-right (explicit bounds, no row wrap)
      const spread: [number, number, number][] = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
      for (const [dx, dy, f] of spread) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= outW || ny >= outH) continue;
        const nb = buf[ny * outW + nx];
        if (!nb) continue;
        for (let k = 0; k < 3; k++) nb[k] += err[k] * f;
      }
    }
  } else {
    samples.forEach((s, i) => { if (s) local[i] = nearest(rgbToLab(s), o.allowed).code; });
  }

  const cells: (string | null)[] = Array(o.cols * o.rows).fill(null);
  local.forEach((c, i) => { cells[(oy + Math.floor(i / outW)) * o.cols + ox + (i % outW)] = c; });
  return cells;
}
