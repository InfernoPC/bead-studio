// 編輯區的純繪製：core drawFlat 加上編輯用的疊加層（留邊外紅框、鏡像、單色／檢查器高亮）
import { getVariant, type Design } from '../../core/model';
import type { Palette } from '../../core/palette';
import { drawBeadFlat, drawFlat, flatLayout, UI } from '../../core/render/draw';

const FLAT = { pegs: true, rulers: true, guides: true, margin: true, markers: true } as const;
const DIM = 0.35;

/** 從 tokens.css 讀取畫布要用的顏色（元件不寫死色碼） */
export type Tokens = { alert: string; ink: string; inkSoft: string; inspect: string };
export function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return { alert: v('--alert'), ink: v('--ink'), inkSoft: v('--ink-soft'), inspect: v('--inspect') };
}

/** 鏡像檢視用的左右翻轉副本（只用於繪製，資料不變） */
export function mirrored(d: Design): Design {
  const flip = (cells: (string | null)[]) => {
    const out = cells.slice();
    for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) out[j * d.cols + i] = cells[j * d.cols + d.cols - 1 - i];
    return out;
  };
  return {
    ...d,
    variants: d.variants.map((v) => (v.id === d.activeVariant ? { ...v, cells: flip(v.cells) } : v)),
    markers: d.markers.map((m) => ({ ...m, x: d.cols - 1 - m.x })),
  };
}

/**
 * 畫一格：先用面板色蓋掉，再畫釘子或以 scale 倍（以格子中心縮放）畫豆子。
 * Task 8 的跳動動畫用它在 drawFlat 之後重畫動畫中的格子。
 */
export function paintCell(ctx: CanvasRenderingContext2D, pad: number, cell: number, i: number, j: number, hex: string | null, scale: number): void {
  const x = pad + i * cell, y = pad + j * cell;
  ctx.fillStyle = UI.board; ctx.fillRect(x, y, cell, cell);
  const cx = x + cell / 2, cy = y + cell / 2;
  if (!hex) {
    ctx.fillStyle = UI.peg; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, cell * 0.1), 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (scale > 0) drawBeadFlat(ctx, cx, cy, cell * 0.47 * scale, hex);
}

export type BoardOpts = {
  palette: Palette; cell: number; mirror: boolean; tokens: Tokens;
  highlightCode: string | null; highlightCells: [number, number][] | null;
  /** 個別格子的縮放（格子索引為資料座標）；Task 8 使用 */
  cellScale?: Map<number, number>;
};

/** 畫整張面板（面板座標，呼叫端負責縮放平移的 transform） */
export function drawBoard(ctx: CanvasRenderingContext2D, design: Design, o: BoardOpts): void {
  const d = o.mirror ? mirrored(design) : design;
  const v = getVariant(d);
  const cs = o.cell;
  const { pad } = flatLayout(d, { cell: cs, rulers: true });
  drawFlat(ctx, d, v, o.palette, { cell: cs, ...FLAT });
  const dx = (i: number) => (o.mirror ? d.cols - 1 - i : i);

  if (o.mirror) {
    // 上方尺規跟著翻轉：第 1 欄在右邊
    ctx.fillStyle = UI.bg; ctx.fillRect(pad, 0, d.cols * cs, pad);
    ctx.fillStyle = UI.ruler; ctx.font = `${Math.max(8, Math.round(Math.min(cs, 18) * 0.6))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < d.cols; i += 5) ctx.fillText(String(i + 1), pad + dx(i) * cs + cs / 2, pad / 2);
  }

  if (o.cellScale) {
    for (const [idx, s] of o.cellScale) {
      const code = design.variants.find((x) => x.id === design.activeVariant)!.cells[idx];
      paintCell(ctx, pad, cs, dx(idx % d.cols), Math.floor(idx / d.cols), code ? o.palette.get(code)?.displayHex ?? '#FF00FF' : null, s);
    }
  }

  // 超出留邊的豆子：紅框
  const m = d.board.margin;
  if (m > 0) {
    ctx.strokeStyle = o.tokens.alert; ctx.lineWidth = Math.max(1, cs * 0.08);
    for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) {
      if (!v.cells[j * d.cols + i]) continue;
      if (i >= m && j >= m && i < d.cols - m && j < d.rows - m) continue;
      const inset = ctx.lineWidth / 2;
      ctx.strokeRect(pad + i * cs + inset, pad + j * cs + inset, cs - inset * 2, cs - inset * 2);
    }
  }

  // 單色高亮：其他格子暗化
  if (o.highlightCode) {
    ctx.save(); ctx.globalAlpha = DIM; ctx.fillStyle = o.tokens.ink;
    for (let k = 0; k < v.cells.length; k++) {
      if (v.cells[k] === o.highlightCode) continue;
      ctx.fillRect(pad + (k % d.cols) * cs, pad + Math.floor(k / d.cols) * cs, cs, cs);
    }
    ctx.restore();
  }

  // 檢查器高亮：暗化其他格子＋黃圈
  if (o.highlightCells) {
    const keep = new Set(o.highlightCells.map(([x, y]) => y * d.cols + dx(x)));
    ctx.save(); ctx.globalAlpha = DIM; ctx.fillStyle = o.tokens.ink;
    for (let k = 0; k < v.cells.length; k++) {
      if (!keep.has(k)) ctx.fillRect(pad + (k % d.cols) * cs, pad + Math.floor(k / d.cols) * cs, cs, cs);
    }
    ctx.restore();
    ctx.strokeStyle = o.tokens.inspect; ctx.lineWidth = Math.max(1.5, cs * 0.12);
    for (const k of keep) {
      ctx.beginPath();
      ctx.arc(pad + (k % d.cols) * cs + cs / 2, pad + Math.floor(k / d.cols) * cs + cs / 2, cs * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
