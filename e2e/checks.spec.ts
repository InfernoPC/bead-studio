import { test, expect, type Page } from '@playwright/test';
import { pixel, tool } from './fixtures';

const panelOf = (page: Page) => page.getByRole('region', { name: '檢查器' });

async function openMarginDesign(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
  // 一顆豆在留邊內（同時是孤立浮豆），另一顆在板面中間，用來看暗化
  await tool(page, 'apply_ops', { ops: [
    { op: 'paste', x: 0, y: 0, rows: ['a'], legend: { a: 'A1' } },
    { op: 'paste', x: 5, y: 5, rows: ['a'], legend: { a: 'A1' } },
  ] });
  await expect(panelOf(page).getByRole('button', { name: /超出留邊/ })).toBeVisible();
  const empty = await pixel(page, 7, 7);
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(empty); // 畫面已畫出豆子
}

test('checks panel lists issues, dims the canvas on click, and Esc clears it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '檢查器測試', widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('檢查器測試');
  const panel = panelOf(page);
  await expect(panel.getByText('沒有發現問題')).toBeVisible();
  await expect(panel.getByText('點一列可在畫布上標出位置')).toHaveCount(0);

  await openMarginDesign(page, '檢查器測試二');
  const margin = panel.getByRole('button', { name: /超出留邊/ });
  await expect(panel.getByText(/\d+ 個問題/)).toBeVisible();
  await expect(panel.getByText('點一列可在畫布上標出位置')).toBeVisible();

  const lit = await pixel(page, 5, 5);
  await margin.click();
  await expect(margin).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  await margin.click(); // 再點取消
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);
  await margin.click();
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  await page.keyboard.press('Escape'); // Esc 取消
  await expect(margin).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);
});

test('the selection survives a changing count, and only the issue count is a live region', async ({ page }) => {
  await openMarginDesign(page, '選取測試');
  const margin = panelOf(page).getByRole('button', { name: /超出留邊/ });
  await margin.click();
  await expect(margin).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 19, y: 19, rows: ['a'], legend: { a: 'A1' } }] }); // 留邊內又多一顆：訊息從「1 顆」變「2 顆」
  await expect(margin).toContainText('2 顆');
  await expect(margin).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.panel-meta[aria-live="polite"]')).toHaveCount(1);
  await expect(page.locator('.panel-meta[aria-live="polite"]')).toContainText('個問題');
});

test('switching design or variant clears the highlight', async ({ page }) => {
  await openMarginDesign(page, '清除標示測試');
  const panel = panelOf(page);
  const margin = panel.getByRole('button', { name: /超出留邊/ });
  const lit = await pixel(page, 5, 5);

  await margin.click();
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  const made = await tool(page, 'create_variant', { name: '另一版', paletteMode: 'all' });
  const vid = /版本 (\S+)「/.exec(made.text)![1];
  await tool(page, 'select_variant', { variant: vid });
  await expect(margin).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit);

  await margin.click();
  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(lit);
  await tool(page, 'new_design', { name: '換作品', widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('換作品');
  await expect(panel.getByText('沒有發現問題')).toBeVisible();
  await expect(page.locator('.stage canvas').first()).toBeVisible();
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 5, y: 5, rows: ['a'], legend: { a: 'A1' } }] });
  await expect.poll(() => pixel(page, 5, 5)).toEqual(lit); // 新作品上不會殘留暗化
});

test('low-contrast pairs and hole coordinates read plainly', async ({ page }) => {
  await openMarginDesign(page, '白話測試');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 8, y: 8, rows: ['ab'], legend: { a: 'A1', b: 'A2' } }] });
  const row = panelOf(page).getByRole('button', { name: /A1 和 A2 的顏色太接近/ });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('title', /ΔE=/);
  await expect(row.locator('.checks-dot')).toHaveCount(2);
});

// 截圖留存（亮／暗各一張），不屬於行為檢查
test('screenshots of the highlight in light and dark', async ({ page }) => {
  await openMarginDesign(page, '截圖');
  await panelOf(page).getByRole('button', { name: /超出留邊/ }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400); // canvas 在主題切換後重畫
    await page.screenshot({ path: `test-results/checks-${theme}.png` });
  }
});
