import { createCanvas } from '@napi-rs/canvas';
import { countCodes, getVariant, type Design, type Variant } from '../core/model';
import type { Palette } from '../core/palette';
import { drawBeadFlat, drawFlat, drawIso, flatLayout, UI, type FlatOpts } from '../core/render/draw';

export type View = 'flat' | 'pattern' | '3d' | 'ironed';
type C2D = CanvasRenderingContext2D;

// 'sans-serif' alone has no CJK fallback in @napi-rs/canvas, so list CJK families explicitly.
const FONT = '"PingFang TC", "Heiti TC", "Hiragino Sans GB", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';


function panel(d: Design, v: Variant, p: Palette, view: View, scale: number) {
  if (view === '3d' || view === 'ironed') {
    const size = Math.round(360 * scale);
    return { w: size, h: size, draw: (c: C2D) => drawIso(c, d, v, p, { size, ironed: view === 'ironed' }) };
  }
  const o: FlatOpts = { cell: Math.round((view === 'pattern' ? 26 : 14) * scale), rulers: true, guides: true, margin: true, markers: true, codes: view === 'pattern' };
  const L = flatLayout(d, o);
  if (view === 'flat') return { w: L.w, h: L.h, draw: (c: C2D) => drawFlat(c, d, v, p, o) };
  const counts = Object.entries(countCodes(v.cells)).sort((a, b) => b[1] - a[1]);
  const colW = 150, perRow = Math.max(1, Math.floor(L.w / colW));
  const tableH = Math.ceil(counts.length / perRow) * 22 + 12;
  return {
    w: L.w, h: L.h + tableH,
    draw: (c: C2D) => {
      drawFlat(c, d, v, p, o);
      c.fillStyle = UI.bg; c.fillRect(0, L.h, L.w, tableH);
      c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `13px ${FONT}`;
      counts.forEach(([code, n], k) => {
        const x = 10 + (k % perRow) * colW, y = L.h + 16 + Math.floor(k / perRow) * 22;
        drawBeadFlat(c, x + 7, y, 7, p.get(code)?.displayHex ?? '#FF00FF');
        c.fillStyle = UI.text; c.fillText(`${code} ${p.get(code)?.name ?? ''} ×${n}`, x + 20, y);
      });
    },
  };
}

export async function renderPng(d: Design, p: Palette, opts: { variant?: string; view?: View; scale?: number }): Promise<Buffer> {
  const view = opts.view ?? 'flat', scale = opts.scale ?? 1;
  const vs = opts.variant === 'all' ? d.variants : [getVariant(d, opts.variant)];
  const panels = vs.map((v) => ({ v, ...panel(d, v, p, view, scale) }));
  const title = 24, gap = 16;
  const W = panels.reduce((s, q) => s + q.w, 0) + gap * (panels.length - 1);
  const H = Math.max(...panels.map((q) => q.h)) + title;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as C2D;
  ctx.fillStyle = UI.bg; ctx.fillRect(0, 0, W, H);
  let x = 0;
  for (const q of panels) {
    ctx.save();
    ctx.fillStyle = UI.text; ctx.font = `bold 14px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${q.v.name}（${q.v.paletteMode}）`, x + 6, title / 2);
    ctx.translate(x, title);
    q.draw(ctx);
    ctx.restore();
    x += q.w + gap;
  }
  return canvas.encode('png');
}
