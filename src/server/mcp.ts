import { readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { z } from 'zod';
import { setBoard } from '../core/board';
import { formatIssues, runChecks } from '../core/checks';
import { describeDesign } from '../core/describe';
import { OpError } from '../core/errors';
import { imageToCells } from '../core/importImage';
import { getVariant, maskFromCells } from '../core/model';
import { OpSchema, RegionSchema } from '../core/opSchema';
import { applyOps, syncOtherVariants, type Summary } from '../core/ops';
import { allowedCodes, stockCapacity } from '../core/palette';
import { encodeDesignText } from '../core/textCodec';
import { createVariant, recolorVariant, selectVariant } from '../core/variants';
import { embedDesign, extractDesign, hasDesignMeta } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

export type Vision = 'auto' | 'on' | 'off';

const Mode = z.enum(['all', 'owned', 'stock']);
const ViewE = z.enum(['flat', 'pattern', '3d', 'ironed']);
const designId = z.string().optional().describe('作品 id；省略時用目前開啟的作品');
const variant = z.string().optional().describe('配色版本 id（例如 v1）；省略時用目前顯示的版本');

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });

function wrap<A>(fn: (a: A) => Promise<{ content: Content[] }> | { content: Content[] }) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      if (e instanceof OpError) {
        const where = e.opIndex !== undefined ? `（op #${e.opIndex}）` : '';
        return { isError: true, content: [{ type: 'text' as const, text: `${e.code}${where}: ${e.message}` }] };
      }
      return { isError: true, content: [{ type: 'text' as const, text: `error: ${(e as Error).message}` }] };
    }
  };
}

function summaryText(s: Summary, checks: string): string {
  const total = Object.values(s.delta).reduce((a, b) => a + b, 0);
  const delta = Object.entries(s.delta).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') || '無';
  return [
    `OK 版本 ${s.variant} 共 ${s.total} 顆（${total >= 0 ? '+' : ''}${total}）`,
    `變化：${delta}`,
    s.clipped ? `裁切：${s.clipped} 格超出畫布被略過` : '',
    `檢查：\n${checks}`,
  ].filter(Boolean).join('\n');
}

export function buildMcpServer(store: DesignStore, opts: { vision?: Vision } = {}): McpServer {
  const vision = opts.vision ?? 'auto';
  const server = new McpServer({ name: 'bead-studio', version: '0.1.0' });
  const checksText = (id?: string, v?: string) =>
    formatIssues(runChecks(store.get(id), v, { ...store.ctx(), config: store.checks }));

  server.registerTool('list_designs', { description: '列出所有作品（* 表示目前開啟）', inputSchema: {} },
    wrap(() => ok(store.list().map((d) => `${d.current ? '*' : ' '} ${d.id} ${d.name} v${d.version}`).join('\n') || '（沒有作品）')));

  server.registerTool('open_design', { description: '開啟作品，之後的操作預設作用於它（瀏覽器也會切換）', inputSchema: { id: z.string() } },
    wrap(({ id }) => { const d = store.open(id); return ok(`已開啟 ${d.name}（${d.cols}×${d.rows}）`); }));

  server.registerTool('new_design', {
    description: '建立新作品並開啟。尺寸以 mm 指定，格數自動換算 = floor(mm / bead)',
    inputSchema: {
      name: z.string(), widthMm: z.number().positive(), heightMm: z.number().positive(),
      bead: z.union([z.literal(2.6), z.literal(5)]), margin: z.number().int().min(0).default(2),
    },
  }, wrap(({ name, widthMm, heightMm, bead, margin }) => {
    const d = store.create(name, { widthMm, heightMm, bead, margin });
    return ok(`已建立 ${d.id}「${d.name}」：${d.cols}×${d.rows} 格，留邊 ${margin} 格`);
  }));

  server.registerTool('get_design', {
    description: '讀取設計（只回傳有豆子的範圍，每列 RLE：數字=重複次數，"."=空格）。region {x,y,w,h} 可只讀取某一區',
    inputSchema: { designId, variant, region: RegionSchema.optional() },
  }, wrap(({ designId: id, variant: v, region }) => ok(encodeDesignText(store.get(id), v, region))));

  server.registerTool('describe_design', {
    description: '用文字描述設計：對稱性、色塊分佈、外框、低對比、縮圖。不能看圖時用它檢查成果',
    inputSchema: { designId, variant },
  }, wrap(({ designId: id, variant: v }) => ok(describeDesign(store.get(id), v, store.palette))));

  server.registerTool('render_preview', {
    description: '渲染預覽圖。view: flat 平面 / pattern 施工圖 / 3d 立體 / ironed 燙後；variant 填 "all" 會並排所有版本',
    inputSchema: { designId, variant, view: ViewE.default('flat'), scale: z.number().min(0.5).max(3).default(1) },
  }, wrap(async ({ designId: id, variant: v, view, scale }) => {
    const d = store.get(id);
    if (vision === 'off') return ok(describeDesign(d, v === 'all' ? undefined : v, store.palette));
    const png = await renderPng(d, store.palette, { variant: v, view: view as View, scale });
    return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
  }));

  server.registerTool('get_palette', {
    description: '列出顏色：每行「色號 名稱 hex 庫存N」。mode 省略時用該版本的色彩範圍',
    inputSchema: { mode: Mode.optional(), designId, variant },
  }, wrap(({ mode, designId: id, variant: v }) => {
    const m = mode ?? getVariant(store.get(id), v).paletteMode;
    const codes = allowedCodes(store.palette, store.inventory, m);
    return ok(store.palette.entries(codes).map((e) => {
      const s = store.inventory[e.code];
      return `${e.code} ${e.name} ${e.displayHex} 庫存${s?.owned ? s.count : 0}${e.transparent ? ' 透明' : ''}`;
    }).join('\n'));
  }));

  server.registerTool('run_checks', { description: '執行檢查器（留邊、浮豆、細線、掛孔、庫存、對比）', inputSchema: { designId, variant } },
    wrap(({ designId: id, variant: v }) => ok(checksText(id, v))));

  server.registerTool('apply_ops', {
    description: [
      '批次修改設計（原子性：任一條失敗則全部不套用；整批算一個 undo 步驟）。',
      '座標從 0 開始，x 往右、y 往下。超出畫布的部分會被裁切並回報。',
      'op 種類：paste{x,y,rows,legend}（"."不動 "_"清除；rows 可用與 get_design 相同的 RLE，例如 "3a2.b"）、rect/ellipse{x,y,w,h,color,fill?}、line{x1,y1,x2,y2,color}、',
      'polygon{points,color,fill?}、fill{x,y,color}、replace_color{from,to,region?}、clear{region}、move{region,dx,dy}、',
      'mirror{region,axis:h|v}、rotate{region,turns:1|2|3}、outline{target:"shape"|色號,color,side:outer|inner,connect?:4|8}、',
      'gradient{target,colors[],direction:h|v|radial|角度,region?,dither?}、shade{target,light:tl|t|tr|l|r|bl|b|br,highlight,shadow,depth?}、',
      'set_hole{x,y,remove?}',
    ].join(''),
    inputSchema: { designId, variant, ops: z.array(OpSchema).min(1) },
  }, wrap(({ designId: id, variant: v, ops }) => {
    let summary!: Summary;
    const d = store.update(id, (cur) => { const r = applyOps(cur, ops, store.ctx(), v); summary = r.summary; return r.design; });
    return ok(summaryText(summary, checksText(d.id, summary.variant)));
  }));

  server.registerTool('set_board', {
    description: '改面板尺寸／豆子尺寸／留邊。換豆子尺寸時 keep: cells（保持格數）或 size（保持實體尺寸、重新取樣）。會裁掉豆子時需 force: true',
    inputSchema: {
      designId, widthMm: z.number().positive().optional(), heightMm: z.number().positive().optional(),
      bead: z.union([z.literal(2.6), z.literal(5)]).optional(), margin: z.number().int().min(0).optional(),
      keep: z.enum(['cells', 'size']).default('size'), force: z.boolean().default(false),
    },
  }, wrap(({ designId: id, keep, force, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    let cropped = 0;
    const d = store.update(id, (cur) => { const r = setBoard(cur, clean, { keep, force }); cropped = r.cropped; return r.design; });
    return ok(`面板 ${d.board.widthMm}×${d.board.heightMm}mm、${d.board.bead}mm 豆 → ${d.cols}×${d.rows} 格，留邊 ${d.board.margin}${cropped ? `，裁掉 ${cropped} 顆` : ''}`);
  }));

  server.registerTool('create_variant', {
    description: '從現有版本複製出新配色版本，依色彩範圍自動換成最接近的顏色（stock 模式會遵守庫存數量）',
    inputSchema: { designId, name: z.string(), paletteMode: Mode, from: z.string().optional() },
  }, wrap(({ designId: id, name, paletteMode, from }) => {
    let vid = '';
    store.update(id, (cur) => { const r = createVariant(cur, { name, paletteMode, from }, store.ctx()); vid = r.id; return r.design; });
    return ok(`已建立配色版本 ${vid}「${name}」（${paletteMode}）`);
  }));

  server.registerTool('set_variant_mode', {
    description: '變更某版本的色彩範圍並重新對色',
    inputSchema: { designId, variant: z.string(), paletteMode: Mode },
  }, wrap(({ designId: id, variant: v, paletteMode }) => {
    store.update(id, (cur) => recolorVariant(cur, v, store.ctx(), { mode: paletteMode }));
    return ok(`版本 ${v} 已改為 ${paletteMode} 並重新對色`);
  }));

  server.registerTool('select_variant', { description: '切換目前顯示的配色版本', inputSchema: { designId, variant: z.string() } },
    wrap(({ designId: id, variant: v }) => { store.update(id, (cur) => selectVariant(cur, v)); return ok(`目前版本：${v}`); }));

  server.registerTool('set_shape_lock', { description: '鎖定形狀（只能換色）或解鎖', inputSchema: { designId, locked: z.boolean() } },
    wrap(({ designId: id, locked }) => { store.update(id, (cur) => ({ ...cur, shapeLocked: locked })); return ok(locked ? '🔒 形狀已鎖定' : '🔓 形狀已解鎖'); }));

  server.registerTool('import_image', {
    description: '導入圖片。含 bead-studio metadata 的 PNG 會還原成新作品；其他圖片會轉換到目前作品的指定版本（覆蓋原內容）',
    inputSchema: { path: z.string(), designId, variant, removeBg: z.boolean().default(false), dither: z.boolean().default(false) },
  }, wrap(async ({ path, designId: id, variant: v, removeBg, dither }) => {
    const buf = readFileSync(path);
    const known = (cells: (string | null)[]) => cells.every((c) => c === null || store.palette.has(c));
    const meta = extractDesign(buf);
    if (meta && meta.variants.every((x) => known(x.cells))) {
      meta.snapshots = meta.snapshots.filter((s) => s.design.variants.every((x) => known(x.cells)));
      const d = store.importDesign(meta);
      return ok(`已從 PNG metadata 還原作品 ${d.id}「${d.name}」`);
    }
    const notice = hasDesignMeta(buf) ? '⚠ PNG 內的 bead-studio metadata 無效或含有目前色表沒有的色號，已改用一般圖片轉換\n' : '';
    const img = await loadImage(buf);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    const d = store.update(id, (cur) => {
      if (cur.shapeLocked) throw new OpError('shape_locked', '形狀已鎖定，無法導入圖片（會改變豆子位置）');
      const target = getVariant(cur, v);
      const allowed = store.palette.entries(allowedCodes(store.palette, store.inventory, target.paletteMode)).filter((e) => !e.transparent);
      const cells = imageToCells(rgba, img.width, img.height, {
        cols: cur.cols, rows: cur.rows, margin: cur.board.margin, allowed, removeBg, dither,
        capacity: target.paletteMode === 'stock' ? stockCapacity(store.inventory) : undefined,
      });
      const next = structuredClone(cur);
      const tv = getVariant(next, target.id);
      tv.cells = cells;
      next.mask = maskFromCells(cells);
      for (const o of next.variants) if (o !== tv) o.cells = o.cells.map(() => null);
      syncOtherVariants(next, tv, store.ctx());
      return next;
    });
    const n = getVariant(d, v).cells.filter(Boolean).length;
    return ok(`${notice}已轉換圖片到 ${d.name}：${n} 顆豆子\n檢查：\n${checksText(d.id, v)}`);
  }));

  server.registerTool('export_png', {
    description: '匯出 PNG（含可還原的 metadata）。variant 填 "all" 會並排所有版本',
    inputSchema: { path: z.string(), designId, variant, view: ViewE.default('flat'), scale: z.number().min(0.5).max(4).default(2) },
  }, wrap(async ({ path, designId: id, variant: v, view, scale }) => {
    if (!path.toLowerCase().endsWith('.png')) throw new OpError('bad_path', `匯出路徑必須以 .png 結尾：${path}`);
    const d = store.get(id);
    writeFileSync(path, embedDesign(await renderPng(d, store.palette, { variant: v, view: view as View, scale }), d));
    return ok(`已匯出 ${path}`);
  }));

  server.registerTool('set_inventory', {
    description: '設定庫存：items 中每個 {code, owned?, count?} 會合併到現有庫存',
    inputSchema: { items: z.array(z.object({ code: z.string(), owned: z.boolean().optional(), count: z.number().int().min(0).optional() })).min(1) },
  }, wrap(({ items }) => {
    const inv = store.setInventory(items);
    const owned = Object.entries(inv).filter(([, s]) => s.owned);
    return ok(`已更新。目前擁有 ${owned.length} 色，共 ${owned.reduce((a, [, s]) => a + s.count, 0)} 顆`);
  }));

  server.registerTool('snapshot', { description: '儲存快照（大改之前建議先存）', inputSchema: { designId, name: z.string() } },
    wrap(({ designId: id, name }) => { const s = store.snapshot(id, name); return ok(`已儲存快照 ${s.id}「${s.name}」`); }));

  server.registerTool('restore_snapshot', { description: '還原快照（可再 undo）', inputSchema: { designId, snapshotId: z.string() } },
    wrap(({ designId: id, snapshotId }) => { store.restoreSnapshot(id, snapshotId); return ok(`已還原快照 ${snapshotId}`); }));

  server.registerTool('undo', { description: '復原上一步', inputSchema: { designId } },
    wrap(({ designId: id }) => { const d = store.undo(id); return ok(`已復原（版本 ${d.version}）`); }));

  server.registerTool('redo', { description: '重做', inputSchema: { designId } },
    wrap(({ designId: id }) => { const d = store.redo(id); return ok(`已重做（版本 ${d.version}）`); }));

  return server;
}
