import { describe, it, expect } from 'vitest';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { renderPng } from '../src/server/render';
import { flatLayout } from '../src/core/render/draw';
import { createVariant } from '../src/core/variants';
import { smallDesign, paint, palette, ctxAll } from './fixtures';

async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { size: [img.width, img.height], rgba: [...ctx.getImageData(x, y, 1, 1).data] };
}

describe('renderPng', () => {
  it('renders a flat view with a red bead where expected', async () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    const png = await renderPng(d, palette, { view: 'flat' });
    const L = flatLayout(d, { cell: 14, rulers: true });
    // 標題列高 24px；豆子中心偏左上一點點（避開中孔）
    const { rgba } = await pixel(png, L.pad + 4, 24 + L.pad + 4);
    expect(rgba[0]).toBeGreaterThan(rgba[1] + 60);
  });
  it('renders all variants side by side', async () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1']]);
    const { design } = createVariant(d0, { name: '第二版', paletteMode: 'all' }, ctxAll);
    const one = await pixel(await renderPng(design, palette, { view: 'flat' }), 0, 0);
    const all = await pixel(await renderPng(design, palette, { view: 'flat', variant: 'all' }), 0, 0);
    expect(all.size[0]).toBeGreaterThan(one.size[0] * 2 - 1);
  });
  it('renders pattern, 3d and ironed views without throwing', async () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'H1']]);
    for (const view of ['pattern', '3d', 'ironed'] as const) {
      const png = await renderPng(d, palette, { view });
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
  });
});
