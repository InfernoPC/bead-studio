import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import { createCanvas } from '@napi-rs/canvas';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { FIX_COLORS } from './fixtures';

let app: Awaited<ReturnType<typeof buildApp>>, base: string, store: DesignStore, dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'beads-api-'));
  mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = await buildApp(store);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

const tool = (name: string, args: object) =>
  fetch(`${base}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }).then((r) => r.json());

describe('REST API', () => {
  it('state snapshot reflects tool calls', async () => {
    expect((await tool('new_design', { name: '狀態', widthMm: 50, heightMm: 50, bead: 5, margin: 1 })).ok).toBe(true);
    await tool('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 2, h: 1, color: 'A1' }] });
    const s = await (await fetch(`${base}/api/state`)).json();
    expect(s.current.name).toBe('狀態');
    expect(s.current.mask).toContain('1');
    expect(s.palette.length).toBe(FIX_COLORS.length);
    expect(s.checks.thinChainMin).toBeTypeOf('number');
    expect(s.mcpUrl).toMatch(/\/mcp$/);
  });
  it('tool errors come back as ok=false with 200', async () => {
    const r = await tool('apply_ops', { ops: [{ op: 'nope' }] });
    expect(r.ok).toBe(false);
  });
  it('calibrate_color persists and changes state', async () => {
    expect((await tool('calibrate_color', { code: 'A1', hex: '#123456' })).ok).toBe(true);
    const s = await (await fetch(`${base}/api/state`)).json();
    expect(s.palette.find((c: any) => c.code === 'A1').calibratedHex).toBe('#123456');
    expect(JSON.parse(readFileSync(join(dir, 'data/palette.json'), 'utf8')).find((c: any) => c.code === 'A1').calibratedHex).toBe('#123456');
    await tool('calibrate_color', { code: 'A1', hex: null });
    expect((await (await fetch(`${base}/api/state`)).json()).palette.find((c: any) => c.code === 'A1').calibratedHex).toBeUndefined();
  });
  it('import endpoint converts an uploaded image', async () => {
    const c = createCanvas(4, 4); const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 4, 4);
    const r = await (await fetch(`${base}/api/import`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(await c.encode('png')) })).json();
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/轉換/);
  });
  it('import endpoint falls back with notice', async () => {
    const c = createCanvas(4, 4); c.getContext('2d').fillRect(0, 0, 4, 4);
    const chunks = extract(await c.encode('png'));
    const body = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from('{"bad":1}'))]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
    const r = await (await fetch(`${base}/api/import`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(encode(chunks)) })).json();
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/metadata 無效/);
  });
  it('rejects cross-origin tool calls', async () => {
    const r = await fetch(`${base}/api/tools/list_designs`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403);
  });
});
