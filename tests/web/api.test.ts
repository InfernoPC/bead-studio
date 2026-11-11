import { describe, it, expect, vi, afterEach } from 'vitest';
import { callTool, uploadImport } from '../../src/web/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('api error mapping', () => {
  it('maps a 413 response to a readable failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 413, error: 'Payload Too Large' }), { status: 413 })));
    const up = await uploadImport(new Blob(['x']));
    expect(up.ok).toBe(false);
    expect(up.text).toContain('20MB');
    const tool = await callTool('x', {});
    expect(tool).toMatchObject({ ok: false, images: [] });
    expect(tool.text).toMatch(/[一-鿿]/);
  });
  it('maps a non-JSON error body without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    const r = await callTool('x', {});
    expect(r.ok).toBe(false);
    expect(r.text).toContain('500');
  });
  it('maps a network failure to ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await callTool('x', {})).toMatchObject({ ok: false });
    expect(await uploadImport(new Blob(['x']))).toMatchObject({ ok: false });
  });
});
