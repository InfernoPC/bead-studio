import { deltaE00, rgbToLab, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

/** 原圖上的矩形（像素） */
export type PixelRect = { x: number; y: number; w: number; h: number };
export type ImportOpts = {
  cols: number; rows: number; margin: number; allowed: PaletteEntry[];
  removeBg?: boolean; dither?: boolean;
  /** 只轉換原圖的這一塊 */
  crop?: PixelRect;
  /** 原圖上要當成背景略過的區塊（例如旁邊的文字）；座標以原圖為準，先於 crop 套用 */
  exclude?: PixelRect[];
};

/** 套用 exclude（變透明）與 crop，回傳新的像素陣列與尺寸 */
function prepare(src: Uint8Array | Uint8ClampedArray, w: number, h: number, o: ImportOpts) {
  let rgba: Uint8Array | Uint8ClampedArray = src;
  if (o.exclude?.length) {
    rgba = Uint8Array.from(src);
    for (const r of o.exclude) {
      for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++)
        for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) rgba[(y * w + x) * 4 + 3] = 0;
    }
  }
  if (!o.crop) return { rgba, w, h };
  const x0 = Math.max(0, o.crop.x), y0 = Math.max(0, o.crop.y);
  const x1 = Math.min(w, o.crop.x + o.crop.w), y1 = Math.min(h, o.crop.y + o.crop.h);
  if (x1 <= x0 || y1 <= y0) throw new OpError('bad_crop', `裁切範圍在圖片外（圖片是 ${w}×${h}）`);
  const cw = x1 - x0, ch = y1 - y0, out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1) * 4), y * cw * 4);
  return { rgba: out, w: cw, h: ch };
}

/** 彩度（a*b* 平面上離灰軸多遠）；低於門檻視為黑白灰 */
const chroma = (lab: Lab) => Math.hypot(lab[1], lab[2]);
const NEUTRAL = 8;

function nearest(lab: Lab, allowed: PaletteEntry[]): PaletteEntry {
  // 灰色（例如線條邊緣的反鋸齒）只對到黑白灰，不要變成淺藍、淺粉這類有顏色的豆子
  const neutrals = chroma(lab) < NEUTRAL ? allowed.filter((e) => chroma(e.lab) < NEUTRAL) : [];
  const pool = neutrals.length ? neutrals : allowed;
  let best = pool[0], bd = Infinity;
  for (const e of pool) { const d = deltaE00(lab, e.lab); if (d < bd) { bd = d; best = e; } }
  return best;
}

export function imageToCells(src: Uint8Array | Uint8ClampedArray, srcW: number, srcH: number, o: ImportOpts): (string | null)[] {
  if (o.allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  const { rgba, w, h } = prepare(src, srcW, srcH, o);
  const availW = Math.max(1, o.cols - 2 * o.margin), availH = Math.max(1, o.rows - 2 * o.margin);
  const scale = Math.min(availW / w, availH / h);
  const outW = Math.max(1, Math.min(availW, Math.round(w * scale)));
  const outH = Math.max(1, Math.min(availH, Math.round(h * scale)));
  const ox = Math.floor((o.cols - outW) / 2), oy = Math.floor((o.rows - outH) / 2);

  const px = (x: number, y: number) => rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4);
  // 背景色取四個角（透明的角不算）
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)].filter((c) => c[3] >= 128);
  const bgLab = corners.length
    ? rgbToLab([0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / corners.length) as [number, number, number])
    : null;

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
    samples.push(rgb);
  }
  // 去背只去掉「從外圍連進來」的背景色：被外框圍住的同色區塊（例如白色身體）保留
  if (o.removeBg && bgLab) {
    const isBg = (i: number) => samples[i] !== null && deltaE00(rgbToLab(samples[i]!), bgLab) < 10;
    const seen = new Uint8Array(samples.length);
    const stack: number[] = [];
    for (let tx = 0; tx < outW; tx++) stack.push(tx, (outH - 1) * outW + tx);
    for (let ty = 0; ty < outH; ty++) stack.push(ty * outW, ty * outW + outW - 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i]) continue;
      seen[i] = 1;
      if (samples[i] !== null && !isBg(i)) continue;
      samples[i] = null;
      const tx = i % outW, ty = Math.floor(i / outW);
      if (tx > 0) stack.push(i - 1);
      if (tx < outW - 1) stack.push(i + 1);
      if (ty > 0) stack.push(i - outW);
      if (ty < outH - 1) stack.push(i + outW);
    }
  }

  const local: (string | null)[] = Array(outW * outH).fill(null);
  if (o.dither) {
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
