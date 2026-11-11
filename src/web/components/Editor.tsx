import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from 'react';
import { getVariant, type Design } from '../../core/model';
import type { Op } from '../../core/opSchema';
import type { Palette } from '../../core/palette';
import { drawBeadFlat, drawFlat, flatLayout, UI } from '../../core/render/draw';
import { callTool, type StateSnapshot } from '../lib/api';
import { displayDesign, makeCtx, previewOps } from '../lib/clientCore';
import type { EditorAction, EditorState } from '../lib/editorState';
import { interpolate, strokeToPaste, type Cell } from '../lib/stroke';
import { cellAt, zoomAround, type View } from '../lib/viewport';

type Props = {
  snapshot: StateSnapshot; design: Design; editor: EditorState;
  dispatch: Dispatch<EditorAction>; editable: boolean; onNotice(text: string | null): void;
};

const FLAT = { pegs: true, rulers: true, guides: true, margin: true, markers: true } as const;
const MAX_CELL = 36;
const FIT_GAP = 16;
const DIM = 0.35;

type Tokens = { alert: string; ink: string; inkSoft: string; inspect: string };
function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return { alert: v('--alert'), ink: v('--ink'), inkSoft: v('--ink-soft'), inspect: v('--inspect') };
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** 鏡像檢視用的左右翻轉副本（只用於繪製，資料不變） */
function mirrored(d: Design): Design {
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

type BoardOpts = {
  palette: Palette; cell: number; mirror: boolean; tokens: Tokens;
  highlightCode: string | null; highlightCells: [number, number][] | null;
  /** 個別格子的縮放（格子索引為資料座標）；Task 8 使用 */
  cellScale?: Map<number, number>;
};

/** 畫整張面板（面板座標，呼叫端負責縮放平移的 transform） */
function drawBoard(ctx: CanvasRenderingContext2D, design: Design, o: BoardOpts): void {
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
  const [view, setView] = useState<View>({ cell: 20, pad: 18, offsetX: 0, offsetY: 0, zoom: editor.zoom });
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<Cell | null>(null);
  const tokens = useMemo(readTokens, []);
  const opCtx = useMemo(() => makeCtx(snapshot), [snapshot.palette, snapshot.inventory]);
  const shown = displayDesign(design, editor.pending) ?? design;

  // 事件處理器裡要讀最新值
  const live = useRef({ view, size, editor, design, shown, editable });
  live.current = { view, size, editor, design, shown, editable };

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

  /* ---------- 繪製 ---------- */
  const frame = useRef(0);
  const drawNow = useCallback(() => {
    frame.current = 0;
    const c = boardRef.current, { view: vw, size: sz, shown: d, editor: ed } = live.current;
    if (!c || !sz.w) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = sz.dpr * vw.zoom;
    ctx.setTransform(k, 0, 0, k, sz.dpr * vw.offsetX, sz.dpr * vw.offsetY);
    drawBoard(ctx, d, {
      palette: opCtx.palette, cell: vw.cell, mirror: ed.mirror, tokens,
      highlightCode: ed.highlightCode, highlightCells: ed.highlightCells,
    });
  }, [opCtx, tokens]);
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
      drawBeadFlat(ctx, cx, cy, cs * 0.47, opCtx.palette.get(ed.color)?.displayHex ?? '#FF00FF');
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

  const addToStroke = (g: Extract<Gesture, { kind: 'paint' }>, c: Cell) => {
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
    if (added) preview(g.base, [strokeToPaste(g.cells, g.color)!]);
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
      case 'select':
        return; // 框選在之後的 task 加入
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
    else if (g?.kind === 'line' && (c[0] !== g.to[0] || c[1] !== g.to[1])) {
      g.to = c;
      preview(g.base, [lineOp(g.from, c, g.color)]);
    }
  };

  const endGesture = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'pan') { setPanning(false); drawOverlay(); return; }
    if (!commit) { dispatch({ type: 'clearPreview' }); return; }
    if (g.kind === 'paint') {
      const op = strokeToPaste(g.cells, g.color);
      if (op) void send(g.base, [op]);
      else dispatch({ type: 'clearPreview' });
    } else {
      void send(g.base, [lineOp(g.from, g.to, g.color)]);
    }
  };

  const onPointerLeave = () => {
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
      const v = live.current.view;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const next = zoomAround(v, Math.exp(-e.deltaY * unit * 0.0015), e.clientX - r.left, e.clientY - r.top);
      if (next.zoom === v.zoom) return;
      setView(next);
      dispatch({ type: 'zoom', factor: next.zoom / live.current.editor.zoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  /* ---------- 鍵盤：空白鍵平移、復原／重做 ---------- */
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target)) return;
      if (e.code === 'Space') {
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
      void callTool(undo ? 'undo' : 'redo', { designId: live.current.design.id })
        .then((res) => onNotice(res.ok ? null : res.text));
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
    : forbidden ? 'not-allowed' : editor.tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={wrapRef} className="editor" style={{ cursor }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
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
