import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { extractDesign } from '../src/server/pngmeta';
import { FIX_COLORS } from './fixtures';

let app: ReturnType<typeof buildApp>;
let base: string;
let store: DesignStore;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-app-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = buildApp(store);
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
});
