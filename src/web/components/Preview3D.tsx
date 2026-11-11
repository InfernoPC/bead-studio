// 3D 實體預覽：整個介面唯一用到 3D 的地方（編輯區維持平面）。以 core drawIso 畫霧面圓柱豆，
// 拖曳旋轉、滾輪縮放；「放大」用 <dialog> 全螢幕顯示同一組畫布與控制項，兩邊共用同一份檢視狀態。
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from 'react';
import { bbox, getVariant, type Design } from '../../core/model';
import { Palette, type PaletteColor } from '../../core/palette';
import { drawIso, type IsoOpts } from '../../core/render/draw';
import { readTokens } from '../lib/boardRender';
import { useTheme } from '../lib/theme';

type View = { board: boolean; ironed: boolean; tilt: number; yaw: number; zoom: number };
const INITIAL: View = { board: true, ironed: false, tilt: 40, yaw: 20, zoom: 1 };
const TILT_MAX = 65, ZOOM_MIN = 0.6, ZOOM_MAX = 3;
/** 拖曳一個 CSS 像素轉幾度 */
const DEG_PER_PX = 0.5;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const cm = (mm: number) => (Math.round(mm) / 10).toFixed(1).replace(/\.0$/, '');

/** 1:1 實際大小：有豆子時用內容範圍 × 豆子直徑，沒有豆子時顯示面板尺寸 */
export function physicalSize(d: Design): string {
  const box = bbox(d, getVariant(d).cells);
  if (!box) return `面板實際大小約 ${cm(d.board.widthMm)} × ${cm(d.board.heightMm)} cm`;
  const b = d.board.bead;
  return `1:1 實際大小約 ${cm((box.x1 - box.x0 + 1) * b)} × ${cm((box.y1 - box.y0 + 1) * b)} cm`;
}

function useReducedMotion() {
  const reduced = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reduced.current = mq.matches; };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

type StageProps = { design: Design; palette: Palette; view: View; setView: Dispatch<SetStateAction<View>>; ui: IsoOpts['ui']; testId: string };

/** 一塊正方形畫布：只在設計、檢視或主題變更時重畫（同一影格內的多次變更合併成一次） */
function Stage({ design, palette, view, setView, ui, testId }: StageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [px, setPx] = useState(0); // 正方形邊長（裝置像素）
  const [css, setCss] = useState(0); // 正方形邊長（CSS 像素）
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const side = Math.floor(Math.min(r.width, r.height));
      setCss(side); setPx(Math.round(side * (window.devicePixelRatio || 1)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = useRef(0);
  useEffect(() => {
    if (px <= 0) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      if (c.width !== px) { c.width = px; c.height = px; }
      drawIso(ctx, design, getVariant(design), palette, { size: px, ...view, ui });
    });
    return () => cancelAnimationFrame(frame.current);
  }, [design, palette, view, ui, px]);

  /* ---------- 拖曳＝旋轉；放開後帶一點慣性（減少動畫時不帶） ---------- */
  const drag = useRef<{ id: number; x: number; t: number; v: number } | null>(null);
  const spin = useRef(0);
  const stopSpin = () => { cancelAnimationFrame(spin.current); spin.current = 0; };
  useEffect(() => stopSpin, []);
  const rotate = (deg: number) => setView((v) => ({ ...v, yaw: (v.yaw + deg + 360) % 360 }));

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    stopSpin();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x, dt = Math.max(1, e.timeStamp - g.t);
    g.v = g.v * 0.4 + ((dx * DEG_PER_PX) / dt) * 0.6; // 度／毫秒，平滑過的最近速度
    g.x = e.clientX; g.t = e.timeStamp;
    if (dx) rotate(dx * DEG_PER_PX);
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    drag.current = null;
    // 停住一會兒才放開就不滑
    if (reduced.current || e.timeStamp - g.t > 80 || Math.abs(g.v) < 0.02) return;
    let v = g.v, last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now;
      rotate(v * dt);
      v *= Math.pow(0.93, dt / 16);
      spin.current = Math.abs(v) > 0.005 ? requestAnimationFrame(step) : 0;
    };
    spin.current = requestAnimationFrame(step);
  };

  /* ---------- 滾輪＝縮放（要攔下頁面捲動，所以用非被動的原生監聽） ---------- */
  useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      setView((v) => ({ ...v, zoom: clampZoom(v.zoom * f) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  /* ---------- 鍵盤：方向鍵旋轉／傾斜，＋－縮放 ---------- */
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') rotate(k === 'ArrowLeft' ? -15 : 15);
    else if (k === 'ArrowUp' || k === 'ArrowDown') setView((v) => ({ ...v, tilt: Math.min(TILT_MAX, Math.max(0, v.tilt + (k === 'ArrowUp' ? 5 : -5))) }));
    else if (k === '+' || k === '=' || k === '-') setView((v) => ({ ...v, zoom: clampZoom(v.zoom * (k === '-' ? 1 / 1.2 : 1.2)) }));
    else return;
    e.preventDefault(); e.stopPropagation(); // 不要讓工具列的單鍵快捷鍵也收到
  };

  return (
    <div className="preview-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef} data-testid={testId} className="preview-canvas" tabIndex={0} role="img"
        aria-label="作品的 3D 預覽。拖曳或用左右方向鍵旋轉，上下方向鍵調整傾斜，滾輪或加減鍵縮放。"
        style={{ width: css, height: css }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

type ControlsProps = { view: View; setView: Dispatch<SetStateAction<View>>; idPrefix: string };

function Controls({ view, setView, idPrefix }: ControlsProps) {
  const tiltId = `${idPrefix}-tilt`;
  return (
    <div className="preview-controls">
      <div className="preview-toggles">
        <label className="preview-check">
          <input type="checkbox" checked={view.board} onChange={(e) => { const board = e.target.checked; setView((v) => ({ ...v, board })); }} />
          釘板
        </label>
        <label className="preview-check">
          <input type="checkbox" checked={view.ironed} onChange={(e) => { const ironed = e.target.checked; setView((v) => ({ ...v, ironed })); }} />
          燙後
        </label>
      </div>
      <div className="preview-tilt">
        <label htmlFor={tiltId}>傾斜</label>
        <input
          id={tiltId} type="range" min={0} max={TILT_MAX} step={1} value={view.tilt}
          onChange={(e) => { const tilt = Number(e.target.value); setView((v) => ({ ...v, tilt })); }}
        />
        <output htmlFor={tiltId} className="num">{view.tilt}°</output>
      </div>
    </div>
  );
}

type Props = { design: Design; palette: PaletteColor[] };

export const Preview3D = memo(function Preview3D({ design, palette: colors }: Props) {
  const palette = useMemo(() => new Palette(colors), [colors]);
  const [view, setView] = useState<View>(INITIAL);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  // 底色與板子跟著亮暗主題（重讀 tokens）；豆子顏色永遠來自色票
  const theme = useTheme();
  const ui = useMemo<IsoOpts['ui']>(() => {
    const t = readTokens();
    return { bg: t.ui.bg, board: t.ui.board, peg: t.ui.peg, boardEdge: t.boardEdge, rim: t.ui.rim };
  }, [theme]);
  const size = physicalSize(design);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (expanded && !dlg.open) dlg.showModal();
    // 關閉後焦點回到「放大」：不依賴瀏覽器還原（Safari／macOS Firefox 點按鈕不會讓按鈕取得焦點，會掉到 body）
    if (!expanded && dlg.open) { dlg.close(); expandRef.current?.focus(); }
  }, [expanded]);

  return (
    <div className="preview">
      <Stage design={design} palette={palette} view={view} setView={setView} ui={ui} testId="preview-canvas" />
      <Controls view={view} setView={setView} idPrefix="preview" />
      <div className="preview-foot">
        <p className="preview-size num">{size}</p>
        <button ref={expandRef} type="button" className="btn-quiet" onClick={() => setExpanded(true)}>放大</button>
      </div>

      <dialog
        ref={dialogRef} className="preview-dialog" aria-labelledby="preview-dialog-title"
        onClose={() => { setExpanded(false); expandRef.current?.focus(); }}
        onKeyDown={(e) => {
          // 對話框是 modal：按鍵不往外傳，避免工具列快捷鍵、檢查器的 Esc 取消標示等也跟著反應
          e.stopPropagation();
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); setExpanded(false); }
        }}
      >
        {expanded && (
          <div className="preview-dialog-body">
            <div className="preview-dialog-head">
              <h2 id="preview-dialog-title" className="panel-title">實體預覽</h2>
              <p className="preview-size num">{size}</p>
              <button type="button" className="btn-quiet" onClick={() => setExpanded(false)}>關閉預覽</button>
            </div>
            <Stage design={design} palette={palette} view={view} setView={setView} ui={ui} testId="preview-canvas-large" />
            <Controls view={view} setView={setView} idPrefix="preview-large" />
          </div>
        )}
      </dialog>
    </div>
  );
});
