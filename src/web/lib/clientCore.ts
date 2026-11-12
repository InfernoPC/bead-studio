import { applyOps, type OpCtx } from '../../core/ops';
import { Palette } from '../../core/palette';
import type { ClientDesign as Design } from '../../core/model';
import type { StateSnapshot } from './api';
import type { Pending } from './editorState';

export function makeCtx(snapshot: Pick<StateSnapshot, 'palette' | 'inventory'>): OpCtx {
  return { palette: new Palette(snapshot.palette), inventory: snapshot.inventory };
}

/** 在本機套用 ops 做樂觀預覽；失敗時回傳 Error 而不是丟出。 */
export function previewOps(design: Design, ops: unknown[], ctx: OpCtx): Design | Error {
  try {
    return applyOps(design, ops, ctx).design;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * 畫面上要顯示的設計：
 * - 伺服器還沒超過預覽的基底版本 → 顯示預覽
 * - 伺服器已到送出後的版本 → 伺服器的設計已含這一筆，直接用
 * - 中間（伺服器先有了別人的新版本）→ 把這一筆重新套在新版本上，避免畫面閃掉這一筆
 */
export function displayDesign(server: Design | null, pending: Pending | null, ctx?: OpCtx): Design | null {
  if (!server || !pending || pending.design.id !== server.id) return server;
  if (pending.baseVersion >= server.version) return pending.design;
  if (pending.commitVersion !== undefined && server.version >= pending.commitVersion) return server;
  if (!ctx || !pending.ops) return server;
  const next = previewOps(server, pending.ops, ctx);
  return next instanceof Error ? server : next;
}

/** 預覽還有效嗎：伺服器換了作品，或已追上送出後的版本，就該清掉 */
export function pendingSettled(server: Design, pending: Pending): boolean {
  if (pending.design.id !== server.id) return true;
  if (pending.commitVersion !== undefined) return server.version >= pending.commitVersion;
  // 沒有 ops 可重套（或伺服器沒回報版本）時，維持原本的規則：伺服器一有新版本就清掉
  return !pending.ops && server.version > pending.baseVersion;
}
