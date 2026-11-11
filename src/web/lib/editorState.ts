import type { ClientDesign as Design } from '../../core/model';

export type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'line' | 'ellipse' | 'replace' | 'hole';
/**
 * 樂觀預覽。ops／variant 讓伺服器在中途有新版本（例如 AI 修改）時能把這一筆重新套上去，
 * 不用先丟掉預覽；commitVersion 是送出後伺服器回報的版本，伺服器追上它才換回伺服器的設計。
 */
export type Pending = { baseVersion: number; design: Design; ops?: unknown[]; variant?: string; commitVersion?: number };
export type EditorState = {
  tool: Tool; color: string | null; recent: string[]; zoom: number; mirror: boolean;
  highlightCode: string | null; highlightCells: [number, number][] | null; pending: Pending | null;
};
export type EditorAction =
  | { type: 'setTool'; tool: Tool }
  | { type: 'pickColor'; code: string }
  | { type: 'zoom'; factor: number }
  | { type: 'toggleMirror' }
  | { type: 'highlightCode'; code: string | null }
  | { type: 'highlightCells'; cells: [number, number][] | null }
  | { type: 'preview'; pending: Pending }
  | { type: 'commitPreview'; version: number }
  | { type: 'clearPreview' };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
const RECENT_MAX = 8;

export const initialEditor: EditorState = {
  tool: 'pen', color: null, recent: [], zoom: 1, mirror: false,
  highlightCode: null, highlightCells: null, pending: null,
};

export function reduceEditor(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'setTool': return { ...s, tool: a.tool };
    case 'pickColor': return { ...s, color: a.code, recent: [a.code, ...s.recent.filter((c) => c !== a.code)].slice(0, RECENT_MAX) };
    case 'zoom': return { ...s, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.zoom * a.factor)) };
    case 'toggleMirror': return { ...s, mirror: !s.mirror };
    case 'highlightCode': return { ...s, highlightCode: a.code, highlightCells: a.code ? null : s.highlightCells };
    case 'highlightCells': return { ...s, highlightCells: a.cells, highlightCode: a.cells ? null : s.highlightCode };
    case 'preview': return { ...s, pending: a.pending };
    case 'clearPreview': return { ...s, pending: null };
    case 'commitPreview': return s.pending ? { ...s, pending: { ...s.pending, commitVersion: a.version } } : s;
  }
}
