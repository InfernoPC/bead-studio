import { deltaE00, hexToLab, hexToRgb, type Lab } from './color';
import { countCodes } from './model';

export type PaletteColor = {
  code: string; name: string; series: string; hex: string;
  calibratedHex?: string; transparent?: boolean;
};
export type PaletteEntry = PaletteColor & { displayHex: string; lab: Lab; rgb: [number, number, number] };
export type Inventory = Record<string, { owned: boolean; count: number }>;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function validatePalette(colors: PaletteColor[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    if (seen.has(c.code)) errs.push(`色號重複：${c.code}`);
    seen.add(c.code);
    if (!HEX.test(c.hex)) errs.push(`${c.code} 的 hex 格式錯誤：${c.hex}`);
    if (c.calibratedHex && !HEX.test(c.calibratedHex)) errs.push(`${c.code} 的 calibratedHex 格式錯誤：${c.calibratedHex}`);
    if (!c.name) errs.push(`${c.code} 缺少名稱`);
    if (!c.code.startsWith(c.series)) errs.push(`系列 ${c.series} 與色號 ${c.code} 不符`);
  }
  return errs;
}

export class Palette {
  private map = new Map<string, PaletteEntry>();

  constructor(colors: PaletteColor[]) {
    for (const c of colors) {
      const displayHex = (c.calibratedHex ?? c.hex).toUpperCase();
      this.map.set(c.code, { ...c, displayHex, lab: hexToLab(displayHex), rgb: hexToRgb(displayHex) });
    }
  }
  has(code: string) { return this.map.has(code); }
  get(code: string) { return this.map.get(code); }
  all() { return [...this.map.values()]; }
  entries(codes: Iterable<string>) {
    const out: PaletteEntry[] = [];
    for (const c of codes) { const e = this.map.get(c); if (e) out.push(e); }
    return out;
  }
  nearestLab(lab: Lab, allowed: Set<string>): PaletteEntry | null {
    let best: PaletteEntry | null = null, bd = Infinity;
    for (const e of this.entries(allowed)) {
      const d = deltaE00(lab, e.lab);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestIn(code: string, allowed: Set<string>): string | null {
    const e = this.map.get(code);
    if (!e) return null;
    return this.nearestLab(e.lab, allowed)?.code ?? null;
  }
}

export type Deduction = { code: string; used: number; before: number; after: number };
/** deducted：擁有而且還有庫存、真的會扣的；outOfStock：擁有但已經是 0 顆（沒東西可扣）；skipped：未擁有、不受影響 */
export type DeductionPlan = { deducted: Deduction[]; outOfStock: { code: string; used: number }[]; skipped: { code: string; used: number }[] };

const codeOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** 做完作品後要從庫存扣掉多少：擁有的顏色扣掉用量（最少扣到 0）；未擁有的色號不受影響，另外列出。
 *  各組都依用量由多到少（同量依色號）。伺服器的 deduct_inventory 與 UI 的確認對話框共用這份計算 */
export function planDeduction(cells: (string | null)[], inv: Inventory): DeductionPlan {
  const order = <T extends { code: string; used: number }>(xs: T[]) =>
    xs.sort((a, b) => b.used - a.used || codeOrder.compare(a.code, b.code));
  const plan: DeductionPlan = { deducted: [], outOfStock: [], skipped: [] };
  for (const [code, n] of Object.entries(countCodes(cells))) {
    const s = inv[code];
    if (!s?.owned) plan.skipped.push({ code, used: n });
    else if (s.count <= 0) plan.outOfStock.push({ code, used: n });
    else plan.deducted.push({ code, used: n, before: s.count, after: Math.max(0, s.count - n) });
  }
  return { deducted: order(plan.deducted), outOfStock: order(plan.outOfStock), skipped: order(plan.skipped) };
}
