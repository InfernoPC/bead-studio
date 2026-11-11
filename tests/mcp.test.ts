import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCanvas } from '@napi-rs/canvas';
import { DesignStore } from '../src/server/store';
import { buildMcpServer, type Vision } from '../src/server/mcp';
import { embedDesign, extractDesign } from '../src/server/pngmeta';
import { renderPng } from '../src/server/render';
import { createDesign } from '../src/core/model';
import { palette } from './fixtures';
import { FIX_COLORS } from './fixtures';

let dir: string;
let store: DesignStore;

async function connect(vision: Vision = 'on', extra: { filesDir?: string; homeDir?: string } = {}) {
  const server = buildMcpServer(store, { vision, ...extra });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as any;
  const text = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    return { ok: !r.isError, text: r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), raw: r };
  };
  return { client, call, text };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beads-mcp-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
});

const NEW = { name: '測試', widthMm: 50, heightMm: 50, bead: 5, margin: 1 };

describe('MCP tools', () => {
  it('lists all tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apply_ops', 'calibrate_color', 'create_variant', 'describe_design', 'export_png', 'get_design', 'get_palette',
      'import_image', 'list_designs', 'new_design', 'open_design', 'redo', 'render_preview',
      'restore_snapshot', 'run_checks', 'select_variant', 'set_board', 'set_inventory',
      'set_shape_lock', 'set_variant_mode', 'snapshot', 'undo',
    ]);
  });

  it('new_design → apply_ops → get_design round trip with summary and checks', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1' }] });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/共 2 顆/);
    expect(r.text).toMatch(/A1 \+2/);
    expect(r.text).toMatch(/超出留邊/);
    const g = await text('get_design');
    expect(g.text).toMatch(/legend: a=A1/);
    expect(g.text).toMatch(/y0: 2a/);
  });

  it('get_design can read just a region', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'paste', x: 1, y: 1, rows: ['2a3.2b'], legend: { a: 'A1', b: 'H2' } }] });
    const g = await text('get_design', { region: { x: 5, y: 0, w: 5, h: 5 } });
    expect(g.text).toMatch(/bbox=\(6,1\)-\(7,1\)/);
    expect(g.text).toMatch(/legend: a=H2\n/);
    expect(g.text).toMatch(/y1: 2a/);
  });

  it('apply_ops errors are reported, not thrown, and leave the design unchanged', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }, { op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'NOPE' }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/unknown_color/);
    expect(store.get().version).toBe(0);
  });

  it('render_preview returns an image when vision is on, text when off', async () => {
    const on = await connect('on');
    await on.text('new_design', NEW);
    const img = await on.call('render_preview', { view: '3d' });
    expect(img.content[0].type).toBe('image');
    expect(img.content[0].mimeType).toBe('image/png');
    const off = await connect('off');
    const t = await off.text('render_preview');
    expect(t.text).toMatch(/畫面空白/);
  });

  it('variants, shape lock and palette modes', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('set_inventory', { items: [{ code: 'A1', owned: true, count: 1 }, { code: 'A2', owned: true, count: 10 }] });
    await text('apply_ops', { ops: [{ op: 'rect', x: 3, y: 3, w: 3, h: 1, color: 'A4' }] });
    const cv = await text('create_variant', { name: '庫存版', paletteMode: 'stock' });
    expect(cv.text).toMatch(/v2/);
    const counts = store.get().variants[1].cells.filter(Boolean);
    expect(counts.filter((c) => c === 'A1')).toHaveLength(1);
    await text('set_shape_lock', { locked: true });
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }] });
    expect(r.text).toMatch(/shape_locked/);
    const sel = await text('select_variant', { variant: 'v2' });
    expect(sel.ok).toBe(true);
    expect(store.get().activeVariant).toBe('v2');
    const mode = await text('set_variant_mode', { variant: 'v2', paletteMode: 'owned' });
    expect(mode.ok).toBe(true);
  });

  it('get_palette lists colors with stock for the given mode', async () => {
    const { text } = await connect();
    await text('set_inventory', { items: [{ code: 'A1', owned: true, count: 200 }] });
    const r = await text('get_palette', { mode: 'owned' });
    expect(r.text.trim()).toBe('A1 紅 #E8434F 庫存200');
  });

  it('caps board size and ops count', async () => {
    const { text } = await connect();
    expect((await text('new_design', { ...NEW, widthMm: 6000 })).ok).toBe(false);
    await text('new_design', NEW);
    expect((await text('set_board', { heightMm: 6000 })).ok).toBe(false);
    const ops = Array.from({ length: 501 }, () => ({ op: 'set_hole', x: 0, y: 0 }));
    expect((await text('apply_ops', { ops })).ok).toBe(false);
  });

  it('set_board refuses to crop without force', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }] });
    const r = await text('set_board', { widthMm: 40, heightMm: 40 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/would_crop/);
    const ok = await text('set_board', { widthMm: 40, heightMm: 40, force: true });
    expect(ok.ok).toBe(true);
    expect(store.get().cols).toBe(8);
  });

  it('export_png embeds metadata; import_image restores it as a new design', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 2, h: 2, color: 'C1' }] });
    const out = join(dir, 'out.png');
    await text('export_png', { path: out, view: 'pattern' });
    expect(extractDesign(readFileSync(out))!.mask).toBe(store.get().mask);
    const before = store.list().length;
    const r = await text('import_image', { path: out });
    expect(r.text).toMatch(/還原/);
    expect(store.list().length).toBe(before + 1);
  });

  it('import_image / export_png are confined to filesDir when set', async () => {
    const files = join(dir, 'BeadStudio');
    mkdirSync(files);
    const { text } = await connect('on', { filesDir: files, homeDir: dir });
    await text('new_design', NEW);
    const outside = await text('export_png', { path: join(dir, 'out.png') });
    expect(outside.ok).toBe(false);
    expect(outside.text).toMatch(/bad_path.*只能使用/);
    const inside = await text('export_png', { path: '~/BeadStudio/out.png' });
    expect(inside.ok).toBe(true);
    expect(extractDesign(readFileSync(join(files, 'out.png')))).not.toBeNull();
    const imp = await text('import_image', { path: join(dir, 'data/palette.json') });
    expect(imp.text).toMatch(/bad_path/);
  });

  it('export_png only writes .png paths', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const r = await text('export_png', { path: join(dir, 'x.txt') });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/bad_path/);
    const ok = await text('export_png', { path: join(dir, 'UP.PNG') });
    expect(ok.ok).toBe(true);
  });

  it('import_image restores metadata missing markers/snapshots and the result is editable', async () => {
    const { text } = await connect();
    const { markers: _m, snapshots: _s, ...rest } = createDesign({ id: 'x', name: '舊格式', board: { widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    const p = join(dir, 'old.png');
    writeFileSync(p, embedDesign(await renderPng(createDesign({ id: 'x', name: 'x', board: rest.board }), palette, {}), rest as any));
    const r = await text('import_image', { path: p });
    expect(r.text).toMatch(/還原/);
    const a = await text('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 1, h: 1, color: 'A1' }, { op: 'set_hole', x: 0, y: 0 }] });
    expect(a.ok).toBe(true);
    expect(store.get().markers).toEqual([{ type: 'hole', x: 0, y: 0 }]);
  });

  it('import_image falls back to conversion with a notice when metadata uses unknown colors', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const bad = createDesign({ id: 'x', name: '外來', board: { widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    bad.variants[0].cells[0] = 'ZZ9';
    bad.mask = '1' + bad.mask.slice(1);
    const p = join(dir, 'foreign.png');
    writeFileSync(p, embedDesign(await renderPng(createDesign({ id: 'x', name: 'x', board: bad.board }), palette, {}), bad));
    const before = store.list().length;
    const r = await text('import_image', { path: p });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/metadata/);
    expect(r.text).toMatch(/轉換/);
    expect(store.list().length).toBe(before);
  });

  it('import_image checks the shape lock before converting', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('set_variant_mode', { variant: 'v1', paletteMode: 'owned' });
    await text('set_shape_lock', { locked: true });
    const c = createCanvas(4, 4);
    const p = join(dir, 'lock.png');
    writeFileSync(p, await c.encode('png'));
    const r = await text('import_image', { path: p });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/shape_locked/);
  });

  it('import_image falls back to image conversion for a plain PNG', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const c = createCanvas(4, 4);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 4, 4);
    const p = join(dir, 'plain.png');
    writeFileSync(p, await c.encode('png'));
    const r = await text('import_image', { path: p });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/轉換/);
    expect(store.get().variants[0].cells.filter((x) => x === 'C1').length).toBe(64);
  });

  it('undo, redo, snapshot and restore', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const s = await text('snapshot', { name: '空白' });
    const snapId = s.text.match(/s-[a-z0-9]+/)![0];
    await text('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 1, h: 1, color: 'A1' }] });
    await text('undo');
    expect(store.get().mask).not.toContain('1');
    await text('redo');
    expect(store.get().mask).toContain('1');
    await text('restore_snapshot', { snapshotId: snapId });
    expect(store.get().mask).not.toContain('1');
  });

  it('describe_design and run_checks return text', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 5, y: 5, w: 1, h: 1, color: 'A1' }] });
    expect((await text('describe_design')).text).toMatch(/A1 紅 1 顆/);
    expect((await text('run_checks')).text).toMatch(/浮豆/);
  });
});
