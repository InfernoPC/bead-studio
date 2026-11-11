import Fastify from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OpError } from '../core/errors';
import { buildMcpServer, type Vision } from './mcp';
import type { PathOpts } from './paths';
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

export function buildApp(store: DesignStore, opts: AppOpts = {}) {
  const app = Fastify({ logger: false });

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

  return app;
}
