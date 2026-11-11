import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { OpError } from '../src/core/errors';
import { importImageBuffer, MAX_IMAGE_PIXELS } from '../src/server/importBuffer';
import { readImageSize } from '../src/server/imageSize';
import { DesignStore } from '../src/server/store';
import { FIX_COLORS } from './fixtures';

/** 只有檔頭的 PNG：宣告 w×h，沒有任何像素資料（解壓縮炸彈的檔頭長這樣） */
function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 6;
  return b;
}

describe('readImageSize', () => {
  const canvas = createCanvas(37, 21);
  canvas.getContext('2d').fillRect(0, 0, 37, 21);
  it.each(['png', 'jpeg', 'webp'] as const)('reads %s dimensions from the header', async (fmt) => {
    expect(readImageSize(Buffer.from(await canvas.encode(fmt as 'png')))).toEqual({ width: 37, height: 21 });
  });
  it('reads GIF and BMP headers', () => {
    const gif = Buffer.from('GIF89a\x25\x00\x15\x00', 'latin1');
    expect(readImageSize(gif)).toEqual({ width: 37, height: 21 });
    const bmp = Buffer.alloc(26); bmp.write('BM', 0, 'latin1'); bmp.writeInt32LE(37, 18); bmp.writeInt32LE(-21, 22);
    expect(readImageSize(bmp)).toEqual({ width: 37, height: 21 });
  });
  it('returns null for unknown or truncated data', () => {
    expect(readImageSize(Buffer.from('hello world'))).toBeNull();
    expect(readImageSize(pngHeader(10, 10).subarray(0, 18))).toBeNull();
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});

describe('importImageBuffer size limit', () => {
  let store: DesignStore;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'beads-import-'));
    mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
    store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
    store.load();
    store.create('炸彈', { widthMm: 50, heightMm: 50, bead: 5, margin: 1 });
  });

  it('rejects an image whose declared size exceeds the cap before decoding it', async () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    const err = await importImageBuffer(store, pngHeader(side, side), {}).catch((e) => e);
    expect(err).toBeInstanceOf(OpError);
    expect(err.code).toBe('image_too_large');
    expect(err.message).toMatch(/圖片太大/);
  });
  it('rejects data that is not a known image format', async () => {
    const err = await importImageBuffer(store, Buffer.from('not an image'), {}).catch((e) => e);
    expect(err).toBeInstanceOf(OpError);
    expect(err.code).toBe('bad_image');
  });
  it('still imports a normal image', async () => {
    const c = createCanvas(8, 8); const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 8, 8);
    expect(await importImageBuffer(store, Buffer.from(await c.encode('png')), {})).toMatch(/已轉換圖片/);
  });
  it('limits the conversion to the given color codes', async () => {
    const c = createCanvas(8, 8); const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 8, 8);
    const png = Buffer.from(await c.encode('png'));
    await importImageBuffer(store, png, { colors: ['H2'] });
    expect(new Set(store.get().variants[0].cells.filter(Boolean))).toEqual(new Set(['H2']));
    const err = await importImageBuffer(store, png, { colors: ['NOPE'] }).catch((e) => e);
    expect(err.code).toBe('unknown_color');
  });
});
