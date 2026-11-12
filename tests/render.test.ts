import { describe, it, expect } from 'vitest';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { renderPng } from '../src/server/render';
import { drawFlat, drawIso, flatLayout, UI, type FlatOpts, type IsoOpts } from '../src/core/render/draw';
import { smallDesign, paint, palette, ctxAll } from './fixtures';

async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { size: [img.width, img.height], rgba: [...ctx.getImageData(x, y, 1, 1).data] };
}

describe('renderPng', () => {
  it('renders a flat view with a red bead where expected', async () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    const png = await renderPng(d, palette, { view: 'flat' });
    const L = flatLayout(d, { cell: 14, rulers: true });
    // 標題列高 24px；豆子中心偏左上一點點（避開中孔）
    const { rgba } = await pixel(png, L.pad + 4, 24 + L.pad + 4);
    expect(rgba[0]).toBeGreaterThan(rgba[1] + 60);
  });
  it('titles the image with the design name', async () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    // 標題列有字：左上角附近有深色像素
    const png = await renderPng(d, palette, { view: 'flat' });
    let dark = false;
    for (let x = 6; x < 60 && !dark; x++) for (let y = 4; y < 20 && !dark; y++) {
      const { rgba } = await pixel(png, x, y);
      if (rgba[0] < 120) dark = true;
    }
    expect(dark).toBe(true);
  });
  it('renders pattern, 3d and ironed views without throwing', async () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'H1']]);
    for (const view of ['pattern', '3d', 'ironed'] as const) {
      const png = await renderPng(d, palette, { view });
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
  });
});

describe('drawFlat theme override', () => {
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  const DARK = { bg: '#30271F', board: '#4A3D32', peg: '#5E4E40', ruler: '#A8957F', guide: 'rgba(241,230,214,0.16)', rim: 'rgba(241,230,214,0.18)' };
  function draw(ui?: FlatOpts['ui']) {
    const d = paint(smallDesign(), [[0, 0, 'H2']]);
    const o: FlatOpts = { cell: 20, rulers: true, pegs: true, ui };
    const L = flatLayout(d, o);
    const c = createCanvas(L.w, L.h);
    const ctx = c.getContext('2d');
    drawFlat(ctx as unknown as CanvasRenderingContext2D, d, palette, o);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    // 豆子 (0,0)：中心偏左上避開中孔；外緣之外一點點（描邊位置）
    return { bg: at(1, 1), board: at(L.pad + 1, L.pad + 1), bead: at(L.pad + 6, L.pad + 6), rim: at(L.pad + 10, L.pad + 0.47 * 20 + 10 + 0.4) };
  }
  it('without an override paints the fixed light UI colours (server export unchanged)', () => {
    const p = draw();
    expect(p.bg).toEqual(hex(UI.bg));
    expect(p.board).toEqual(hex(UI.board));
  });
  it('a dark override recolours the board but keeps bead colours, and only draws a rim when given', () => {
    const light = draw();
    const dark = draw(DARK);
    expect(dark.bg).toEqual(hex(DARK.bg));
    expect(dark.bead).toEqual(light.bead);
    const noRim = draw({ ...DARK, rim: undefined });
    expect(dark.rim).not.toEqual(noRim.rim);
  });
});

describe('drawIso theme override', () => {
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  const DARK = { bg: '#30271F', board: '#4A3D32', boardEdge: '#3B3027', peg: '#5E4E40' };
  function draw(ui?: IsoOpts['ui']) {
    const d = paint(smallDesign(), [[0, 0, 'H2']]);
    const size = 200;
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    drawIso(ctx as unknown as CanvasRenderingContext2D, d, palette, { size, tilt: 0, yaw: 0, ui });
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    // tilt 0、yaw 0 時是正上方俯視：板子置中，(0,0) 的豆子在左上角；中間附近是空格的板面
    const s = (size - 10) / (Math.max(d.cols, d.rows) * 1.45);
    const bead = [size / 2 + (-d.cols / 2 + 0.5) * s, size / 2 + (-d.rows / 2 + 0.5) * s];
    return { bg: at(1, 1), board: at(Math.round(size / 2 + s * 0.15), Math.round(size / 2 + s * 0.15)), bead: at(Math.round(bead[0] - s * 0.3), Math.round(bead[1] - s * 0.3)) };
  }
  it('without an override paints the fixed light background (server export unchanged)', () => {
    const p = draw();
    expect(p.bg).toEqual(hex(UI.bg));
    expect(p.board).toEqual(hex(UI.board));
  });
  it('a dark override recolours background and board but keeps bead colours', () => {
    const light = draw();
    const dark = draw(DARK);
    expect(dark.bg).toEqual(hex(DARK.bg));
    expect(dark.board).toEqual(hex(DARK.board));
    expect(dark.bead).toEqual(light.bead);
  });
});

describe('drawFlat look (燙後／無釘板)', () => {
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  const CS = 20;
  function draw(o: Partial<FlatOpts>) {
    // 兩顆相鄰的紅豆 (0,0)(1,0)；(4,4) 是空格
    const d = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1']]);
    const opts: FlatOpts = { cell: CS, rulers: true, pegs: true, ...o };
    const L = flatLayout(d, opts);
    const c = createCanvas(L.w, L.h);
    const ctx = c.getContext('2d');
    drawFlat(ctx as unknown as CanvasRenderingContext2D, d, palette, opts);
    const at = (x: number, y: number) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const p = L.pad;
    return {
      hole: at(p + CS / 2, p + CS / 2), // 第一顆豆的中心（燙前是中孔）
      body: at(p + CS / 2 - 6, p + CS / 2), // 同一顆豆，中孔外的豆身
      seam: at(p + CS, p + CS / 2), // 兩顆豆的交界
      peg: at(p + 4 * CS + CS / 2, p + 4 * CS + CS / 2), // 空格的釘子
      emptyBoard: at(p + 4 * CS + 2, p + 4 * CS + 2),
    };
  }
  const red = (px: number[]) => px[0] > px[1] + 60;

  it('燙前 draws round beads with a centre hole and a gap between neighbours', () => {
    const p = draw({});
    expect(p.body[0] - p.hole[0]).toBeGreaterThan(30); // 中孔比豆身暗
    expect(red(p.seam)).toBe(false);
  });
  it('燙後 draws fused tiles: no centre hole, neighbours touch', () => {
    const p = draw({ ironed: true });
    expect(Math.abs(p.body[0] - p.hole[0])).toBeLessThan(15);
    expect(red(p.hole)).toBe(true);
    expect(red(p.seam)).toBe(true);
  });
  it('燙後 leaves no gap where four tiles meet, but rounds the outer corners', () => {
    const d = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1'], [0, 1, 'A1'], [1, 1, 'A1']]);
    const opts: FlatOpts = { cell: CS, rulers: true, ironed: true };
    const L = flatLayout(d, opts);
    const c = createCanvas(L.w, L.h);
    const ctx = c.getContext('2d');
    drawFlat(ctx as unknown as CanvasRenderingContext2D, d, palette, opts);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    expect(red(at(L.pad + CS, L.pad + CS))).toBe(true); // 2×2 的正中間
    expect(red(at(L.pad + CS - 1, L.pad + CS - 1))).toBe(true);
    expect(red(at(L.pad, L.pad))).toBe(false); // 外角是圓的
  });
  it('無釘板 paints empty cells with the background and no pegs', () => {
    const on = draw({});
    expect(on.peg).toEqual(hex(UI.peg));
    expect(on.emptyBoard).toEqual(hex(UI.board));
    const off = draw({ board: false });
    expect(off.peg).toEqual(hex(UI.bg));
    expect(off.emptyBoard).toEqual(hex(UI.bg));
  });
});
