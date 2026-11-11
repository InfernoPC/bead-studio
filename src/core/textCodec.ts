import { OpError } from './errors';
import { bbox, countCodes, getVariant, type Design } from './model';
import type { Region } from './opSchema';

// 圖例字元：絕不含數字（RLE 用）、"."（空格）、"_"（清除）
const CHARS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*+=?@^~'
  + 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'];

export function legendFor(cells: (string | null)[]): Map<string, string> {
  const counts = Object.entries(countCodes(cells)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (counts.length > CHARS.length) {
    throw new OpError('too_many_colors', `用了 ${counts.length} 種顏色，超過文字圖例上限 ${CHARS.length} 種；請先減少顏色（例如 replace_color 合併相近色）或用 region 分區讀取`);
  }
  return new Map(counts.map(([code], i) => [code, CHARS[i]]));
}

export function rle(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? String(j - i) : '') + s[i];
    i = j;
  }
  return out;
}

export function unrle(s: string, max = Infinity): string {
  let out = '', num = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    const n = num ? Number(num) : 1;
    if (out.length + n > max) throw new OpError('bad_op', `RLE 展開後超過 ${max} 格`);
    out += ch.repeat(n);
    num = '';
  }
  return out;
}

export function encodeDesignText(d: Design, variantId?: string, region?: Region): string {
  const v = getVariant(d, variantId);
  const head = `${d.cols}x${d.rows} margin=${d.board.margin} bead=${d.board.bead} locked=${d.shapeLocked} variant=${v.id} ${v.name}(${v.paletteMode})`;
  const holes = d.markers.filter((m) => m.type === 'hole').map((m) => `(${m.x},${m.y})`).join(' ');
  const lines = [head];
  const inRegion = (i: number) => {
    if (!region) return true;
    const x = i % d.cols, y = Math.floor(i / d.cols);
    return x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h;
  };
  const cells = region ? v.cells.map((c, i) => (inRegion(i) ? c : null)) : v.cells;
  const b = bbox(d, cells);
  if (!b) { lines.push('bbox=none'); if (holes) lines.push(`holes: ${holes}`); return lines.join('\n'); }
  lines.push(`bbox=(${b.x0},${b.y0})-(${b.x1},${b.y1})`);
  const legend = legendFor(cells);
  lines.push('legend: ' + [...legend].map(([code, ch]) => `${ch}=${code}`).join(' '));
  if (holes) lines.push(`holes: ${holes}`);
  for (let y = b.y0; y <= b.y1; y++) {
    let row = '';
    for (let x = b.x0; x <= b.x1; x++) {
      const c = cells[y * d.cols + x];
      row += c === null ? '.' : legend.get(c)!;
    }
    lines.push(`y${y}: ${rle(row)}`);
  }
  return lines.join('\n');
}
