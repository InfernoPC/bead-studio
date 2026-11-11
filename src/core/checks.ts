import { deltaE00 } from './color';
import type { Pt } from './errors';
import { countCodes, getVariant, type Design } from './model';
import type { Inventory, Palette } from './palette';

export type ChecksConfig = { thinChainMin: number; holeMinNeighbors: number; minAdjacentDeltaE: number };
export const DEFAULT_CHECKS: ChecksConfig = { thinChainMin: 4, holeMinNeighbors: 3, minAdjacentDeltaE: 10 };
export type IssueId = 'margin' | 'floating' | 'thin_chain' | 'hole' | 'stock' | 'low_contrast';
export type Issue = { id: IssueId; message: string; cells: Pt[] };

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function runChecks(
  d: Design, variantId: string | undefined,
  ctx: { palette: Palette; inventory: Inventory; config: ChecksConfig },
): Issue[] {
  const v = getVariant(d, variantId);
  const { cols, rows } = d;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < cols && y < rows ? v.cells[y * cols + x] : null);
  const occ = (x: number, y: number) => at(x, y) !== null;
  const deg = (x: number, y: number) => N4.filter(([dx, dy]) => occ(x + dx, y + dy)).length;
  const issues: Issue[] = [];
  const m = d.board.margin;

  const inMargin: Pt[] = [], floating: Pt[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!occ(x, y)) continue;
    if (x < m || y < m || x >= cols - m || y >= rows - m) inMargin.push([x, y]);
    if (deg(x, y) === 0) floating.push([x, y]);
  }
  if (inMargin.length) issues.push({ id: 'margin', message: `${inMargin.length} 顆豆子超出留邊範圍（${m} 格）`, cells: inMargin });
  if (floating.length) issues.push({ id: 'floating', message: `${floating.length} 顆孤立浮豆（四周沒有相連，燙完容易脫落）`, cells: floating });

  const visited = new Set<string>();
  const chains: Pt[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!occ(x, y) || deg(x, y) !== 1 || visited.has(`${x},${y}`)) continue;
    const chain: Pt[] = [[x, y]];
    let prev: Pt | null = null, cur: Pt = [x, y];
    for (;;) {
      const nexts = N4.map(([dx, dy]) => [cur[0] + dx, cur[1] + dy] as Pt)
        .filter(([a, b]) => occ(a, b) && !(prev && a === prev[0] && b === prev[1]));
      if (nexts.length !== 1) break;
      const nx = nexts[0];
      const dn = deg(nx[0], nx[1]);
      if (dn > 2) break;
      chain.push(nx);
      if (dn !== 2) break;
      prev = cur; cur = nx;
    }
    chain.forEach(([a, b]) => visited.add(`${a},${b}`));
    if (chain.length >= ctx.config.thinChainMin) chains.push(...chain);
  }
  if (chains.length) issues.push({ id: 'thin_chain', message: `有單顆寬的細線（≥ ${ctx.config.thinChainMin} 顆），燙完容易斷`, cells: chains });

  for (const mk of d.markers) {
    if (mk.type !== 'hole') continue;
    if (!occ(mk.x, mk.y)) {
      issues.push({ id: 'hole', message: `掛孔 (${mk.x},${mk.y}) 位置沒有豆子`, cells: [[mk.x, mk.y]] });
    } else if (deg(mk.x, mk.y) < ctx.config.holeMinNeighbors) {
      issues.push({ id: 'hole', message: `掛孔 (${mk.x},${mk.y}) 只有 ${deg(mk.x, mk.y)} 個相鄰豆，太靠邊，建議外圍補透明豆`, cells: [[mk.x, mk.y]] });
    }
  }

  for (const [code, n] of Object.entries(countCodes(v.cells))) {
    const have = ctx.inventory[code]?.owned ? ctx.inventory[code].count : 0;
    if (n > have) {
      const cells: Pt[] = [];
      v.cells.forEach((c, i) => { if (c === code) cells.push([i % cols, Math.floor(i / cols)]); });
      issues.push({ id: 'stock', message: have === 0 ? `${code} 沒有庫存，需購買 ${n} 顆` : `${code} 庫存不足：需要 ${n} 顆，缺 ${n - have} 顆`, cells });
    }
  }

  const pairs = new Map<string, { dE: number; cells: Pt[] }>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = at(x, y);
    if (!a) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const b = at(x + dx, y + dy);
      if (!b || b === a) continue;
      const ea = ctx.palette.get(a), eb = ctx.palette.get(b);
      if (!ea || !eb) continue;
      const dE = deltaE00(ea.lab, eb.lab);
      if (dE >= ctx.config.minAdjacentDeltaE) continue;
      const key = [a, b].sort().join('↔');
      const p = pairs.get(key) ?? { dE, cells: [] };
      p.cells.push([x, y], [x + dx, y + dy]);
      pairs.set(key, p);
    }
  }
  if (pairs.size) {
    const list = [...pairs].map(([k, p]) => `${k} ΔE=${p.dE.toFixed(1)}`).join('、');
    issues.push({ id: 'low_contrast', message: `相鄰顏色太接近，邊界看不清：${list}`, cells: [...pairs.values()].flatMap((p) => p.cells) });
  }
  return issues;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return '✅ 沒有發現問題';
  return issues.map((i) => {
    const sample = i.cells.slice(0, 6).map(([x, y]) => `(${x},${y})`).join(' ');
    return `⚠ ${i.message}${sample ? `｜位置 ${sample}${i.cells.length > 6 ? ' …' : ''}` : ''}`;
  }).join('\n');
}
