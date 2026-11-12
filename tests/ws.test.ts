import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { FIX_COLORS } from './fixtures';

let app: Awaited<ReturnType<typeof buildApp>>, base: string, port: number;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-ws-'));
  mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  const store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = await buildApp(store);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  port = Number(new URL(base).port);
});
afterAll(() => app.close());

function open(origin?: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', origin ? { origin } : {});
  const msgs: any[] = [];
  ws.on('message', (m) => msgs.push(JSON.parse(String(m))));
  return { ws, msgs };
}
const post = (n: string, b: object) => fetch(`${base}/api/tools/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
/** fetch 不能改 Host：直接寫原始 HTTP 請求，回傳狀態碼 */
function statusWithHost(path: string, host: string, upgrade = false): Promise<number> {
  const extra = upgrade
    ? 'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n'
    : 'Connection: close\r\n';
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n${extra}\r\n`));
    s.once('data', (d) => { resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(String(d))?.[1])); s.destroy(); });
    s.on('error', reject);
  });
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
  it('rejects a foreign Host on /ws and on /api/state (DNS rebinding)', async () => {
    expect(await statusWithHost('/api/state', 'evil.example')).toBe(403);
    expect(await statusWithHost('/ws', `evil.example:${port}`, true)).toBe(403);
    // 同樣的請求換成本機 Host 就會通過，確定 403 是 Host 造成的
    expect(await statusWithHost('/api/state', `127.0.0.1:${port}`)).toBe(200);
    expect(await statusWithHost('/ws', `127.0.0.1:${port}`, true)).toBe(101);
  });
  it('a malformed (unmasked, bad opcode) frame or an abrupt reset does not crash the server', async () => {
    const watcher = open();
    await until(() => watcher.msgs.length > 0);
    for (const mode of ['badframe', 'reset'] as const) {
      await new Promise<void>((resolve) => {
        const s = net.connect(port, '127.0.0.1', () => {
          s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        });
        s.on('error', () => {});
        s.once('data', () => {
          if (mode === 'badframe') s.write(Buffer.from([0x8f, 0x00])); // 沒有遮罩、不存在的 opcode
          else s.resetAndDestroy();
          setTimeout(() => { s.destroy(); resolve(); }, 200);
        });
      });
      // 伺服器還活著：之後的修改照樣廣播給其他連線
      const before = watcher.msgs.length;
      await post('new_design', { name: `after-${mode}`, widthMm: 20, heightMm: 20, bead: 5, margin: 0 });
      await until(() => watcher.msgs.length > before);
      expect(watcher.msgs.at(-1)).toMatchObject({ type: 'design', design: { name: `after-${mode}` } });
    }
    watcher.ws.close();
  });
  it('design messages and /api/state list snapshots without their contents; restore still works by id', async () => {
    const { ws, msgs } = open();
    await until(() => msgs.length > 0);
    await post('new_design', { name: 'snap', widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
    await post('apply_ops', { ops: [{ op: 'rect', x: 1, y: 1, w: 1, h: 1, color: 'A1' }] });
    await post('snapshot', { name: '一顆豆' });
    await until(() => msgs.at(-1)?.design?.snapshots?.length === 1);
    const listed = msgs.at(-1).design.snapshots[0];
    expect(Object.keys(listed).sort()).toEqual(['at', 'id', 'name']);
    expect(listed.name).toBe('一顆豆');
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.current.snapshots).toEqual([listed]);

    await post('apply_ops', { ops: [{ op: 'clear', region: { x: 0, y: 0, w: 10, h: 10 } }] });
    expect((await post('restore_snapshot', { snapshotId: listed.id })).ok).toBe(true);
    await until(() => msgs.at(-1)?.design?.cells?.some(Boolean));
    expect(msgs.at(-1).design.cells.filter(Boolean)).toEqual(['A1']);
    ws.close();
  });
});
