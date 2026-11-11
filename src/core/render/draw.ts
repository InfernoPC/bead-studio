import type { DesignCore, Variant } from '../model';
import type { Palette } from '../palette';

type C2D = CanvasRenderingContext2D;

export const UI = {
  bg: '#FBF6EE', board: '#EFE3D0', boardEdge: '#D9C6A8', peg: '#E2D2BA',
  ruler: '#9C8670', guide: 'rgba(156,134,112,0.3)', margin: '#E8A87C', hole: '#D0574B', text: '#5B4636',
};

export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const f = amt < 0 ? 0 : 255, t = Math.abs(amt);
  const [r, g, b] = ch.map((c) => Math.round(c + (f - c) * t));
  return `rgb(${r},${g},${b})`;
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** rim：豆子外圈的描邊色（編輯區暗色主題用）；不傳就不畫，豆子本身的顏色不變 */
export function drawBeadFlat(ctx: C2D, cx: number, cy: number, R: number, hex: string, rim?: string): void {
  const g = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.2, cx, cy, R);
  g.addColorStop(0, shadeHex(hex, 0.12));
  g.addColorStop(1, shadeHex(hex, -0.14));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shadeHex(hex, -0.35);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.36, 0, Math.PI * 2); ctx.fill();
  if (rim) {
    // 描邊畫在豆子外緣之外，不蓋到豆子顏色
    const lw = R * 0.13;
    ctx.strokeStyle = rim; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx, cy, R + lw / 2, 0, Math.PI * 2); ctx.stroke();
  }
}

export type FlatOpts = {
  cell: number; pegs?: boolean; codes?: boolean; rulers?: boolean; guides?: boolean; margin?: boolean; markers?: boolean;
  /** 個別豆子的縮放（以格子中心；k = j * cols + i）；編輯區的跳動動畫用，≤0 時畫成空格 */
  beadScale?: (k: number) => number;
  /** 覆寫板面配色（編輯區依亮暗主題傳入）；豆子顏色不受影響。未傳時用 UI（伺服器匯出固定亮色） */
  ui?: Partial<Pick<typeof UI, 'bg' | 'board' | 'peg' | 'ruler' | 'guide'>> & { rim?: string };
};

export function flatLayout(d: DesignCore, o: FlatOpts) {
  const pad = o.rulers ? 18 : 6;
  return { pad, w: d.cols * o.cell + pad * 2, h: d.rows * o.cell + pad * 2 };
}

export function drawFlat(ctx: C2D, d: DesignCore, v: Variant, p: Palette, o: FlatOpts): void {
  const { pad, w, h } = flatLayout(d, o);
  const cs = o.cell;
  const ui = { ...UI, ...o.ui };
  ctx.fillStyle = ui.bg; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (o.rulers) {
    ctx.fillStyle = ui.ruler; ctx.font = `${Math.max(8, Math.round(Math.min(cs, 18) * 0.6))}px sans-serif`;
    for (let i = 0; i < d.cols; i += 5) ctx.fillText(String(i + 1), pad + i * cs + cs / 2, pad / 2);
    for (let j = 0; j < d.rows; j += 5) ctx.fillText(String(j + 1), pad / 2, pad + j * cs + cs / 2);
  }
  ctx.fillStyle = ui.board; ctx.fillRect(pad, pad, d.cols * cs, d.rows * cs);
  for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) {
    const cx = pad + i * cs + cs / 2, cy = pad + j * cs + cs / 2;
    const code = v.cells[j * d.cols + i];
    const scale = code && o.beadScale ? o.beadScale(j * d.cols + i) : 1;
    if (!code || scale <= 0) {
      if (o.pegs !== false) { ctx.fillStyle = ui.peg; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, cs * 0.1), 0, Math.PI * 2); ctx.fill(); }
      continue;
    }
    const hex = p.get(code)?.displayHex ?? '#FF00FF';
    drawBeadFlat(ctx, cx, cy, cs * 0.47 * scale, hex, o.ui?.rim);
    if (o.codes) {
      ctx.fillStyle = luminance(hex) > 0.55 ? '#3A2E25' : '#FFFFFF';
      ctx.font = `bold ${Math.round(cs * 0.34)}px sans-serif`;
      ctx.fillText(code, cx, cy);
    }
  }
  if (o.guides) {
    ctx.strokeStyle = ui.guide; ctx.lineWidth = 1;
    for (let k = 5; k < d.cols; k += 5) { ctx.beginPath(); ctx.moveTo(pad + k * cs, pad); ctx.lineTo(pad + k * cs, pad + d.rows * cs); ctx.stroke(); }
    for (let k = 5; k < d.rows; k += 5) { ctx.beginPath(); ctx.moveTo(pad, pad + k * cs); ctx.lineTo(pad + d.cols * cs, pad + k * cs); ctx.stroke(); }
  }
  const m = d.board.margin;
  if (o.margin && m > 0) {
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = UI.margin; ctx.lineWidth = 1.5;
    ctx.strokeRect(pad + m * cs, pad + m * cs, (d.cols - 2 * m) * cs, (d.rows - 2 * m) * cs);
    ctx.restore();
  }
  if (o.markers) {
    ctx.strokeStyle = UI.hole; ctx.lineWidth = 2;
    for (const mk of d.markers) {
      ctx.beginPath(); ctx.arc(pad + mk.x * cs + cs / 2, pad + mk.y * cs + cs / 2, cs * 0.42, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

export type IsoOpts = {
  size: number; tilt?: number; yaw?: number; board?: boolean; ironed?: boolean; zoom?: number;
  /** 覆寫底色與板子配色（網頁實體預覽依亮暗主題傳入）；豆子顏色不受影響。未傳時用 UI（伺服器匯出固定亮色） */
  ui?: Partial<Pick<typeof UI, 'bg' | 'board' | 'boardEdge' | 'peg'>> & { rim?: string };
};

export function drawIso(ctx: C2D, d: DesignCore, v: Variant, p: Palette, o: IsoOpts): void {
  const S = o.size, tilt = ((o.tilt ?? 40) * Math.PI) / 180, yaw = ((o.yaw ?? 20) * Math.PI) / 180;
  const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ironed = !!o.ironed, showBoard = o.board !== false;
  const BH = ironed ? 0.55 : 0.85, R = 0.47, HOLE = 0.17;
  const raw = (u: number, w: number, z: number) => { const rx = u * cy - w * sy, ry = u * sy + w * cy; return [rx, ry * ct - z * st, ry]; };
  const s = ((S - 10) / (Math.max(d.cols, d.rows) * 1.45)) * (o.zoom ?? 1);
  const P2 = (u: number, w: number, z: number) => { const r = raw(u, w, z); return [S / 2 + r[0] * s, S / 2 + r[1] * s, r[2]]; };
  const ui = { ...UI, ...o.ui }, rim = o.ui?.rim;
  ctx.fillStyle = ui.bg; ctx.fillRect(0, 0, S, S);
  const hw = d.cols / 2, hh = d.rows / 2;
  const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const poly = (pts: number[][]) => { ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); };
  if (showBoard) {
    ctx.fillStyle = ui.boardEdge;
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      poly([P2(a[0], a[1], 0), P2(b[0], b[1], 0), P2(b[0], b[1], -0.35), P2(a[0], a[1], -0.35)]);
    }
    ctx.fillStyle = ui.board; poly(corners.map(([u, w]) => P2(u, w, 0)));
  }
  const items: { u: number; w: number; c: string | null; dep: number }[] = [];
  for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) {
    const u = i - hw + 0.5, w = j - hh + 0.5;
    items.push({ u, w, c: v.cells[j * d.cols + i], dep: raw(u, w, 0)[2] });
  }
  items.sort((a, b) => a.dep - b.dep);
  const ex = R * s, ey = R * s * ct, hx = HOLE * s;
  const rsq: [number, number][] = [];
  { const a = 0.5, r = 0.22, seg = 5;
    const cs: [number, number, number][] = [[a - r, a - r, 0], [-(a - r), a - r, Math.PI / 2], [-(a - r), -(a - r), Math.PI], [a - r, -(a - r), Math.PI * 1.5]];
    for (const [cx0, cy0, st0] of cs) for (let k = 0; k <= seg; k++) { const an = st0 + (k / seg) * (Math.PI / 2); rsq.push([cx0 + r * Math.cos(an), cy0 + r * Math.sin(an)]); } }
  for (const it of items) {
    const [bx, by] = P2(it.u, it.w, 0);
    if (!it.c) {
      if (showBoard) { ctx.fillStyle = ui.peg; ctx.beginPath(); ctx.ellipse(bx, by, 0.09 * s, 0.09 * s * ct, 0, 0, Math.PI * 2); ctx.fill(); }
      continue;
    }
    const base = p.get(it.c)?.displayHex ?? '#FF00FF';
    const [tx, ty] = P2(it.u, it.w, BH);
    if (ironed) {
      for (let z = 0; z < BH; z += 0.1) {
        ctx.fillStyle = shadeHex(base, -0.3 + z * 0.3);
        poly(rsq.map(([du, dw]) => P2(it.u + du, it.w + dw, z)));
      }
      ctx.fillStyle = shadeHex(base, 0.04); poly(rsq.map(([du, dw]) => P2(it.u + du, it.w + dw, BH)));
      if (rim) { ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.5, s * 0.05); ctx.stroke(); }
      ctx.fillStyle = shadeHex(base, -0.45); ctx.beginPath(); ctx.ellipse(tx, ty, hx * 0.55, hx * 0.55 * ct, 0, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    if (st > 0.01) {
      const g = ctx.createLinearGradient(bx - ex, 0, bx + ex, 0);
      g.addColorStop(0, shadeHex(base, -0.3)); g.addColorStop(0.45, shadeHex(base, -0.08)); g.addColorStop(1, shadeHex(base, -0.35));
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(bx - ex, ty); ctx.lineTo(bx - ex, by); ctx.ellipse(bx, by, ex, ey, 0, Math.PI, 0, true); ctx.lineTo(bx + ex, ty); ctx.closePath(); ctx.fill();
    }
    const tg = ctx.createRadialGradient(tx - ex * 0.2, ty - ey * 0.2, ex * 0.2, tx, ty, ex);
    tg.addColorStop(0, shadeHex(base, 0.12)); tg.addColorStop(1, shadeHex(base, -0.08));
    ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(tx, ty, ex, ey, 0, 0, Math.PI * 2); ctx.fill();
    // 暗色主題：頂面外緣的淡色描邊，深色豆在暗底上才看得出輪廓（豆子本身的顏色不變）
    if (rim) { ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.5, s * 0.05); ctx.stroke(); }
    ctx.fillStyle = shadeHex(base, -0.4); ctx.beginPath(); ctx.ellipse(tx, ty, hx, hx * ct, 0, 0, Math.PI * 2); ctx.fill();
  }
}
