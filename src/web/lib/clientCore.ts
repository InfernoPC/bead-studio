import { applyOps, type OpCtx } from '../../core/ops';
import { Palette } from '../../core/palette';
import type { ClientDesign as Design } from '../../core/model';
import type { StateSnapshot } from './api';
import type { Pending } from './editorState';

export function makeCtx(snapshot: Pick<StateSnapshot, 'palette' | 'inventory'>): OpCtx {
  return { palette: new Palette(snapshot.palette), inventory: snapshot.inventory };
}

/** 在本機套用 ops 做樂觀預覽；失敗時回傳 Error 而不是丟出。 */
export function previewOps(design: Design, ops: unknown[], ctx: OpCtx, variant?: string): Design | Error {
  try {
    return applyOps(design, ops, ctx, variant).design;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** pending 的基底版本不落後於伺服器時顯示 pending，否則以伺服器為準。 */
export function displayDesign(server: Design | null, pending: Pending | null): Design | null {
  if (server && pending && pending.baseVersion >= server.version) return pending.design;
  return server;
}
