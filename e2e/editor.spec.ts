import { test, expect } from '@playwright/test';
import { cellCenter, current, pickColorWithEyedropper, pixel, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('one drag paints one stroke as a single version, and ⌘Z undoes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '畫布測試', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('畫布測試');

  await pickColorWithEyedropper(page, 'A5');

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

test('a server update in the middle of a stroke keeps the stroke preview and both changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '中途更新', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('中途更新');
  await pickColorWithEyedropper(page, 'F5');
  await page.keyboard.press('b');
  const empty = await pixel(page, 15, 15);

  const a = await cellCenter(page, 3, 5), b = await cellCenter(page, 6, 5), c = await cellCenter(page, 9, 5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 });
  await expect.poll(() => pixel(page, 6, 5)).not.toEqual(empty);

  // 拖曳途中 AI 改了別的地方
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 20, y: 20, rows: ['a'], legend: { a: 'H7' } }] });
  await expect.poll(() => pixel(page, 20, 20)).not.toEqual(empty);
  // 不移動時預覽也還在
  expect(await pixel(page, 4, 5)).not.toEqual(empty);

  await page.mouse.move(c.x, c.y, { steps: 2 });
  await expect.poll(() => pixel(page, 9, 5)).not.toEqual(empty);
  expect(await pixel(page, 3, 5)).not.toEqual(empty);
  expect(await pixel(page, 20, 20)).not.toEqual(empty);
  await page.mouse.up();

  await expect.poll(async () => (await current(page)).total).toBe(8);
  const s = await current(page);
  expect(s.cells[20 * 30 + 20]).toBe('H7');
  for (let i = 3; i <= 9; i++) expect(s.cells[5 * 30 + i]).toBe('F5');
});

test('consecutive wheel events compound around the cursor', async ({ page }) => {
  await page.goto('/');
  const zoom = page.getByLabel('縮放比例');
  await expect(zoom).toHaveText('100%');
  const p = await cellCenter(page, 22, 8);
  await page.locator('.editor').evaluate((el, p) => {
    for (let k = 0; k < 2; k++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
    }
  }, p);
  // 每次 e^0.15 倍，兩次 ≈ 135%；兩次都以游標為中心
  await expect(zoom).toHaveText('135%');
  const q = await cellCenter(page, 22, 8);
  expect(Math.abs(q.x - p.x)).toBeLessThan(1);
  expect(Math.abs(q.y - p.y)).toBeLessThan(1);
});

test('Space activates a focused button instead of starting a pan', async ({ page }) => {
  await page.goto('/');
  const mirror = page.getByRole('button', { name: '鏡像檢視' });
  await expect(mirror).toBeEnabled();
  const box = (await page.getByTestId('editor-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); // 游標在編輯區上
  await mirror.focus();
  await page.keyboard.press('Space');
  await expect(mirror).toHaveAttribute('aria-pressed', 'true');
});

test('Space + drag over the stage pans', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByTestId('editor-canvas');
  await expect(page.getByRole('button', { name: '吸管' })).toBeEnabled();
  await page.keyboard.press('i'); // 吸管不會改作品，平移失敗時也不會畫到
  const box = (await canvas.boundingBox())!;
  const before = JSON.parse((await canvas.getAttribute('data-view'))!);
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const after = JSON.parse((await canvas.getAttribute('data-view'))!);
  expect(after.offsetX - before.offsetX).toBeCloseTo(60);
  expect(after.offsetY - before.offsetY).toBeCloseTo(30);
});
