import { bbox, countCodes, getVariant, type Design } from './model';

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*+=?@^~';

export function legendFor(cells: (string | null)[]): Map<string, string> {
  const counts = Object.entries(countCodes(cells)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(counts.map(([code], i) => [code, CHARS[i] ?? '?']));
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

export function unrle(s: string): string {
  let out = '', num = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    out += ch.repeat(num ? Number(num) : 1);
    num = '';
  }
  return out;
}

export function encodeDesignText(d: Design, variantId?: string): string {
  const v = getVariant(d, variantId);
  const head = `${d.cols}x${d.rows} margin=${d.board.margin} bead=${d.board.bead} locked=${d.shapeLocked} variant=${v.id} ${v.name}(${v.paletteMode})`;
  const holes = d.markers.filter((m) => m.type === 'hole').map((m) => `(${m.x},${m.y})`).join(' ');
  const lines = [head];
  const b = bbox(d, v.cells);
  if (!b) { lines.push('bbox=none'); if (holes) lines.push(`holes: ${holes}`); return lines.join('\n'); }
  lines.push(`bbox=(${b.x0},${b.y0})-(${b.x1},${b.y1})`);
  const legend = legendFor(v.cells);
  lines.push('legend: ' + [...legend].map(([code, ch]) => `${ch}=${code}`).join(' '));
  if (holes) lines.push(`holes: ${holes}`);
  for (let y = b.y0; y <= b.y1; y++) {
    let row = '';
    for (let x = b.x0; x <= b.x1; x++) {
      const c = v.cells[y * d.cols + x];
      row += c === null ? '.' : legend.get(c)!;
    }
    lines.push(`y${y}: ${rle(row)}`);
  }
  return lines.join('\n');
}
