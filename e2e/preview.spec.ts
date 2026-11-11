import { test, expect, type Page } from '@playwright/test';
import { pixel, tool } from './fixtures';

const previewOf = (page: Page) => page.getByRole('region', { name: '實體預覽' });
/** 整張預覽畫布的內容（比較前後是否有變） */
const canvasData = (page: Page, testId = 'preview-canvas') =>
  page.getByTestId(testId).evaluate((el) => (el as HTMLCanvasElement).toDataURL());

async function openDesign(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
}

test('shows the physical size, and toggling 燙後 / 釘板 / tilt redraws the canvas', async ({ page }) => {
  await openDesign(page, '預覽測試');
  const panel = previewOf(page);
  await expect(panel.getByText('面板實際大小約 5.2 × 5.2 cm')).toBeVisible();
  const empty = await canvasData(page);
  // 一塊 6×4 顆的 2.6mm 豆：15.6 × 10.4 mm
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 4, y: 5, rows: ['aaaaaa', 'abbbba', 'abbbba', 'aaaaaa'], legend: { a: 'A1', b: 'H2' } }] });
  await expect(panel.getByText('1:1 實際大小約 1.6 × 1 cm')).toBeVisible();

  await expect.poll(() => canvasData(page)).not.toEqual(empty); // 已畫出新放的豆子
  const plain = await canvasData(page);

  await panel.getByLabel('燙後').check();
  await expect.poll(() => canvasData(page)).not.toEqual(plain);
  await panel.getByLabel('燙後').uncheck();
  await expect.poll(() => canvasData(page)).toEqual(plain);

  await expect(panel.getByLabel('釘板')).toBeChecked();
  await panel.getByLabel('釘板').uncheck();
  await expect.poll(() => canvasData(page)).not.toEqual(plain);
  await panel.getByLabel('釘板').check();
  await expect.poll(() => canvasData(page)).toEqual(plain);

  const tilt = panel.getByRole('slider', { name: '傾斜' });
  await expect(tilt).toHaveValue('40');
  await tilt.fill('10');
  await expect(panel.getByText('10°')).toBeVisible();
  await expect.poll(() => canvasData(page)).not.toEqual(plain);
});

test('dragging rotates; 放大 opens a fullscreen dialog and Esc closes only the dialog', async ({ page }) => {
  await openDesign(page, '放大測試');
  // 留邊內放一顆豆，讓檢查器有一個可以點的問題
  await tool(page, 'apply_ops', { ops: [
    { op: 'paste', x: 0, y: 0, rows: ['a'], legend: { a: 'A1' } },
    { op: 'paste', x: 6, y: 6, rows: ['aaa', 'aaa'], legend: { a: 'H2' } },
  ] });
  const empty = await pixel(page, 10, 10);
  await expect.poll(() => pixel(page, 6, 6)).not.toEqual(empty);

  const canvas = page.getByTestId('preview-canvas');
  await canvas.scrollIntoViewIfNeeded(); // 右側面板可捲動，預覽在最下面
  const before = await canvasData(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => canvasData(page)).not.toEqual(before);

  // 先在檢查器標出一個問題：放大後按 Esc 只關對話框，標示不能跟著被取消
  const margin = page.getByRole('region', { name: '檢查器' }).getByRole('button', { name: /超出留邊/ });
  await margin.click();
  await expect(margin).toHaveAttribute('aria-pressed', 'true');

  const expand = previewOf(page).getByRole('button', { name: '放大' });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: '實體預覽' });
  await expect(dialog).toBeVisible();
  const focusInDialog = () => dialog.evaluate((d) => d.contains(document.activeElement));
  await expect.poll(focusInDialog).toBe(true);
  const large = dialog.getByTestId('preview-canvas-large');
  await expect.poll(async () => (await large.boundingBox())?.width ?? 0).toBeGreaterThan(400);
  await expect.poll(() => canvasData(page, 'preview-canvas-large')).not.toMatch(/^data:,$/);
  await page.keyboard.press('e'); // 對話框裡的按鍵不會切換工具（背景在 modal 時不在無障礙樹裡，用 class 找）
  await expect(page.locator('.tool-btn[aria-label="畫筆"]')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused(); // 焦點回到「放大」
  await expect(margin).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); // 對話框關了之後，Esc 照常取消標示
  await expect(margin).toHaveAttribute('aria-pressed', 'false');
});

test('closing the enlarged preview with 關閉預覽 returns focus to 放大', async ({ page }) => {
  await openDesign(page, '關閉焦點測試');
  const expand = previewOf(page).getByRole('button', { name: '放大' });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: '實體預覽' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await dialog.click({ position: { x: 4, y: 4 } }); // 先點對話框空白處，讓焦點不在任何按鈕上
  await dialog.getByRole('button', { name: '關閉預覽' }).click();
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
});
