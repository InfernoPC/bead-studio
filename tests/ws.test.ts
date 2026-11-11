import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { FIX_COLORS } from './fixtures';

let app: Awaited<ReturnType<typeof buildApp>>, base: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-ws-'));
  mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  const store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = await buildApp(store);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

function open(origin?: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', origin ? { origin } : {});
  const msgs: any[] = [];
  ws.on('message', (m) => msgs.push(JSON.parse(String(m))));
  return { ws, msgs };
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); };

describe('/ws', () => {
  it('greets and broadcasts design changes and meta changes', async () => {
    const { ws, msgs } = open();
    await until(() => msgs.length > 0);
    expect(msgs[0]).toEqual({ type: 'hello' });
    const post = (n: string, b: object) => fetch(`${base}/api/tools/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await post('new_design', { name: 'ws', widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
    await until(() => msgs.some((m) => m.type === 'design'));
    expect(msgs.find((m) => m.type === 'design').design.name).toBe('ws');
    await post('set_inventory', { items: [{ code: 'A1', owned: true, count: 3 }] });
    await until(() => msgs.some((m) => m.type === 'meta'));
    expect(msgs.some((m) => m.type === 'meta')).toBe(true);
    ws.close();
  });
  it('design messages and /api/state carry the undo / redo depth of that design', async () => {
    const { ws, msgs } = open();
    await until(() => msgs.length > 0);
    const post = (n: string, b: object) => fetch(`${base}/api/tools/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const state = async () => (await (await fetch(`${base}/api/state`)).json()).history;
    await post('new_design', { name: 'hist', widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
    await until(() => msgs.some((m) => m.type === 'design'));
    expect(msgs.at(-1).history).toEqual({ undo: 0, redo: 0 });
    expect(await state()).toEqual({ undo: 0, redo: 0 });
    await post('apply_ops', { ops: [{ op: 'rect', x: 1, y: 1, w: 1, h: 1, color: 'A1' }] });
    await until(() => msgs.at(-1).history?.undo === 1);
    expect(msgs.at(-1).history).toEqual({ undo: 1, redo: 0 });
    await post('undo', {});
    await until(() => msgs.at(-1).history?.redo === 1);
    expect(msgs.at(-1).history).toEqual({ undo: 0, redo: 1 });
    expect(await state()).toEqual({ undo: 0, redo: 1 });
    ws.close();
  });
  it('rejects a foreign origin', async () => {
    const { ws } = open('http://evil.example');
    const code = await new Promise((r) => { ws.on('unexpected-response', (_q, res) => r(res.statusCode)); ws.on('error', () => {}); });
    expect(code).toBe(403);
  });
});
