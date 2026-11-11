// 分格豆盒色票：半透明的分格收納盒，每格依庫存裝 0–3 顆霧面豆，格底標色號與剩餘顆數
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent } from 'react';
import type { Inventory, PaletteColor } from '../../core/palette';
import { drawBeadFlat } from '../../core/render/draw';
import { readTokens } from '../lib/boardRender';
import type { EditorAction } from '../lib/editorState';
import { useTheme } from '../lib/theme';
import { traySlots, type TrayFilter, type TraySlot } from '../lib/trayModel';

/* ---------- 豆子繪製（與編輯區同一支 drawBeadFlat；顏色永遠來自色票） ---------- */

/** 畫豆子要用的主題值：暗色描邊（與編輯區相同）、落影、透明豆的顯示色 */
type BeadInk = { rim?: string; shadow: string; clear: string };

export function useBeadInk(): BeadInk {
  const theme = useTheme();
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      rim: readTokens().ui.rim,
      shadow: s.getPropertyValue('--tray-bead-shadow').trim(),
      clear: s.getPropertyValue('--bead-clear').trim(),
    };
  }, [theme]);
}

type Spot = { x: number; y: number };
/** 格子裡豆子的位置（以半徑為單位，相對於中心）；後面的先畫，前面的蓋上去 */
const PILES: Spot[][] = [
  [],
  [{ x: 0, y: 0.1 }],
  [{ x: 0.62, y: -0.2 }, { x: -0.6, y: 0.28 }],
  [{ x: 0.05, y: -0.55 }, { x: 0.78, y: 0.32 }, { x: -0.72, y: 0.38 }],
];

/** 由色號得到穩定的小偏移，讓每格的豆子看起來是隨手倒進去的，但每次重畫都一樣 */
function jitter(code: string, k: number): Spot {
  let h = 2166136261;
  for (const ch of code + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return { x: ((h & 255) / 255 - 0.5) * 0.24, y: (((h >>> 8) & 255) / 255 - 0.5) * 0.2 };
}

function useCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
  }, [w, h, ...deps]);
  return ref;
}

function paintBead(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, hex: string, transparent: boolean, ink: BeadInk) {
  // 落影：豆子躺在格子底，往右下略偏
  ctx.fillStyle = ink.shadow;
  ctx.beginPath(); ctx.arc(x + R * 0.08, y + R * 0.2, R * 1.02, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  if (transparent) ctx.globalAlpha = 0.82;
  drawBeadFlat(ctx, x, y, R, transparent ? ink.clear : hex, ink.rim);
  ctx.restore();
}

/** 單顆豆（目前顏色、最近用過、用量列） */
export function BeadDot({ hex, size, transparent = false, ink }: { hex: string; size: number; transparent?: boolean; ink: BeadInk }) {
  const ref = useCanvas(size, size, (ctx) => paintBead(ctx, size / 2, size / 2 - size * 0.04, size * 0.4, hex, transparent, ink),
    [hex, transparent, ink]);
  return <canvas ref={ref} className="bead-dot" style={{ width: size, height: size }} aria-hidden="true" />;
}

const PILE_W = 40, PILE_H = 31, PILE_R = 8.6;

/** 格子裡的豆子堆（level ≥ 1 才有 canvas；空格由 Compartment 放同尺寸的空位） */
function Pile({ slot, ink }: { slot: TraySlot; ink: BeadInk }) {
  const ref = useCanvas(PILE_W, PILE_H, (ctx) => {
    PILES[slot.level].forEach((p, k) => {
      const j = jitter(slot.code, k);
      paintBead(ctx, PILE_W / 2 + (p.x + j.x) * PILE_R, PILE_H / 2 + (p.y + j.y) * PILE_R, PILE_R, slot.hex, slot.transparent, ink);
    });
  }, [slot.level, slot.hex, slot.code, slot.transparent, ink]);
  return <canvas ref={ref} className="tray-pile" style={{ width: PILE_W, height: PILE_H }} aria-hidden="true" />;
}

/* ---------- 豆盒 ---------- */

const COLS = 6;
const FILTERS: { value: TrayFilter; label: string }[] = [
  { value: 'all', label: '全部 MARD' }, { value: 'owned', label: '我有的' }, { value: 'stock', label: '有庫存' },
];

/** 一格：上方豆子堆（沒有的顏色是空的，滑過或聚焦時浮出一顆淡淡的示意豆），
 *  下方像收納盒貼紙的色條＋色號＋顆數。色條顏色是色票資料（每一格都有，沒有的顏色也看得到長相） */
const Compartment = memo(function Compartment({ slot: s, selected, tabbable, ink }: { slot: TraySlot; selected: boolean; tabbable: boolean; ink: BeadInk }) {
  const swatch = { '--swatch': s.hex } as CSSProperties;
  return (
    <div
      role="option" data-code={s.code} aria-selected={selected} aria-label={slotLabel(s)}
      title={`${s.code} ${s.name}`} tabIndex={tabbable ? 0 : -1}
      className={`tray-slot${s.owned ? '' : ' is-missing'}`} style={swatch}
    >
      {s.transparent && <span className="tray-tag">透明</span>}
      {s.level > 0 ? <Pile slot={s} ink={ink} /> : (
        <span className="tray-pile-empty" style={{ width: PILE_W, height: PILE_H }} aria-hidden="true">
          {!s.owned && <span className={`tray-ghost${s.transparent ? ' is-clear' : ''}`} />}
        </span>
      )}
      <span className={`tray-swatch${s.transparent ? ' is-clear' : ''}`} data-testid="tray-swatch" aria-hidden="true" />
      <span className="tray-code">{s.code}</span>
      <span className="tray-count num">{s.owned ? s.count : '\u00a0'}</span>
    </div>
  );
});

function slotLabel(s: TraySlot): string {
  const kind = s.transparent ? '，透明' : '';
  const stock = !s.owned ? '沒有這個顏色' : `庫存 ${s.count} 顆`;
  return `${s.code} ${s.name}${kind}，${stock}`;
}

type Props = {
  palette: PaletteColor[]; inventory: Inventory;
  color: string | null; recent: string[]; dispatch: Dispatch<EditorAction>;
};

export const BeadTray = memo(function BeadTray({ palette, inventory, color, recent, dispatch }: Props) {
  const ink = useBeadInk();
  const [filter, setFilter] = useState<TrayFilter>('all');
  const [query, setQuery] = useState('');
  const slots = useMemo(() => traySlots(palette, inventory, filter, query), [palette, inventory, filter, query]);
  const byCode = useMemo(() => new Map(palette.map((p) => [p.code, p])), [palette]);
  const pick = (code: string) => dispatch({ type: 'pickColor', code });

  // 鍵盤：格子間只有一個 tab 停點（roving tabindex），方向鍵移動
  const gridRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const tabCode = [cursor, color].find((c) => c && slots.some((s) => s.code === c)) ?? slots[0]?.code;
  const focusSlot = (code: string) => {
    setCursor(code);
    gridRef.current?.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`)?.focus();
  };
  // 事件委派到整個盒子：格子本身不帶 handler，memo 後只有變動的格子會重畫
  const slotIndex = (t: EventTarget) => {
    const code = (t as HTMLElement).closest<HTMLElement>('[role="option"]')?.dataset.code;
    return code ? slots.findIndex((s) => s.code === code) : -1;
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const i = slotIndex(e.target);
    if (i >= 0) { setCursor(slots[i].code); pick(slots[i].code); }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = slotIndex(e.target);
    if (i < 0) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
    if (e.key in step) {
      const n = i + step[e.key];
      if (n >= 0 && n < slots.length) focusSlot(slots[n].code);
      e.preventDefault();
    } else if (e.key === 'Home' || e.key === 'End') {
      focusSlot(slots[e.key === 'Home' ? 0 : slots.length - 1].code);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      pick(slots[i].code);
      e.preventDefault();
    }
  };

  // 從別處換了顏色（吸管、用量列）時，把那一格捲進盒子的可視範圍
  useEffect(() => {
    const grid = gridRef.current;
    const el = color ? grid?.querySelector<HTMLElement>(`[data-code="${CSS.escape(color)}"]`) : null;
    if (!grid || !el) return;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < grid.scrollTop) grid.scrollTop = top;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
  }, [color]);

  const cur = color ? byCode.get(color) : undefined;
  const curStock = cur ? inventory[cur.code] : undefined;
  const allMatches = filter !== 'all' && query.trim() && slots.length === 0
    ? traySlots(palette, inventory, 'all', query).length : 0;

  return (
    <div className="tray-panel">
      <div className="tray-current" aria-live="polite">
        {cur ? (
          <>
            <BeadDot hex={cur.calibratedHex ?? cur.hex} transparent={!!cur.transparent} size={44} ink={ink} />
            <div className="tray-current-text">
              <div><span className="tray-current-code">{cur.code}</span> {cur.name}</div>
              <div className={`tray-current-stock num${curStock?.owned ? '' : ' is-missing'}`}>
                {curStock?.owned ? `庫存 ${curStock.count} 顆` : '沒有這個顏色'}
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="tray-current-empty" aria-hidden="true" />
            <p className="tray-current-text muted">還沒選顏色。點盒子裡的任一格就能用它畫。</p>
          </>
        )}
      </div>

      <div className="seg" role="group" aria-label="豆盒顯示範圍">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className="seg-btn" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <label className="tray-search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5l4 4" /></svg>
        <input
          type="search" value={query} placeholder="搜尋色號或顏色，例如 A07、紅" aria-label="搜尋色號或顏色"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { setQuery(''); e.stopPropagation(); } }}
        />
      </label>

      <div className="tray">
        {slots.length > 0 ? (
          <div ref={gridRef} className="tray-grid" role="listbox" aria-label="色票豆盒" data-testid="bead-tray" onClick={onClick} onKeyDown={onKey}>
            {slots.map((s) => (
              <Compartment key={s.code} slot={s} selected={s.code === color} tabbable={s.code === tabCode} ink={ink} />
            ))}
            {/* 最後一列補滿空格子，盒子才是完整的方格 */}
            {Array.from({ length: (COLS - (slots.length % COLS)) % COLS }, (_, k) => (
              <div key={`filler-${k}`} className="tray-slot is-filler" aria-hidden="true" />
            ))}
          </div>
        ) : (
          <div className="tray-empty">
            <p>{query.trim() ? `找不到「${query.trim()}」。` : filter === 'stock' ? '還沒有任何有庫存的顏色。' : '還沒有登記任何顏色。'}</p>
            {allMatches > 0 && (
              <button type="button" className="link-btn" onClick={() => setFilter('all')}>改看全部 MARD（{allMatches} 色）</button>
            )}
          </div>
        )}
      </div>

      <div className="tray-recent">
        <span className="tray-recent-label">最近用過</span>
        {recent.length > 0 ? (
          <div className="tray-recent-beads">
            {recent.map((code) => {
              const p = byCode.get(code);
              if (!p) return null;
              return (
                <button key={code} type="button" className="recent-bead" aria-label={`${code} ${p.name}`} title={`${code} ${p.name}`}
                  aria-pressed={code === color} onClick={() => pick(code)}>
                  <BeadDot hex={p.calibratedHex ?? p.hex} transparent={!!p.transparent} size={22} ink={ink} />
                </button>
              );
            })}
          </div>
        ) : <span className="muted">選過的顏色會留在這裡</span>}
      </div>

      <div className="tray-foot">
        <span className="muted num">顯示 {slots.length}／{palette.length} 色</span>
        <a className="link" href="#/inventory">管理庫存</a>
      </div>
    </div>
  );
});
