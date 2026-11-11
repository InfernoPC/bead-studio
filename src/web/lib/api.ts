import type { Design } from '../../core/model';
import type { PaletteColor, Inventory } from '../../core/palette';
import type { ChecksConfig } from '../../core/checks';

export type View = 'flat' | 'pattern' | '3d' | 'ironed';
export type DesignSummary = { id: string; name: string; version: number; current: boolean };
/** 目前作品可以復原／重做的步數 */
export type HistoryDepth = { undo: number; redo: number };
export type StateSnapshot = {
  designs: DesignSummary[]; current: Design | null; history: HistoryDepth | null; palette: PaletteColor[];
  inventory: Inventory; checks: ChecksConfig; mcpUrl: string;
};
export type ToolResult = { ok: boolean; text: string; images: { data: string; mimeType: string }[] };

function httpMessage(status: number, body: unknown): string {
  if (status === 413) return '檔案太大，上限是 20MB。';
  if (status === 415) return '不支援這種檔案格式。';
  if (status === 403) return '伺服器拒絕了這個請求（來源不被允許）。';
  const detail = body && typeof body === 'object' ? (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error : undefined;
  return typeof detail === 'string' && detail ? `伺服器回應錯誤（${status}）：${detail}` : `伺服器回應錯誤（${status}）。`;
}

async function failure(res: Response): Promise<string> {
  let body: unknown;
  try { body = await res.json(); } catch { /* 非 JSON 內容 */ }
  return httpMessage(res.status, body);
}

export async function getState(): Promise<StateSnapshot> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(await failure(res));
  return res.json();
}

/** keepalive：頁面關閉或切走時送出的最後一批修改（瀏覽器在頁面卸載後仍會送完） */
export async function callTool(name: string, args: Record<string, unknown>, o: { keepalive?: boolean } = {}): Promise<ToolResult> {
  try {
    const res = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), keepalive: o.keepalive,
    });
    if (!res.ok) return { ok: false, text: await failure(res), images: [] };
    return await res.json();
  } catch {
    return { ok: false, text: '連不上伺服器。', images: [] };
  }
}

/** 伺服器的 OpError 文字是「code（op #i）: 訊息」；拆出 code 讓 UI 分辨 would_crop 等情況，訊息給人看 */
export function toolError(text: string): { code: string | null; message: string } {
  const m = /^([a-z][a-z0-9_]*)(?:（op #\d+）)?: ([\s\S]*)$/.exec(text.trim());
  return m ? { code: m[1], message: m[2] } : { code: null, message: text };
}

export async function uploadImport(
  file: Blob, o: { variant?: string; removeBg?: boolean; dither?: boolean } = {},
): Promise<{ ok: boolean; text: string }> {
  const q = new URLSearchParams();
  if (o.variant) q.set('variant', o.variant);
  if (o.removeBg) q.set('removeBg', '1');
  if (o.dither) q.set('dither', '1');
  try {
    const res = await fetch(`/api/import?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    if (!res.ok) return { ok: false, text: await failure(res) };
    return await res.json();
  } catch {
    return { ok: false, text: '連不上伺服器。' };
  }
}

export function exportUrl(designId: string, o: { variant?: string; view?: View; scale?: number } = {}): string {
  const q = new URLSearchParams();
  if (o.view) q.set('view', o.view);
  if (o.variant) q.set('variant', o.variant);
  if (o.scale) q.set('scale', String(o.scale));
  const qs = q.toString();
  return `/api/designs/${encodeURIComponent(designId)}/export.png${qs ? `?${qs}` : ''}`;
}
