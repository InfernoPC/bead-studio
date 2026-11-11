// 編輯區的純繪製：core drawFlat 加上編輯用的疊加層（留邊外紅框、鏡像、單色／檢查器高亮）
import { getVariant, type Design } from '../../core/model';
import type { Palette } from '../../core/palette';
import { drawFlat, flatLayout } from '../../core/render/draw';
import type { CellFrame } from './bounce';

const FLAT = { pegs: true, rulers: true, guides: true, margin: true, markers: true } as const;
const DIM = 0.45;

/** 從 tokens.css 讀取畫布要用的顏色（元件不寫死色碼）；亮暗主題切換後要重新讀取（見 lib/theme useTheme） */
export type Tokens = {
  alert: string; ink: string; inkSoft: string; inspect: string; dim: string;
  /** 板面配色，傳給 core drawFlat；豆子顏色不在這裡，永遠來自色票 */
  ui: { bg: string; board: string; peg: string; ruler: string; guide: string; rim?: string };
};
export function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    alert: v('--alert'), ink: v('--ink'), inkSoft: v('--ink-soft'), inspect: v('--inspect'), dim: v('--canvas-dim'),
    ui: { bg: v('--canvas-bg'), board: v('--canvas-board'), peg: v('--canvas-peg'), ruler: v('--canvas-ruler'), guide: v('--canvas-guide'), rim: v('--canvas-rim') || undefined },
  };
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

export type BoardOpts = {
  palette: Palette; cell: number; mirror: boolean; tokens: Tokens;
  highlightCode: string | null; highlightCells: [number, number][] | null;
  /** 跳動中的格子（索引為資料座標）：暫時顯示的色號與縮放；見 lib/bounce */
  cellAnim?: Map<number, CellFrame>;
};

/** 畫整張面板（面板座標，呼叫端負責縮放平移的 transform） */
export function drawBoard(ctx: CanvasRenderingContext2D, design: Design, o: BoardOpts): void {
  const d = o.mirror ? mirrored(design) : design;
  const v = getVariant(d);
  const cs = o.cell;
  const { pad } = flatLayout(d, { cell: cs, rulers: true });
  const dx = (i: number) => (o.mirror ? d.cols - 1 - i : i);
  // 跳動中的格子整張一起重畫（不單獨補畫一格），參考線、留邊與打洞記號才不會被蓋掉
  const anim = o.cellAnim?.size ? o.cellAnim : null;
  if (anim) {
    const cells = v.cells.slice();
    const scale = new Map<number, number>();
    for (const [k, f] of anim) {
      const shownK = Math.floor(k / d.cols) * d.cols + dx(k % d.cols);
      cells[shownK] = f.code; scale.set(shownK, f.scale);
    }
    drawFlat(ctx, d, { ...v, cells }, o.palette, { cell: cs, ...FLAT, ui: o.tokens.ui, beadScale: (k) => scale.get(k) ?? 1 });
  } else {
    drawFlat(ctx, d, v, o.palette, { cell: cs, ...FLAT, ui: o.tokens.ui });
  }

  if (o.mirror) {
    // 上方尺規跟著翻轉：第 1 欄在右邊
    ctx.fillStyle = o.tokens.ui.bg; ctx.fillRect(pad, 0, d.cols * cs, pad);
    ctx.fillStyle = o.tokens.ui.ruler; ctx.font = `${Math.max(8, Math.round(Math.min(cs, 18) * 0.6))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < d.cols; i += 5) ctx.fillText(String(i + 1), pad + dx(i) * cs + cs / 2, pad / 2);
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
    ctx.save(); ctx.globalAlpha = DIM; ctx.fillStyle = o.tokens.dim;
    for (let k = 0; k < v.cells.length; k++) {
      if (v.cells[k] === o.highlightCode) continue;
      ctx.fillRect(pad + (k % d.cols) * cs, pad + Math.floor(k / d.cols) * cs, cs, cs);
    }
    ctx.restore();
  }

  // 檢查器高亮：暗化其他格子＋黃圈
  if (o.highlightCells) {
    const keep = new Set(o.highlightCells.map(([x, y]) => y * d.cols + dx(x)));
    ctx.save(); ctx.globalAlpha = DIM; ctx.fillStyle = o.tokens.dim;
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
