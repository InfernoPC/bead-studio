import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer, type Vision } from './mcp';
import type { PathOpts } from './paths';
import type { DesignStore } from './store';

/** version：修改設計的工具（apply_ops）回報套用後的版本 */
export type ToolResult = { ok: boolean; text: string; images: { data: string; mimeType: string }[]; version?: number };

export async function createToolClient(store: DesignStore, opts: { vision?: Vision } & PathOpts) {
  // UI 永遠要圖片，所以進程內 client 不吃 vision: off
  const server = buildMcpServer(store, { ...opts, vision: opts.vision === 'off' ? 'on' : opts.vision });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'bead-studio-web', version: '1.0.0' });
  await client.connect(ct);
  return {
    async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const r: any = await client.callTool({ name, arguments: args });
        const content: any[] = r.content ?? [];
        return {
          ok: !r.isError,
          text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
          images: content.filter((c) => c.type === 'image').map((c) => ({ data: c.data, mimeType: c.mimeType })),
          ...(typeof r.structuredContent?.version === 'number' ? { version: r.structuredContent.version } : {}),
        };
      } catch (e) {
        return { ok: false, text: (e as Error).message, images: [] };
      }
    },
    async close() { await client.close(); await server.close(); },
  };
}
