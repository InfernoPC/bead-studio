// 編輯區豆子跳動動畫的純計算：哪些格子變了、波浪延遲、縮放曲線

export const BOUNCE_MS = 280;

/** 兩個版本之間改變的格子（有無或顏色不同）；cols/rows 不同時回傳 []（整張重畫，不跳） */
export function diffCells(prev: (string | null)[], next: (string | null)[]): number[] {
  if (prev.length !== next.length) return [];
  const out: number[] = [];
  for (let k = 0; k < next.length; k++) if ((prev[k] ?? null) !== (next[k] ?? null)) out.push(k);
  return out;
}

/** 波浪排程：以「改變格子中最左上那格」為起點，沿對角線往右下傳遞；延遲 = (dx + dy) × stepMs，整段最長 maxMs（超過時等比例壓縮） */
export function waveDelays(cells: number[], cols: number, o: { stepMs?: number; maxMs?: number } = {}): Map<number, number> {
  const stepMs = o.stepMs ?? 22, maxMs = o.maxMs ?? 900;
  const out = new Map<number, number>();
  if (!cells.length) return out;
  // 對角線上的位置 x + y；最早的那格從 0 開始
  const diag = (k: number) => (k % cols) + Math.floor(k / cols);
  let min = Infinity, max = -Infinity;
  for (const k of cells) { const s = diag(k); if (s < min) min = s; if (s > max) max = s; }
  const span = (max - min) * stepMs;
  const f = span > maxMs ? maxMs / span : 1;
  for (const k of cells) out.set(k, Math.round((diag(k) - min) * stepMs * f));
  return out;
}

/** 跳動曲線：t ∈ [0,1] → 縮放倍率；先縮到 0.82、彈到 1.12、回到 1，t≥1 為 1 */
export function bounceScale(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 1;
  if (t < 0.25) return 1 - 0.18 * (t / 0.25);
  if (t < 0.6) { const u = (t - 0.25) / 0.35; return 0.82 + 0.3 * (1 - (1 - u) * (1 - u)); }
  return 1 + 0.12 * Math.cos(((t - 0.6) / 0.4) * (Math.PI / 2));
}

/** 移除豆子的曲線：先微微鼓起，再縮到 0 消失；t≥1 為 0 */
export function shrinkScale(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  if (t < 0.2) return 1 + 0.08 * (t / 0.2);
  const u = (t - 0.2) / 0.8;
  return 1.08 * (1 - u * u);
}

/** 某一影格中跳動格子的暫時樣子 */
export type CellFrame = { code: string | null; scale: number };
/** 畫面上的作品快照：key 不同（換作品、換版本、改尺寸）時不跳；mirror 時波浪依畫面（翻轉後）的左上角起跳 */
export type BoardSnap = { key: string; cols: number; cells: (string | null)[]; mirror?: boolean };
/**
 * 這次畫面變化的來源：
 * - `stroke`：本頁正在拖曳的畫筆／橡皮擦／直線預覽（立刻跳）
 * - `local`：本頁一次性的操作預覽（填色、換色，波浪）
 * - `server`：伺服器版本（AI、其他分頁、復原；波浪），但本頁自己送出的格子回聲不再跳
 */
export type ChangeSource = 'stroke' | 'local' | 'server';

/** 本頁送出後多久沒等到回聲就放棄比對（毫秒） */
const OWN_TTL_MS = 3000;

/** 記住哪些格子在跳、以及哪些格子是本頁自己改的（等伺服器回聲時不再跳第二次） */
export class BounceTracker {
  private anims = new Map<number, { start: number; from: string | null }>();
  /** 本頁預覽改過、還沒被伺服器確認的格子 → 預期的值 */
  private own = new Map<number, { value: string | null; expires: number }>();
  private prev: BoardSnap | null = null;

  get active(): boolean { return this.anims.size > 0; }

  update(next: BoardSnap, source: ChangeSource, now: number, reducedMotion: boolean): void {
    const prev = this.prev;
    this.prev = next;
    if (!prev || prev.key !== next.key || prev.cols !== next.cols || prev.cells.length !== next.cells.length) {
      this.anims.clear(); this.own.clear();
      return;
    }
    const changed = diffCells(prev.cells, next.cells);
    for (const [k, e] of this.own) if (e.expires <= now) this.own.delete(k);
    let bounce: number[];
    if (source === 'server') {
      // 本頁改過的格子：回聲或拖曳中被暫時蓋回去都不跳
      bounce = changed.filter((k) => !this.own.has(k));
      for (const [k, e] of this.own) if (next.cells[k] === e.value) this.own.delete(k);
    } else {
      // 拖曳中重新套到新版本時，已經跳過的格子不再跳
      bounce = changed.filter((k) => this.own.get(k)?.value !== next.cells[k]);
      for (const k of changed) this.own.set(k, { value: next.cells[k], expires: Infinity });
    }
    if (reducedMotion) { this.anims.clear(); return; }
    const cols = next.cols;
    const shownAt = (k: number) => (next.mirror ? k - (k % cols) + cols - 1 - (k % cols) : k);
    const delays = source === 'stroke' ? null : waveDelays(bounce.map(shownAt), cols);
    for (const k of bounce) this.anims.set(k, { start: now + (delays?.get(shownAt(k)) ?? 0), from: prev.cells[k] });
  }

  /** 本頁的送出已有結果（或取消）：還沒等到回聲的格子在一段時間後不再視為自己的 */
  settle(now: number): void {
    for (const e of this.own.values()) if (e.expires === Infinity) e.expires = now + OWN_TTL_MS;
  }

  /** 目前影格的跳動格子（結束的動畫會被移除）；cells 是畫面上的最新格子 */
  frame(now: number, cells: (string | null)[]): Map<number, CellFrame> {
    const out = new Map<number, CellFrame>();
    for (const [k, a] of this.anims) {
      const t = (now - a.start) / BOUNCE_MS;
      if (t >= 1) { this.anims.delete(k); continue; }
      const code = cells[k] ?? null;
      if (t < 0) out.set(k, { code: a.from, scale: 1 }); // 波浪還沒傳到：維持舊的樣子
      else if (code === null) out.set(k, { code: a.from, scale: shrinkScale(t) });
      else out.set(k, { code, scale: bounceScale(t) });
    }
    return out;
  }
}
