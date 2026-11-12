import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { extractDesign } from '../src/server/pngmeta';
import { FIX_COLORS } from './fixtures';

let app: Awaited<ReturnType<typeof buildApp>>;
let base: string;
let store: DesignStore;

function rawGet(path: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const r = request({ host: u.hostname, port: u.port, path, method: 'GET', headers }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on('error', reject);
    r.end();
  });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-app-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = await buildApp(store);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

describe('http app', () => {
  it('health check', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });
  it('serves MCP over streamable HTTP', async () => {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'apply_ops')).toBe(true);
    const r: any = await client.callTool({ name: 'new_design', arguments: { name: 'http', widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    expect(r.content[0].text).toMatch(/已建立/);
    await client.close();
  });
  it('rejects GET /mcp with 405', async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
  it('exports PNG with metadata', async () => {
    const d = store.list()[0];
    const res = await fetch(`${base}/api/designs/${d.id}/export.png?view=pattern`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(extractDesign(Buffer.from(await res.arrayBuffer()))!.id).toBe(d.id);
  });
  it('404s for unknown design export', async () => {
    expect((await fetch(`${base}/api/designs/nope/export.png`)).status).toBe(404);
  });
  it('rejects bad export params', async () => {
    const d = store.list()[0];
    const u = `${base}/api/designs/${d.id}/export.png`;
    expect((await fetch(`${u}?view=bogus`)).status).toBe(400);
    expect((await fetch(`${u}?scale=1000`)).status).toBe(400);
    expect((await fetch(`${u}?scale=abc`)).status).toBe(400);
  });
  it('rejects requests whose Host is not localhost (DNS rebinding)', async () => {
    const port = new URL(base).port;
    expect(await rawGet('/health', { host: `evil.example:${port}` })).toBe(403);
    expect(await rawGet('/mcp', { host: `evil.example:${port}` })).toBe(403);
    expect(await rawGet('/health', { host: `localhost:${port}` })).toBe(200);
    expect(await rawGet('/health', { host: `127.0.0.1:${port}` })).toBe(200);
  });
  it('rejects cross-origin requests even with a good Host', async () => {
    const port = new URL(base).port;
    expect(await rawGet('/health', { host: `localhost:${port}`, origin: 'http://evil.example' })).toBe(403);
    expect(await rawGet('/health', { host: `localhost:${port}`, origin: 'null' })).toBe(403);
    expect(await rawGet('/health', { host: `localhost:${port}`, origin: `http://127.0.0.1:${port}` })).toBe(200);
  });
  it('accepts extra allowed hosts', async () => {
    const extra = await buildApp(store, { allowedHosts: ['beads.lan:8080'] });
    await extra.ready();
    const r = await extra.inject({ method: 'GET', url: '/health', headers: { host: 'beads.lan:8080' } });
    expect(r.statusCode).toBe(200);
    const bad = await extra.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example' } });
    expect(bad.statusCode).toBe(403);
    await extra.close();
  });
});
