import { deltaE00, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

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
