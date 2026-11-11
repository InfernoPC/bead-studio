import { test, expect } from '@playwright/test';
import { pixel, tool } from './fixtures';

test('checks panel lists issues, dims the canvas on click, and Esc clears it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '檢查器測試', widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('檢查器測試');

  const panel = page.getByRole('region', { name: '檢查器' });
  await expect(panel.getByText('沒有發現問題')).toBeVisible();

  // 在留邊內畫一顆豆（也是孤立浮豆）
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 0, rows: ['a'], legend: { a: 'A1' } }] });
  const margin = panel.getByRole('button', { name: /超出留邊/ });
  await expect(margin).toBeVisible();
  await expect(panel.getByText(/\d+ 個問題/)).toBeVisible();

  // 一顆豆在留邊內 → 點問題後，其他格子暗化；這顆豆保持原色
  const lit = await pixel(page, 0, 0);
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 5, y: 5, rows: ['a'], legend: { a: 'A1' } }] });
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);
  await margin.click();
  await expect(margin).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/checks-${theme}.png` });
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });

  await margin.click(); // 再點取消
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);

  await margin.click();
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  await page.keyboard.press('Escape'); // Esc 取消
  await expect(margin).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);
});
