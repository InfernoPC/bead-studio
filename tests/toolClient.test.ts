import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { DesignStore } from '../src/server/store';
import { createToolClient } from '../src/server/toolClient';
import { importImageBuffer } from '../src/server/importBuffer';
import { FIX_COLORS } from './fixtures';

let store: DesignStore;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-tc-'));
  mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
});

describe('in-process tool client', () => {
  it('calls the same tools as MCP and reports errors as ok=false', async () => {
    const tc = await createToolClient(store, {});
    const a = await tc.call('new_design', { name: 'x', widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
    expect(a.ok).toBe(true);
    const b = await tc.call('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'NOPE' }] });
    expect(b.ok).toBe(false);
    expect(b.text).toMatch(/unknown_color/);
    const img = await tc.call('render_preview', { view: 'flat' });
    expect(img.images[0].mimeType).toBe('image/png');
    await tc.close();
  });
  it('rejects unknown tool names', async () => {
    const tc = await createToolClient(store, {});
    const r = await tc.call('rm_rf', {});
    expect(r.ok).toBe(false);
    await tc.close();
  });
});

describe('importImageBuffer', () => {
  it('converts a plain PNG into the current design', async () => {
    store.create('x', { widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
    const c = createCanvas(4, 4); const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 4, 4);
    const text = await importImageBuffer(store, await c.encode('png'), {});
    expect(text).toMatch(/轉換/);
    expect(store.get().variants[0].cells.filter((x) => x === 'C1').length).toBe(64);
  });
});
