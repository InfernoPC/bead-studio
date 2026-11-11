import { deltaE00, hexToLab, hexToRgb, type Lab } from './color';

export type PaletteColor = {
  code: string; name: string; series: string; hex: string;
  calibratedHex?: string; transparent?: boolean;
};
export type PaletteEntry = PaletteColor & { displayHex: string; lab: Lab; rgb: [number, number, number] };
export type Inventory = Record<string, { owned: boolean; count: number }>;
export type PaletteMode = 'all' | 'owned' | 'stock';

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

export function allowedCodes(p: Palette, inv: Inventory, mode: PaletteMode): Set<string> {
  return new Set(
    p.all()
      .filter((c) => {
        if (mode === 'all') return true;
        const s = inv[c.code];
        if (!s?.owned) return false;
        return mode === 'owned' || s.count > 0;
      })
      .map((c) => c.code),
  );
}

export function stockCapacity(inv: Inventory): Map<string, number> {
  const m = new Map<string, number>();
  for (const [code, s] of Object.entries(inv)) if (s.owned) m.set(code, s.count);
  return m;
}
