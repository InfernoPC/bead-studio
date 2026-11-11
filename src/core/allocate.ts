import { deltaE00, type Lab } from './color';
import { OpError } from './errors';
import type { Palette, PaletteEntry } from './palette';

export type Target = { index: number; lab: Lab };

export function allocate(targets: Target[], allowed: PaletteEntry[], capacity?: Map<string, number>): Map<number, string> {
  if (targets.length === 0) return new Map();
  if (allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  const cap = (ci: number) => (capacity ? capacity.get(allowed[ci].code) ?? 0 : Infinity);
  if (capacity) {
    const total = allowed.reduce((s, _, ci) => s + cap(ci), 0);
    if (total < targets.length) {
      throw new OpError('stock_insufficient', `需要 ${targets.length} 顆，可用庫存只有 ${total} 顆，缺 ${targets.length - total} 顆`);
    }
  }
  const dist = targets.map((t) => allowed.map((c) => deltaE00(t.lab, c.lab)));
  const assign = dist.map((row) => row.indexOf(Math.min(...row)));

  if (capacity) {
    const used = allowed.map(() => 0);
    assign.forEach((ci) => used[ci]++);
    for (;;) {
      const over = used.findIndex((u, ci) => u > cap(ci));
      if (over < 0) break;
      let best = { t: -1, ci: -1, cost: Infinity };
      assign.forEach((ci, t) => {
        if (ci !== over) return;
        dist[t].forEach((d, cj) => {
          if (cj === over || used[cj] >= cap(cj)) return;
          const cost = d - dist[t][ci];
          if (cost < best.cost) best = { t, ci: cj, cost };
        });
      });
      if (best.t < 0) throw new OpError('stock_insufficient', '庫存不足，無法分配顏色');
      used[over]--; used[best.ci]++; assign[best.t] = best.ci;
    }
  }
  return new Map(targets.map((t, k) => [t.index, allowed[assign[k]].code]));
}

/**
 * 把來源色號對應到目標色彩範圍。不透明的來源只會配到不透明色；
 * 已經是透明的來源維持透明（同色號優先，其次其他可用透明色），都不行才退回最接近的不透明色。
 * capacity（stock 模式）會一併扣掉保留下來的透明豆。
 */
export function matchCodes(
  sources: { index: number; code: string }[], palette: Palette, allowed: Set<string>, capacity?: Map<string, number>,
): Map<number, string> {
  const entries = palette.entries(allowed);
  const opaque = entries.filter((e) => !e.transparent);
  const clear = entries.filter((e) => e.transparent);
  const cap = capacity ? new Map(capacity) : undefined;
  const has = (code: string) => !cap || (cap.get(code) ?? 0) > 0;
  const take = (code: string) => { if (cap) cap.set(code, (cap.get(code) ?? 0) - 1); };
  const out = new Map<number, string>();
  const rest: Target[] = [];
  for (const s of sources) {
    const e = palette.get(s.code)!;
    if (e.transparent) {
      const pick = allowed.has(s.code) && has(s.code) ? s.code
        : clear.filter((c) => has(c.code)).sort((a, b) => deltaE00(e.lab, a.lab) - deltaE00(e.lab, b.lab))[0]?.code;
      if (pick) { take(pick); out.set(s.index, pick); continue; }
    }
    rest.push({ index: s.index, lab: e.lab });
  }
  for (const [i, code] of allocate(rest, opaque, cap)) out.set(i, code);
  return out;
}
