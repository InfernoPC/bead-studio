import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import websocket from '@fastify/websocket';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OpError } from '../core/errors';
import type { Design } from '../core/model';
import { buildMcpServer, type Vision } from './mcp';
import type { PathOpts } from './paths';
import { importImageBuffer } from './importBuffer';
import { createToolClient } from './toolClient';
import { embedDesign } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

const VIEWS: View[] = ['flat', 'pattern', '3d', 'ironed'];

export type AppOpts = PathOpts & {
  vision?: Vision;
  /** 額外允許的 Host（host:port），預設只允許 localhost:PORT 與 127.0.0.1:PORT */
  allowedHosts?: string[];
};

function hostOf(origin: string): string | null {
  try { return new URL(origin).host.toLowerCase() || null; } catch { return null; }
}

export async function buildApp(store: DesignStore, opts: AppOpts = {}) {
  const app = Fastify({ logger: false });
  const tools = await createToolClient(store, opts);
  app.addHook('onClose', async () => { await tools.close(); });

  // 必須先於 Host/Origin 檢查註冊：其 onRequest 標記 upgrade 請求，onResponse 才會在被拒（403）時銷毀 socket
  await app.register(websocket);

  // 防 DNS rebinding／跨站請求：Host 與 Origin 都必須是本機或明確允許的主機
  const extra = (opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowedHosts = () => {
    const addr = app.server.address();
    const port = addr && typeof addr === 'object' ? addr.port : undefined;
    return new Set([...(port ? [`localhost:${port}`, `127.0.0.1:${port}`] : []), ...extra]);
  };
  app.addHook('onRequest', async (req, reply) => {
    const allowed = allowedHosts();
    const host = req.headers.host?.toLowerCase();
    const origin = req.headers.origin;
    if (!host || !allowed.has(host) || (origin !== undefined && !allowed.has(hostOf(origin) ?? ''))) {
      return reply.code(403).send({ error: '拒絕存取：不允許的 Host 或 Origin' });
    }
  });

  const sockets = new Set<import('ws').WebSocket>();
  const send = (msg: unknown) => { const s = JSON.stringify(msg); for (const ws of sockets) if (ws.readyState === 1) ws.send(s); };
  const onChange = (design: Design) => send({ type: 'design', design, history: store.historyDepth(design.id) });
  const onMeta = () => send({ type: 'meta' });
  store.on('change', onChange);
  store.on('meta', onMeta);
  app.addHook('onClose', async () => { store.off('change', onChange); store.off('meta', onMeta); for (const s of sockets) s.terminate(); });
  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello' }));
    socket.on('close', () => sockets.delete(socket));
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/mcp', async (req, reply) => {
    const server = buildMcpServer(store, opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  });
  const notAllowed = async (_: unknown, reply: any) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  app.get<{ Params: { id: string }; Querystring: { variant?: string; view?: View; scale?: string } }>(
    '/api/designs/:id/export.png',
    async (req, reply) => {
      const view = req.query.view ?? 'flat';
      if (!VIEWS.includes(view)) return reply.code(400).send({ error: `view 必須是 ${VIEWS.join('|')}` });
      const scale = Number(req.query.scale ?? 2);
      if (!Number.isFinite(scale) || scale < 0.5 || scale > 4) return reply.code(400).send({ error: 'scale 必須介於 0.5 到 4' });
      try {
        const d = store.get(req.params.id);
        const png = await renderPng(d, store.palette, { variant: req.query.variant, view, scale });
        return reply.type('image/png').send(embedDesign(png, d));
      } catch (e) {
        if (e instanceof OpError && (e.code === 'no_design' || e.code === 'no_variant')) return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );

  app.get('/api/state', async () => {
    let current = null;
    try { current = store.get(); } catch { /* 尚未開啟作品 */ }
    const port = (app.server.address() as any)?.port;
    return {
      designs: store.list(), current, history: current ? store.historyDepth(current.id) : null, palette: store.paletteColors, inventory: store.inventory,
      checks: store.checks, mcpUrl: `http://localhost:${port}/mcp`,
    };
  });

  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>('/api/tools/:name', async (req) =>
    tools.call(req.params.name, (req.body ?? {}) as Record<string, unknown>));

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_r, body, done) => done(null, body));
  app.post<{ Querystring: { variant?: string; removeBg?: string; dither?: string } }>('/api/import', async (req) => {
    try {
      const text = await importImageBuffer(store, req.body as Buffer, {
        variant: req.query.variant, removeBg: req.query.removeBg === '1', dither: req.query.dither === '1',
      });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, text: e instanceof OpError ? `${e.code}: ${e.message}` : `圖片無法讀取：${(e as Error).message}` };
    }
  });

  const webDir = resolve('dist/web');
  if (existsSync(webDir)) await app.register(fastifyStatic, { root: webDir });

  return app;
}
