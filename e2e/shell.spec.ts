import { test, expect } from '@playwright/test';
import { tool } from './fixtures';

// 伺服器在整個 e2e 執行期間共用；依序執行，空狀態必須最先檢查
test.describe.configure({ mode: 'serial' });

test('shows the empty state when there is no design', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('還沒有作品。建立一個新作品，或把圖片拖進來。')).toBeVisible();
  await expect(page.getByRole('button', { name: '建立新作品' })).toBeVisible();
});

test('design name updates live after new_design', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '蘑菇吊飾', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('蘑菇吊飾');
  await expect(page.getByText('30 × 30 格 · 8 × 8 cm · 2.6mm 豆')).toBeVisible();
});

test('keyboard shortcut E selects the eraser', async ({ page }) => {
  await page.goto('/');
  const eraser = page.getByRole('button', { name: '橡皮擦' });
  await expect(eraser).toBeEnabled();
  await expect(eraser).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('e');
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '畫筆' })).toHaveAttribute('aria-pressed', 'false');
});
