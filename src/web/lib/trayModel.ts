// 分格豆盒與用量面板的純資料：哪些格子要顯示、每格裝幾顆豆、作品用了多少
import { countCodes } from '../../core/model';
import type { Inventory, PaletteColor } from '../../core/palette';

/** 豆盒的檢視篩選（只影響畫面，不是伺服器給 AI 用的 paletteMode） */
export type TrayFilter = 'all' | 'owned' | 'stock';
export type TraySlot = { code: string; name: string; hex: string; owned: boolean; count: number; level: 0 | 1 | 2 | 3; transparent: boolean };
export type UsageRow = { code: string; used: number; stock: number; short: number };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** 色號自然排序：A2 在 A10 前 */
export const compareCodes = (a: string, b: string) => collator.compare(a, b);

/** 格子裡畫幾顆豆：沒有或 0 顆 = 0；1–49 = 1；50–199 = 2；≥200 = 3 */
export function stockLevel(owned: boolean, count: number): TraySlot['level'] {
  if (!owned || count <= 0) return 0;
  if (count < 50) return 1;
  if (count < 200) return 2;
  return 3;
}

/** 擁有的顆數（沒有這個顏色就是 0） */
export function stockOf(inv: Inventory, code: string): number {
  const s = inv[code];
  return s?.owned ? s.count : 0;
}

/** 「A07」→「a7」：色號數字前的 0 不影響比對 */
const normCode = (s: string) => s.toLowerCase().replace(/^([a-z]+)0+(?=\d)/, '$1');

/** 篩選＋搜尋後的格子。搜尋比對色號前綴（不分大小寫）或名稱子字串；色號符合的排前面，各自依色號自然排序 */
export function traySlots(palette: PaletteColor[], inv: Inventory, f: TrayFilter, query: string): TraySlot[] {
  const q = query.trim();
  const qCode = normCode(q);
  const qName = q.toLowerCase();
  const byCode: TraySlot[] = [], byName: TraySlot[] = [];
  for (const p of palette) {
    const s = inv[p.code];
    const owned = !!s?.owned, count = s?.count ?? 0;
    if (f === 'owned' && !owned) continue;
    if (f === 'stock' && !(owned && count > 0)) continue;
    const slot: TraySlot = {
      code: p.code, name: p.name, hex: p.calibratedHex ?? p.hex, owned, count,
      level: stockLevel(owned, count), transparent: !!p.transparent,
    };
    if (!q || normCode(p.code).startsWith(qCode)) byCode.push(slot);
    else if (p.name.toLowerCase().includes(qName)) byName.push(slot);
  }
  const sort = (xs: TraySlot[]) => xs.sort((a, b) => compareCodes(a.code, b.code));
  return [...sort(byCode), ...sort(byName)];
}

/** 每個顏色用了幾顆、庫存幾顆、缺幾顆；依用量由多到少（同量依色號） */
export function usageRows(cells: (string | null)[], inv: Inventory): UsageRow[] {
  return Object.entries(countCodes(cells))
    .map(([code, n]) => { const stock = stockOf(inv, code); return { code, used: n, stock, short: Math.max(0, n - stock) }; })
    .sort((a, b) => b.used - a.used || compareCodes(a.code, b.code));
}
