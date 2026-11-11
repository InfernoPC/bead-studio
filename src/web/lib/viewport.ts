import { MAX_ZOOM, MIN_ZOOM } from './editorState';

/**
 * 編輯區的檢視：面板以 drawFlat 的版面（格子 cell px、四周 pad px）繪製，
 * 再整體縮放 zoom 倍、平移到 (offsetX, offsetY)（canvas 的 CSS px）
 */
export type View = { cell: number; pad: number; offsetX: number; offsetY: number; zoom: number };

/** canvas 上的點 (px, py) 落在哪一格；在格子外（含尺規區）回傳 null */
export function cellAt(px: number, py: number, view: View, cols: number, rows: number): [number, number] | null {
  const i = Math.floor(((px - view.offsetX) / view.zoom - view.pad) / view.cell);
  const j = Math.floor(((py - view.offsetY) / view.zoom - view.pad) / view.cell);
  return i >= 0 && j >= 0 && i < cols && j < rows ? [i, j] : null;
}

/** 以 (px, py) 為中心縮放 factor 倍（夾在 MIN_ZOOM–MAX_ZOOM），游標下的面板位置不動 */
export function zoomAround(view: View, factor: number, px: number, py: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const k = zoom / view.zoom;
  return { ...view, zoom, offsetX: px - (px - view.offsetX) * k, offsetY: py - (py - view.offsetY) * k };
}
