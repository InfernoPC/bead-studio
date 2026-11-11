import Fastify from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OpError } from '../core/errors';
import { buildMcpServer, type Vision } from './mcp';
import { embedDesign } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

export function buildApp(store: DesignStore, opts: { vision?: Vision } = {}) {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post('/mcp', async (req, reply) => {
    const server = buildMcpServer(store, opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  const notAllowed = async (_: unknown, reply: any) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  app.get<{ Params: { id: string }; Querystring: { variant?: string; view?: View; scale?: string } }>(
    '/api/designs/:id/export.png',
    async (req, reply) => {
      try {
        const d = store.get(req.params.id);
        const png = await renderPng(d, store.palette, { variant: req.query.variant, view: req.query.view ?? 'flat', scale: Number(req.query.scale ?? 2) });
        return reply.type('image/png').send(embedDesign(png, d));
      } catch (e) {
        if (e instanceof OpError && e.code === 'no_design') return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );

  return app;
}
