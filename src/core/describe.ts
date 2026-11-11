import { deltaE00 } from './color';
import { bbox, getVariant, type Design } from './model';
import type { Palette } from './palette';
import { legendFor } from './textCodec';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function describeDesign(d: Design, variantId: string | undefined, palette: Palette): string {
  const v = getVariant(d, variantId);
  const { cols, rows } = d;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < cols && y < rows ? v.cells[y * cols + x] : null);
  const b = bbox(d, v.cells);
  const out: string[] = [];
  out.push(`尺寸 ${cols}×${rows} 格（${d.board.widthMm}×${d.board.heightMm}mm，${d.board.bead}mm 豆），版本 ${v.name}(${v.paletteMode})${d.shapeLocked ? '，形狀已鎖定' : ''}`);
  if (!b) { out.push('畫面空白，還沒有任何豆子'); return out.join('\n'); }
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, m = d.board.margin;
  const marginOk = b.x0 >= m && b.y0 >= m && b.x1 < cols - m && b.y1 < rows - m;
  out.push(`內容範圍 (${b.x0},${b.y0})-(${b.x1},${b.y1})，${bw}×${bh} 格，留邊${marginOk ? ' OK' : ' ⚠ 超出'}`);

  const sym = (axis: 'h' | 'v') => {
    let match = 0, total = 0;
    const bad: string[] = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const mx = axis === 'h' ? b.x0 + b.x1 - x : x, my = axis === 'v' ? b.y0 + b.y1 - y : y;
      total++;
      if (at(x, y) === at(mx, my)) match++;
      else if ((axis === 'h' ? x < mx : y < my) && bad.length < 8) bad.push(`(${x},${y})`);
    }
    return `${Math.round((match / total) * 100)}%${bad.length ? `（不對稱：${bad.join(' ')}）` : ''}`;
  };
  out.push(`左右對稱 ${sym('h')}`);
  out.push(`上下對稱 ${sym('v')}`);

  out.push('色塊：');
  const seen = new Uint8Array(cols * rows);
  const byCode = new Map<string, { n: number; comps: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }>();
  for (let i = 0; i < v.cells.length; i++) {
    const c = v.cells[i];
    if (!c) continue;
    const s = byCode.get(c) ?? { n: 0, comps: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, sx: 0, sy: 0 };
    const x = i % cols, y = Math.floor(i / cols);
    s.n++; s.sx += x; s.sy += y;
    s.x0 = Math.min(s.x0, x); s.y0 = Math.min(s.y0, y); s.x1 = Math.max(s.x1, x); s.y1 = Math.max(s.y1, y);
    if (!seen[i]) {
      s.comps++;
      const stack = [i];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen[k]) continue;
        seen[k] = 1;
        const kx = k % cols, ky = Math.floor(k / cols);
        for (const [dx, dy] of N4) if (at(kx + dx, ky + dy) === c) stack.push((ky + dy) * cols + kx + dx);
      }
    }
    byCode.set(c, s);
  }
  const third = (val: number, lo: number, len: number, words: [string, string, string]) =>
    words[Math.min(2, Math.floor(((val - lo) / Math.max(1, len)) * 3))];
  for (const [code, s] of [...byCode].sort((a, b2) => b2[1].n - a[1].n)) {
    const pos = `${third(s.sy / s.n, b.y0, bh, ['上', '中', '下'])}${third(s.sx / s.n, b.x0, bw, ['左', '中', '右'])}`;
    out.push(`  ${code} ${palette.get(code)?.name ?? ''} ${s.n} 顆 ${s.comps} 塊 範圍(${s.x0},${s.y0})-(${s.x1},${s.y1}) 位置：${pos === '中中' ? '中央' : pos}`);
  }

  const edge = new Map<string, number>();
  let edgeTotal = 0;
  for (let i = 0; i < v.cells.length; i++) {
    const c = v.cells[i];
    if (!c) continue;
    const x = i % cols, y = Math.floor(i / cols);
    if (N4.some(([dx, dy]) => at(x + dx, y + dy) === null)) { edgeTotal++; edge.set(c, (edge.get(c) ?? 0) + 1); }
  }
  const [topEdge, topN] = [...edge].sort((a, b2) => b2[1] - a[1])[0];
  out.push(`外框：邊緣格最常見的是 ${topEdge}，佔 ${Math.round((topN / edgeTotal) * 100)}%${topN === edgeTotal ? '（封閉外框）' : ''}`);

  const low = new Map<string, number>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = at(x, y);
    if (!a) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const c2 = at(x + dx, y + dy);
      if (!c2 || c2 === a) continue;
      const dE = deltaE00(palette.get(a)!.lab, palette.get(c2)!.lab);
      if (dE < 10) low.set([a, c2].sort().join('↔'), dE);
    }
  }
  out.push(`低對比相鄰：${low.size ? [...low].map(([k, dE]) => `${k} ΔE=${dE.toFixed(1)}`).join('、') : '無'}`);

  const legend = legendFor(v.cells);
  out.push(`縮圖（2×2 合 1，${[...legend].map(([c, ch]) => `${ch}=${c}`).join(' ')}）：`);
  for (let y = b.y0; y <= b.y1; y += 2) {
    let line = '  ';
    for (let x = b.x0; x <= b.x1; x += 2) {
      const cnt = new Map<string, number>();
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const c = x + dx <= b.x1 && y + dy <= b.y1 ? at(x + dx, y + dy) : null;
        if (c) cnt.set(c, (cnt.get(c) ?? 0) + 1);
      }
      const total = [...cnt.values()].reduce((s, n) => s + n, 0);
      line += total >= 2 ? legend.get([...cnt].sort((a, b2) => b2[1] - a[1])[0][0]) : '.';
    }
    out.push(line);
  }
  return out.join('\n');
}
