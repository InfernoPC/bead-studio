import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from 'react';
import { getVariant, type Design } from '../../core/model';
import type { Op } from '../../core/opSchema';
import { drawBeadFlat, flatLayout } from '../../core/render/draw';
import { drawBoard, readTokens } from '../lib/boardRender';
import { useTheme } from '../lib/theme';
import { callTool, toolError, type StateSnapshot } from '../lib/api';
import { BounceTracker } from '../lib/bounce';
import { displayDesign, makeCtx, previewOps } from '../lib/clientCore';
import type { EditorAction, EditorState } from '../lib/editorState';
import { interpolate, strokeToPaste, type Cell } from '../lib/stroke';
import { cellAt, zoomAround, type View } from '../lib/viewport';

type Props = {
  snapshot: StateSnapshot; design: Design; editor: EditorState;
  dispatch: Dispatch<EditorAction>; editable: boolean; onNotice(text: string | null): void;
};

const MAX_CELL = 36;
const FIT_GAP = 16;

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** 空白鍵本身有作用的控制項（按鈕、連結、表單欄位等） */
function isControl(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return isTyping(t) || !!t.closest('button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]');
}

type Gesture =
  | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
  | { kind: 'paint'; base: Design; color: string | null; cells: Cell[]; seen: Set<number>; last: Cell | null }
  | { kind: 'line'; base: Design; color: string; from: Cell; to: Cell };

/** 平面編輯區：繪製、縮放平移、繪圖工具。所有修改都透過 callTool 送到伺服器。 */
export function Editor({ snapshot, design, editor, dispatch, editable, onNotice }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  const [view, setViewState] = useState<View>({ cell: 20, pad: 18, offsetX: 0, offsetY: 0, zoom: editor.zoom });
  // 檢視同時放在 ref：連續的滾輪／拖曳事件在重繪之前就要以上一次的結果為基準
  const viewRef = useRef(view);
  const setView = useCallback((next: View | ((v: View) => View)) => {
    const v = typeof next === 'function' ? next(viewRef.current) : next;
    if (v === viewRef.current) return;
    viewRef.current = v;
    setViewState(v);
  }, []);
  const overStage = useRef(false);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<Cell | null>(null);
  // 亮暗主題切換時重讀 tokens；drawNow 跟著變，下方的 effect 就會重畫
  const theme = useTheme();
  const tokens = useMemo(() => readTokens(), [theme]);
  const opCtx = useMemo(() => makeCtx(snapshot), [snapshot.palette, snapshot.inventory]);
  const shown = displayDesign(design, editor.pending) ?? design;

  // 事件處理器裡要讀最新值
  const live = useRef({ view, size, editor, design, shown, editable });
  live.current = { view: viewRef.current, size, editor, design, shown, editable };

  /* ---------- 尺寸與高 DPI ---------- */
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height), dpr: window.devicePixelRatio || 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- 開啟作品或改尺寸時：縮放回 100% 並置中（100% = 剛好放進編輯區） ---------- */
  const fitKey = `${design.id}:${design.cols}x${design.rows}`;
  const ready = size.w > 0 && size.h > 0;
  useLayoutEffect(() => {
    if (!ready) return;
    const { pad } = flatLayout(design, { cell: 1, rulers: true });
    const fit = Math.floor(Math.min((size.w - 2 * pad - 2 * FIT_GAP) / design.cols, (size.h - 2 * pad - 2 * FIT_GAP) / design.rows));
    const cell = Math.max(2, Math.min(MAX_CELL, fit));
    const lay = flatLayout(design, { cell, rulers: true });
    setView({ cell, pad, zoom: 1, offsetX: Math.round((size.w - lay.w) / 2), offsetY: Math.round((size.h - lay.h) / 2) });
    if (live.current.editor.zoom !== 1) dispatch({ type: 'zoom', factor: 1 / live.current.editor.zoom });
  }, [fitKey, ready]);

  /* ---------- 狀態列的縮放按鈕：以編輯區中心縮放 ---------- */
  useEffect(() => {
    setView((v) => (Math.abs(v.zoom - editor.zoom) < 1e-6 ? v : zoomAround(v, editor.zoom / v.zoom, live.current.size.w / 2, live.current.size.h / 2)));
  }, [editor.zoom]);

  /* ---------- 送出完成後，伺服器版本追上就清掉預覽 ---------- */
  useEffect(() => {
    const p = editor.pending;
    if (p && (p.design.id !== design.id || design.version > p.baseVersion)) dispatch({ type: 'clearPreview' });
  }, [design, editor.pending, dispatch]);

  /* ---------- 拖曳中伺服器有新版本（例如 AI 修改）：把這一筆移到新版本上重新預覽 ---------- */
  useEffect(() => {
    const g = gesture.current;
    if (g && g.kind !== 'pan' && rebase(g)) previewGesture(g);
  }, [design]);

  /* ---------- 豆子跳動：畫過去立刻跳，伺服器（AI）更新只有改變的格子以波浪跳 ---------- */
  const [bounce] = useState(() => new BounceTracker());
  const reducedMotion = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reducedMotion.current = mq.matches; };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const g = gesture.current;
    const local = !!editor.pending && shown === editor.pending.design;
    const source = !local ? 'server' : g && g.kind !== 'pan' ? 'stroke' : 'local';
    bounce.update(
      { key: `${shown.id}:${shown.activeVariant}:${shown.cols}x${shown.rows}`, cols: shown.cols, cells: getVariant(shown).cells, mirror: live.current.editor.mirror },
      source, performance.now(), reducedMotion.current,
    );
  }, [shown]);

  /* ---------- 繪製 ---------- */
  const frame = useRef(0);
  const drawNow = useCallback(() => {
    // 直接呼叫時取消已排定的影格，避免兩個重繪迴圈並行
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const c = boardRef.current, { view: vw, size: sz, shown: d, editor: ed } = live.current;
    if (!c || !sz.w) return;
    const cellAnim = bounce.frame(performance.now(), getVariant(d).cells);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = sz.dpr * vw.zoom;
    ctx.setTransform(k, 0, 0, k, sz.dpr * vw.offsetX, sz.dpr * vw.offsetY);
    drawBoard(ctx, d, {
      palette: opCtx.palette, cell: vw.cell, mirror: ed.mirror, tokens,
      highlightCode: ed.highlightCode, highlightCells: ed.highlightCells, cellAnim,
    });
    // 還有格子在跳：下一個影格繼續畫，全部結束就停
    if (bounce.active) frame.current = requestAnimationFrame(drawNow);
  }, [opCtx, tokens, bounce]);
  /** 下一個動畫影格重畫（同一影格內多次呼叫只畫一次） */
  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(drawNow);
  }, [drawNow]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const drawOverlay = useCallback(() => {
    const c = overlayRef.current, { view: vw, size: sz, shown: d, editor: ed } = live.current;
    if (!c || !sz.w) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const h = hover.current;
    if (!h || !live.current.editable || gesture.current?.kind === 'pan') return;
    const k = sz.dpr * vw.zoom;
    ctx.setTransform(k, 0, 0, k, sz.dpr * vw.offsetX, sz.dpr * vw.offsetY);
    const cs = vw.cell;
    const cx = vw.pad + h[0] * cs + cs / 2, cy = vw.pad + h[1] * cs + cs / 2;
    const dataX = ed.mirror ? d.cols - 1 - h[0] : h[0];
    const blocked = isForbidden(d, ed.tool, dataX, h[1]);
    if (ed.tool === 'pen' && ed.color && !blocked) {
      ctx.globalAlpha = 0.6;
      drawBeadFlat(ctx, cx, cy, cs * 0.47, opCtx.palette.get(ed.color)?.displayHex ?? '#FF00FF', tokens.ui.rim);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = Math.max(1, cs * 0.08);
    ctx.strokeStyle = blocked ? tokens.alert : tokens.inkSoft;
    if (ed.tool === 'eraser' || ed.tool === 'hole') ctx.setLineDash([cs * 0.16, cs * 0.12]);
    ctx.beginPath(); ctx.arc(cx, cy, cs * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }, [opCtx, tokens]);

  useEffect(() => {
    for (const c of [boardRef.current, overlayRef.current]) {
      if (!c) continue;
      c.width = Math.round(size.w * size.dpr); c.height = Math.round(size.h * size.dpr);
    }
    drawNow();
    drawOverlay();
  }, [size, drawNow, drawOverlay]);
  useEffect(() => { requestDraw(); drawOverlay(); },
    [shown, view, editor.mirror, editor.highlightCode, editor.highlightCells, requestDraw, drawOverlay]);
  useEffect(() => { drawOverlay(); }, [editor.tool, editor.color, editable, drawOverlay]);

  /* ---------- 送出指令 ---------- */
  const send = useCallback(async (base: Design, ops: Op[]) => {
    const res = await callTool('apply_ops', { designId: base.id, ops });
    // 送出有結果了：還沒等到回聲的自己的格子，過一陣子就不再當成自己的
    if (!gesture.current) bounce.settle(performance.now());
    if (res.ok) onNotice(null);
    else { dispatch({ type: 'clearPreview' }); onNotice(res.text); }
  }, [dispatch, onNotice]);

  const preview = useCallback((base: Design, ops: Op[]) => {
    const next = previewOps(base, ops, opCtx);
    if (next instanceof Error) dispatch({ type: 'clearPreview' });
    else dispatch({ type: 'preview', pending: { baseVersion: base.version, design: next } });
  }, [dispatch, opCtx]);

  const needColor = useCallback(() => {
    onNotice('還沒有目前顏色。先在色票選一個顏色，或用吸管（I）點一顆豆子取色。');
  }, [onNotice]);

  /* ---------- 指標事件 ---------- */
  const pointFrom = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  /** 指標所在的格子（資料座標，鏡像時已翻回） */
  const dataCellAt = (px: number, py: number): Cell | null => {
    const { view: vw, shown: d, editor: ed } = live.current;
    const c = cellAt(px, py, vw, d.cols, d.rows);
    if (!c) return null;
    return ed.mirror ? [d.cols - 1 - c[0], c[1]] : c;
  };

  /** 這一筆的基底落後伺服器時改用最新版本（並重新套用形狀鎖定的過濾）；有改變時回傳 true */
  const rebase = (g: Extract<Gesture, { kind: 'paint' | 'line' }>): boolean => {
    const latest = live.current.design;
    if (latest.id !== g.base.id || latest.version === g.base.version) return false;
    g.base = latest;
    if (g.kind === 'paint') {
      const tool = g.color ? 'pen' : 'eraser';
      g.cells = g.cells.filter((p) => !isForbidden(latest, tool, p[0], p[1]));
    }
    return true;
  };

  const previewGesture = (g: Extract<Gesture, { kind: 'paint' | 'line' }>) => {
    if (g.kind === 'line') { preview(g.base, [lineOp(g.from, g.to, g.color)]); return; }
    const op = strokeToPaste(g.cells, g.color);
    if (op) preview(g.base, [op]);
    else dispatch({ type: 'clearPreview' });
  };

  const addToStroke = (g: Extract<Gesture, { kind: 'paint' }>, c: Cell) => {
    const rebased = rebase(g);
    const path = g.last ? interpolate(g.last, c) : [c];
    g.last = c;
    const tool = g.color ? 'pen' : 'eraser';
    let added = false;
    for (const p of path) {
      const k = p[1] * g.base.cols + p[0];
      if (g.seen.has(k)) continue;
      g.seen.add(k);
      if (isForbidden(g.base, tool, p[0], p[1])) continue;
      g.cells.push(p); added = true;
    }
    if (added || rebased) previewGesture(g);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { px, py } = pointFrom(e);
    const { view: vw, editor: ed, design: base } = live.current;
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      gesture.current = { kind: 'pan', x: px, y: py, ox: vw.offsetX, oy: vw.offsetY };
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      drawOverlay();
      return;
    }
    if (e.button !== 0 || !live.current.editable) return;
    const c = dataCellAt(px, py);
    if (!c) return;
    const [x, y] = c;
    const code = getVariant(base).cells[y * base.cols + x];
    switch (ed.tool) {
      case 'pen': case 'eraser': {
        if (ed.tool === 'pen' && !ed.color) { needColor(); return; }
        if (isForbidden(base, ed.tool, x, y)) return;
        const g: Gesture = { kind: 'paint', base, color: ed.tool === 'pen' ? ed.color : null, cells: [], seen: new Set(), last: null };
        gesture.current = g;
        e.currentTarget.setPointerCapture(e.pointerId);
        addToStroke(g, c);
        return;
      }
      case 'line': {
        if (!ed.color) { needColor(); return; }
        gesture.current = { kind: 'line', base, color: ed.color, from: c, to: c };
        e.currentTarget.setPointerCapture(e.pointerId);
        preview(base, [lineOp(c, c, ed.color)]);
        return;
      }
      case 'fill': {
        if (!ed.color) { needColor(); return; }
        const ops: Op[] = [{ op: 'fill', x, y, color: ed.color }];
        preview(base, ops); void send(base, ops);
        return;
      }
      case 'replace': {
        if (!ed.color) { needColor(); return; }
        if (!code || code === ed.color) return;
        const ops: Op[] = [{ op: 'replace_color', from: code, to: ed.color }];
        preview(base, ops); void send(base, ops);
        return;
      }
      case 'eyedropper':
        if (code) dispatch({ type: 'pickColor', code });
        return;
      case 'hole': {
        const exists = base.markers.some((mk) => mk.x === x && mk.y === y);
        const ops: Op[] = [{ op: 'set_hole', x, y, ...(exists ? { remove: true } : {}) }];
        preview(base, ops); void send(base, ops);
        return;
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    overStage.current = true;
    const { px, py } = pointFrom(e);
    const g = gesture.current;
    if (g?.kind === 'pan') {
      setView((v) => ({ ...v, offsetX: g.ox + px - g.x, offsetY: g.oy + py - g.y }));
      return;
    }
    const { view: vw, shown: d, editor: ed } = live.current;
    const disp = cellAt(px, py, vw, d.cols, d.rows);
    const prev = hover.current;
    if (disp?.[0] !== prev?.[0] || disp?.[1] !== prev?.[1]) {
      hover.current = disp;
      const c = dataCellAt(px, py);
      setForbidden(!!c && live.current.editable && isForbidden(live.current.design, ed.tool, c[0], c[1]));
      drawOverlay();
    }
    const c = dataCellAt(px, py);
    if (!c) return;
    if (g?.kind === 'paint') addToStroke(g, c);
    else if (g?.kind === 'line') {
      const moved = c[0] !== g.to[0] || c[1] !== g.to[1];
      g.to = c;
      if (rebase(g) || moved) previewGesture(g);
    }
  };

  const endGesture = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'pan') { setPanning(false); drawOverlay(); return; }
    if (!commit) { dispatch({ type: 'clearPreview' }); bounce.settle(performance.now()); return; }
    if (g.kind === 'paint') {
      const op = strokeToPaste(g.cells, g.color);
      if (op) void send(g.base, [op]);
      else dispatch({ type: 'clearPreview' });
    } else {
      void send(g.base, [lineOp(g.from, g.to, g.color)]);
    }
  };

  const onPointerLeave = () => {
    overStage.current = false;
    hover.current = null;
    setForbidden(false);
    drawOverlay();
  };

  /* ---------- 滾輪縮放（以游標為中心；需要非 passive 才能擋掉頁面捲動） ---------- */
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const next = zoomAround(v, Math.exp(-e.deltaY * unit * 0.0015), e.clientX - r.left, e.clientY - r.top);
      if (next.zoom === v.zoom) return;
      setView(next);
      // 縮放倍率在 reducer 裡相乘，連續事件會累積
      dispatch({ type: 'zoom', factor: next.zoom / v.zoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatch, setView]);

  /* ---------- 鍵盤：空白鍵平移、復原／重做 ---------- */
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target)) return;
      if (e.code === 'Space') {
        // 只在游標位於編輯區、且焦點不在按鈕／連結等控制項上時當作平移，否則讓空白鍵照常啟動按鈕
        if (!overStage.current || isControl(e.target)) return;
        e.preventDefault();
        if (!e.repeat) setSpace(true);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || !live.current.editable) return;
      const undo = e.code === 'KeyZ' && !e.shiftKey;
      const redo = (e.code === 'KeyZ' && e.shiftKey) || (e.code === 'KeyY' && e.ctrlKey && !e.shiftKey);
      if (!undo && !redo) return;
      e.preventDefault();
      if (e.repeat) return;
      // 沒有可以復原／重做的步驟時安靜地不做事（和工具列停用的按鈕一致）。不用本地的步數先擋：
      // 筆畫剛送出、伺服器推來的步數還沒到時，⌘Z 也要能復原那一筆
      void callTool(undo ? 'undo' : 'redo', { designId: live.current.design.id })
        .then((res) => onNotice(res.ok || toolError(res.text).code === 'no_history' ? null : res.text));
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    const onBlur = () => setSpace(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onNotice]);

  const cursor = panning ? 'grabbing' : space ? 'grab' : !editable ? 'default'
    : forbidden ? 'not-allowed' : 'crosshair';

  return (
    <div
      ref={wrapRef} className="editor" style={{ cursor }}
      onPointerEnter={() => { overStage.current = true; }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={() => endGesture(true)} onPointerCancel={() => endGesture(false)} onPointerLeave={onPointerLeave}
      onAuxClick={(e) => e.preventDefault()}
    >
      <canvas
        ref={boardRef} className="editor-canvas" data-testid="editor-canvas" data-view={JSON.stringify(view)}
        role="img" aria-label={`${shown.name}，${shown.cols} × ${shown.rows} 格${editor.mirror ? '（鏡像檢視）' : ''}`}
      />
      <canvas ref={overlayRef} className="editor-canvas" aria-hidden="true" />
    </div>
  );
}

const lineOp = (a: Cell, b: Cell, color: string): Op => ({ op: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], color });

/** 形狀鎖定時：畫筆不能畫在空格、橡皮擦不能擦有豆的格子 */
function isForbidden(d: Design, tool: EditorState['tool'], x: number, y: number): boolean {
  if (!d.shapeLocked || (tool !== 'pen' && tool !== 'eraser')) return false;
  const filled = !!getVariant(d).cells[y * d.cols + x];
  return tool === 'pen' ? !filled : filled;
}
