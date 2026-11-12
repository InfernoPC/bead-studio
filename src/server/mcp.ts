import { readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setBoard } from '../core/board';
import { formatIssues, runChecks } from '../core/checks';
import { describeDesign } from '../core/describe';
import { OpError } from '../core/errors';
import type { Design } from '../core/model';
import { MAX_BOARD_MM, MAX_OPS, OpSchema, RegionSchema } from '../core/opSchema';
import { applyOps, type Summary } from '../core/ops';
import { encodeDesignText } from '../core/textCodec';
import type { DeductionPlan } from '../core/palette';
import { resolveUserPath, type PathOpts } from './paths';
import { importImageBuffer } from './importBuffer';
import { embedDesign } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

export type Vision = 'auto' | 'on' | 'off';

const ViewE = z.enum(['flat', 'pattern', '3d', 'ironed']);
const designId = z.string().optional().describe('作品 id；省略時用目前開啟的作品');
const PixelRect = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) });

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
    `OK 共 ${s.total} 顆（${total >= 0 ? '+' : ''}${total}）`,
    `變化：${delta}`,
    s.clipped ? `裁切：${s.clipped} 格超出畫布被略過` : '',
    `檢查：\n${checks}`,
  ].filter(Boolean).join('\n');
}

function deductionText(d: Design, plan: DeductionPlan): string {
  const tail = [
    plan.outOfStock.length ? `已經沒有庫存（不夠）：${plan.outOfStock.map((r) => `${r.code} 不夠 ${r.used} 顆`).join('、')}` : '',
    plan.skipped.length ? `未擁有、沒有扣：${plan.skipped.map((r) => r.code).join('、')}` : '',
  ];
  if (plan.deducted.length === 0) {
    return [`「${d.name}」沒有用到還有庫存的顏色，庫存沒有變動。`, ...tail].filter(Boolean).join('\n');
  }
  const out = plan.deducted.map((r) => {
    const short = r.used - r.before;
    return `${r.code} 扣 ${r.before - r.after} 顆（${r.before} → ${r.after}）${short > 0 ? `，不夠 ${short} 顆` : ''}`;
  });
  const empty = plan.deducted.filter((r) => r.after === 0).map((r) => r.code);
  return [
    `已從庫存扣掉「${d.name}」用掉的豆子：`,
    ...out,
    empty.length ? `扣到 0 的色號：${empty.join('、')}` : '',
    ...tail,
  ].filter(Boolean).join('\n');
}

export function buildMcpServer(store: DesignStore, opts: { vision?: Vision } & PathOpts = {}): McpServer {
  const vision = opts.vision ?? 'auto';
  const server = new McpServer({ name: 'bead-studio', version: '0.1.0' });
  const checksText = (id?: string) =>
    formatIssues(runChecks(store.get(id), { ...store.ctx(), config: store.checks }));

  server.registerTool('list_designs', { description: '列出所有作品（* 表示目前開啟）', inputSchema: {} },
    wrap(() => ok(store.list().map((d) => `${d.current ? '*' : ' '} ${d.id} ${d.name} v${d.version}`).join('\n') || '（沒有作品）')));

  server.registerTool('open_design', { description: '開啟作品，之後的操作預設作用於它（瀏覽器也會切換）', inputSchema: { id: z.string() } },
    wrap(({ id }) => { const d = store.open(id); return ok(`已開啟 ${d.name}（${d.cols}×${d.rows}）`); }));

  server.registerTool('new_design', {
    description: '建立新作品並開啟。尺寸以 mm 指定，格數自動換算 = floor(mm / bead)',
    inputSchema: {
      name: z.string(), widthMm: z.number().positive().max(MAX_BOARD_MM), heightMm: z.number().positive().max(MAX_BOARD_MM),
      bead: z.union([z.literal(2.6), z.literal(5)]), margin: z.number().int().min(0).default(2),
    },
  }, wrap(({ name, widthMm, heightMm, bead, margin }) => {
    const d = store.create(name, { widthMm, heightMm, bead, margin });
    return ok(`已建立 ${d.id}「${d.name}」：${d.cols}×${d.rows} 格，留邊 ${margin} 格`);
  }));

  server.registerTool('get_design', {
    description: '讀取設計（只回傳有豆子的範圍，每列 RLE：數字=重複次數，"."=空格）。region {x,y,w,h} 可只讀取某一區',
    inputSchema: { designId, region: RegionSchema.optional() },
  }, wrap(({ designId: id, region }) => ok(encodeDesignText(store.get(id), region))));

  server.registerTool('describe_design', {
    description: '用文字描述設計：對稱性、色塊分佈、外框、低對比、縮圖。不能看圖時用它檢查成果',
    inputSchema: { designId },
  }, wrap(({ designId: id }) => ok(describeDesign(store.get(id), store.palette))));

  server.registerTool('render_preview', {
    description: '渲染預覽圖。view: flat 平面 / pattern 施工圖 / 3d 立體 / ironed 燙後',
    inputSchema: { designId, view: ViewE.default('flat'), scale: z.number().min(0.5).max(3).default(1) },
  }, wrap(async ({ designId: id, view, scale }) => {
    const d = store.get(id);
    if (vision === 'off') return ok(describeDesign(d, store.palette));
    const png = await renderPng(d, store.palette, { view: view as View, scale });
    return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
  }));

  server.registerTool('get_palette', {
    description: '列出所有顏色：每行「色號 名稱 hex 庫存N」（庫存0 代表沒有這個顏色）',
    inputSchema: {},
  }, wrap(() => {
    return ok(store.palette.all().map((e) => {
      const s = store.inventory[e.code];
      return `${e.code} ${e.name} ${e.displayHex} 庫存${s?.owned ? s.count : 0}${e.transparent ? ' 透明' : ''}`;
    }).join('\n'));
  }));

  server.registerTool('run_checks', { description: '執行檢查器（留邊、浮豆、細線、掛孔、庫存、對比）', inputSchema: { designId } },
    wrap(({ designId: id }) => ok(checksText(id))));

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
    inputSchema: { designId, ops: z.array(OpSchema).min(1).max(MAX_OPS) },
  }, wrap(({ designId: id, ops }) => {
    let summary!: Summary;
    const d = store.update(id, (cur) => { const r = applyOps(cur, ops, store.ctx()); summary = r.summary; return r.design; });
    // structuredContent 的版本給網頁判斷「伺服器的設計已含這一筆」；AI 只看文字
    return { ...ok(summaryText(summary, checksText(d.id))), structuredContent: { version: d.version } };
  }));

  server.registerTool('set_board', {
    description: '改面板尺寸／豆子尺寸／留邊。換豆子尺寸時 keep: cells（保持格數）或 size（保持實體尺寸、重新取樣）。會裁掉豆子時需 force: true',
    inputSchema: {
      designId, widthMm: z.number().positive().max(MAX_BOARD_MM).optional(), heightMm: z.number().positive().max(MAX_BOARD_MM).optional(),
      bead: z.union([z.literal(2.6), z.literal(5)]).optional(), margin: z.number().int().min(0).optional(),
      keep: z.enum(['cells', 'size']).default('size'), force: z.boolean().default(false),
    },
  }, wrap(({ designId: id, keep, force, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    let cropped = 0;
    const d = store.update(id, (cur) => { const r = setBoard(cur, clean, { keep, force }); cropped = r.cropped; return r.design; });
    return ok(`面板 ${d.board.widthMm}×${d.board.heightMm}mm、${d.board.bead}mm 豆 → ${d.cols}×${d.rows} 格，留邊 ${d.board.margin}${cropped ? `，裁掉 ${cropped} 顆` : ''}`);
  }));

  server.registerTool('calibrate_color', {
    description: '校正某色號的顯示色（讓螢幕更接近實物）；hex 填 null 清除校正',
    inputSchema: { code: z.string(), hex: z.string().nullable() },
  }, wrap(({ code, hex }) => { store.setCalibration(code, hex); return ok(hex ? `已校正 ${code} 為 ${hex}` : `已清除 ${code} 的校正`); }));

  server.registerTool('import_image', {
    description: (opts.filesDir ? `只能使用 ${opts.filesDir} 裡的檔案。` : '') + '導入圖片。含 bead-studio metadata 的 PNG 會還原成新作品；其他圖片會轉換到目前作品的指定版本（覆蓋原內容）。'
      + 'removeBg 只去掉從圖片外圍連進來的背景色（被外框圍住的同色區塊會保留）；colors 限定只用哪些色號；crop 只取原圖某一塊；exclude 把原圖上的區塊（例如文字）當背景略過。crop／exclude 的座標是原圖像素',
    inputSchema: {
      path: z.string(), designId, removeBg: z.boolean().default(false), dither: z.boolean().default(false),
      colors: z.array(z.string().min(1)).min(1).max(64).optional(),
      crop: PixelRect.optional(), exclude: z.array(PixelRect).max(32).optional(),
    },
  }, wrap(async ({ path, designId: id, removeBg, dither, colors, crop, exclude }) =>
    ok(await importImageBuffer(store, readFileSync(resolveUserPath(path, opts)), { designId: id, removeBg, dither, colors, crop, exclude }))));

  server.registerTool('export_png', {
    description: (opts.filesDir ? `只能寫到 ${opts.filesDir} 裡。` : '') + '匯出 PNG（含可還原的 metadata）',
    inputSchema: { path: z.string(), designId, view: ViewE.default('flat'), scale: z.number().min(0.5).max(4).default(2) },
  }, wrap(async ({ path, designId: id, view, scale }) => {
    if (!path.toLowerCase().endsWith('.png')) throw new OpError('bad_path', `匯出路徑必須以 .png 結尾：${path}`);
    const target = resolveUserPath(path, opts);
    const d = store.get(id);
    writeFileSync(target, embedDesign(await renderPng(d, store.palette, { view: view as View, scale }), d));
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

  server.registerTool('deduct_inventory', {
    description: '使用者做完作品後扣庫存：擁有的顏色扣掉這個作品的用量（最少扣到 0），未擁有的色號不動。不能復原，呼叫前先跟使用者確認',
    inputSchema: { designId },
  }, wrap(({ designId: id }) => {
    const d = store.get(id);
    return ok(deductionText(d, store.deductInventory(d)));
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
