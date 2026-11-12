import { deltaE00, rgbToLab, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

/** 原圖上的矩形（像素） */
export type PixelRect = { x: number; y: number; w: number; h: number };
export type ImportOpts = {
  cols: number; rows: number; margin: number; allowed: PaletteEntry[];
  removeBg?: boolean; dither?: boolean;
  /** 去背時另外當成背景的顏色（例如白底外的淡藍天空）；四個角的顏色一定算 */
  bgColors?: [number, number, number][];
  /** 去背的色差容許值（ΔE00，預設 10） */
  bgTolerance?: number;
  /** average：每格平均顏色（預設）；dominant：每格取最多像素對到的色號，不會平均出灰邊 */
  sampling?: 'average' | 'dominant';
  /** 一格裡深色像素佔這個比例以上就整格用深色，讓細線條不會斷（例如 0.2） */
  lineBoost?: number;
  /** 小於這個顆數的同色小區塊併進周圍顏色相近的區塊；跟周圍差很多的小色塊（例如蝴蝶結）與深色小點（瞳孔、細線）保留 */
  cleanup?: number;
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

/** 深色：線條、瞳孔這類要保留的細節 */
const DARK_L = 40;
/** 顏色快取的鍵：每個色版取前 6 bits */
const keyOf = (r: number, g: number, b: number) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);

/** 從圖片外圍（與透明區域）往內，把跟任一背景色相近的像素變透明 */
function removeBackground(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, o: ImportOpts) {
  const at = (i: number) => rgba.subarray(i * 4, i * 4 + 4);
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(at).filter((c) => c[3] >= 128);
  const bgs: Lab[] = [];
  if (corners.length) bgs.push(rgbToLab([0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / corners.length) as [number, number, number]));
  for (const c of o.bgColors ?? []) bgs.push(rgbToLab(c));
  if (!bgs.length) return rgba;
  const tol = o.bgTolerance ?? 10;
  const memo = new Int8Array(1 << 18); // 0 未算、1 是背景、2 不是
  const isBg = (i: number) => {
    const p = at(i);
    const k = keyOf(p[0], p[1], p[2]);
    if (!memo[k]) { const lab = rgbToLab([p[0], p[1], p[2]]); memo[k] = bgs.some((b) => deltaE00(lab, b) < tol) ? 1 : 2; }
    return memo[k] === 1;
  };
  const out = Uint8Array.from(rgba);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (i: number) => { if (!seen[i]) { seen[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] < 128) push(i);
  while (head < tail) {
    const i = queue[head++];
    if (rgba[i * 4 + 3] >= 128) { if (!isBg(i)) continue; out[i * 4 + 3] = 0; }
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < w * h) push(i + w);
  }
  return out;
}

/** 雜點只會併進色差小於這個值的鄰居（ΔE00） */
const SPECK_DE = 30;

/** 同色、上下左右相連、小於 min 顆的區塊，併進周圍顏色相近而且最多的區塊；整塊被空白包圍就刪掉 */
function cleanupSpecks(local: (string | null)[], outW: number, outH: number, min: number, allowed: PaletteEntry[]) {
  const byCode = new Map(allowed.map((e) => [e.code, e]));
  const dark = new Set(allowed.filter((e) => e.lab[0] < DARK_L).map((e) => e.code));
  const seen = new Uint8Array(local.length);
  for (let s = 0; s < local.length; s++) {
    const code = local[s];
    if (seen[s] || code === null) continue;
    const comp = [s]; seen[s] = 1;
    const around = new Map<string | null, number>();
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % outW;
      const nb = [x > 0 ? i - 1 : -1, x < outW - 1 ? i + 1 : -1, i - outW, i + outW];
      for (const j of nb) {
        if (j < 0 || j >= local.length) { around.set(null, (around.get(null) ?? 0) + 1); continue; }
        if (local[j] === code) { if (!seen[j]) { seen[j] = 1; comp.push(j); } }
        else around.set(local[j], (around.get(local[j]) ?? 0) + 1);
      }
    }
    if (comp.length >= min || dark.has(code)) continue;
    const colored = [...around].filter(([c]) => c !== null);
    if (colored.length === 0) { for (const i of comp) local[i] = null; continue; }
    const lab = byCode.get(code)!.lab;
    const near = colored.filter(([c]) => deltaE00(lab, byCode.get(c!)!.lab) < SPECK_DE).sort((a, b) => b[1] - a[1]);
    if (near.length) for (const i of comp) local[i] = near[0][0];
  }
}

export function imageToCells(src: Uint8Array | Uint8ClampedArray, srcW: number, srcH: number, o: ImportOpts): (string | null)[] {
  if (o.allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  if (o.dither && o.sampling === 'dominant') throw new OpError('bad_options', 'dither 只能搭配 sampling: average');
  const prepared = prepare(src, srcW, srcH, o);
  const { w, h } = prepared;
  // 去背只去掉「從外圍連進來」的背景色：被外框圍住的同色區塊（例如白色身體）保留
  const rgba = o.removeBg ? removeBackground(prepared.rgba, w, h, o) : prepared.rgba;
  const availW = Math.max(1, o.cols - 2 * o.margin), availH = Math.max(1, o.rows - 2 * o.margin);
  const scale = Math.min(availW / w, availH / h);
  const outW = Math.max(1, Math.min(availW, Math.round(w * scale)));
  const outH = Math.max(1, Math.min(availH, Math.round(h * scale)));
  const ox = Math.floor((o.cols - outW) / 2), oy = Math.floor((o.rows - outH) / 2);

  // 像素 → 最接近的豆子（快取）；只在 dominant 或 lineBoost 時用到
  const codeMemo = new Map<number, PaletteEntry>();
  const entryOf = (r: number, g: number, b: number) => {
    const k = keyOf(r, g, b);
    let e = codeMemo.get(k);
    if (!e) { e = nearest(rgbToLab([r, g, b]), o.allowed); codeMemo.set(k, e); }
    return e;
  };
  const darkMemo = new Map<number, boolean>();
  const isDark = (r: number, g: number, b: number) => {
    const k = keyOf(r, g, b);
    let d = darkMemo.get(k);
    if (d === undefined) { d = rgbToLab([r, g, b])[0] < DARK_L; darkMemo.set(k, d); }
    return d;
  };

  const samples: ([number, number, number] | null)[] = [];
  const picked: (string | null)[] = []; // dominant／lineBoost 直接決定的色號
  for (let ty = 0; ty < outH; ty++) for (let tx = 0; tx < outW; tx++) {
    const x0 = Math.floor((tx * w) / outW), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / outW));
    const y0 = Math.floor((ty * h) / outH), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / outH));
    let r = 0, g = 0, b = 0, a = 0, n = 0, opaque = 0, darkN = 0;
    let dr = 0, dg = 0, db = 0;
    const votes = new Map<string, number>(), darkVotes = new Map<string, number>();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4, al = rgba[i + 3] / 255;
      r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
      if (rgba[i + 3] < 128) continue;
      opaque++;
      const dk = o.lineBoost ? isDark(rgba[i], rgba[i + 1], rgba[i + 2]) : false;
      if (dk) { darkN++; dr += rgba[i]; dg += rgba[i + 1]; db += rgba[i + 2]; }
      if (o.sampling === 'dominant') {
        const c = entryOf(rgba[i], rgba[i + 1], rgba[i + 2]).code;
        votes.set(c, (votes.get(c) ?? 0) + 1);
        if (dk) darkVotes.set(c, (darkVotes.get(c) ?? 0) + 1);
      }
    }
    if (a / n < 0.5) { samples.push(null); picked.push(null); continue; }
    const top = (m: Map<string, number>) => [...m].sort((p, q) => q[1] - p[1])[0][0];
    if (o.lineBoost && darkN > 0 && darkN / opaque >= o.lineBoost) {
      // 細線：整格用深色
      if (o.sampling === 'dominant') { samples.push(null); picked.push(top(darkVotes)); }
      else { samples.push([dr / darkN, dg / darkN, db / darkN]); picked.push(null); }
      continue;
    }
    if (o.sampling === 'dominant') { samples.push(null); picked.push(top(votes)); continue; }
    samples.push([r / a, g / a, b / a]); picked.push(null);
  }

  const local: (string | null)[] = picked.slice();
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
  if (o.cleanup && o.cleanup > 1) cleanupSpecks(local, outW, outH, o.cleanup, o.allowed);

  const cells: (string | null)[] = Array(o.cols * o.rows).fill(null);
  local.forEach((c, i) => { cells[(oy + Math.floor(i / outW)) * o.cols + ox + (i % outW)] = c; });
  return cells;
}
