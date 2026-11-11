import { test, expect, type Page } from '@playwright/test';
import { tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

type Cells = (string | null)[];
async function current(page: Page): Promise<{ version: number; total: number; cells: Cells }> {
  const res = await page.request.get('/api/state');
  const s = await res.json();
  const d = s.current;
  const v = d.variants.find((x: { id: string }) => x.id === d.activeVariant);
  return { version: d.version, total: v.cells.filter(Boolean).length, cells: v.cells };
}

/** 格子 (i, j) 中心在頁面上的座標（依 canvas 上公開的檢視參數換算） */
async function cellCenter(page: Page, i: number, j: number) {
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute('data-view'))!);
  return {
    x: box.x + view.offsetX + view.zoom * (view.pad + (i + 0.5) * view.cell),
    y: box.y + view.offsetY + view.zoom * (view.pad + (j + 0.5) * view.cell),
  };
}

test('one drag paints one stroke as a single version, and ⌘Z undoes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '畫布測試', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('畫布測試');

  // 色票面板還沒做：先放一顆豆，用吸管取色，再把那一步復原
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 0, rows: ['a'], legend: { a: 'A5' } }] });
  await expect.poll(async () => (await current(page)).total).toBe(1);
  await page.keyboard.press('i');
  const seed = await cellCenter(page, 0, 0);
  await page.mouse.click(seed.x, seed.y);
  await tool(page, 'undo', {});
  await expect.poll(async () => (await current(page)).total).toBe(0);

  await page.keyboard.press('b');
  const before = await current(page);
  const a = await cellCenter(page, 5, 10);
  const b = await cellCenter(page, 14, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 }); // 移動很快：中間的格子靠 interpolate 補齊
  await page.mouse.up();

  await expect.poll(async () => (await current(page)).total).toBe(10);
  const after = await current(page);
  expect(after.version).toBe(before.version + 1);
  for (let i = 5; i <= 14; i++) expect(after.cells[10 * 30 + i]).toBe('A5');

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await current(page)).total).toBe(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await current(page)).total).toBe(10);
});

test('wheel zooms around the cursor', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toBeVisible();
  const p = await cellCenter(page, 20, 7);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -200);
  await expect(page.getByLabel('縮放比例')).not.toHaveText('100%');
  const q = await cellCenter(page, 20, 7);
  expect(Math.abs(q.x - p.x)).toBeLessThan(1);
  expect(Math.abs(q.y - p.y)).toBeLessThan(1);
});

test('tool shortcuts work under a Chinese IME (key is "Process")', async ({ page }) => {
  await page.goto('/');
  const fill = page.getByRole('button', { name: '油漆桶' });
  await expect(fill).toBeEnabled();
  const press = (code: string, isComposing: boolean) => page.evaluate(([code, isComposing]) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: code as string, isComposing: isComposing as boolean, bubbles: true }));
  }, [code, isComposing] as const);
  await press('KeyH', true); // 組字中：不切換
  await expect(page.getByRole('button', { name: '掛孔' })).toHaveAttribute('aria-pressed', 'false');
  await press('KeyG', false);
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
});
