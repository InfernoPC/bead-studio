import { test, expect, type Page } from '@playwright/test';
import { pixel, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

const previewData = (page: Page, testId = 'preview-canvas') =>
  page.getByTestId(testId).evaluate((el) => (el as HTMLCanvasElement).toDataURL());

async function openDesign(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 4, y: 4, rows: ['aaa', 'aaa'], legend: { a: 'A1' } }] });
}

test('the look toggles above the stage switch the editor and the preview together, and are remembered', async ({ page }) => {
  await openDesign(page, '外觀測試');
  const bar = page.getByRole('toolbar', { name: '顯示方式' });
  const before = bar.getByRole('button', { name: '燙前' }), after = bar.getByRole('button', { name: '燙後' });
  const withBoard = bar.getByRole('button', { name: '有釘板' }), noBoard = bar.getByRole('button', { name: '無釘板' });
  await expect(before).toHaveAttribute('aria-pressed', 'true');
  await expect(withBoard).toHaveAttribute('aria-pressed', 'true');
  // 預覽面板不再有自己的燙後／釘板勾選，只留傾斜
  const panel = page.getByRole('region', { name: '實體預覽' });
  await expect(panel.getByLabel('燙後')).toHaveCount(0);
  await expect(panel.getByLabel('釘板')).toHaveCount(0);

  await expect.poll(() => pixel(page, 5, 5)).not.toEqual(await pixel(page, 0, 10)); // 豆子已畫出
  const hole = await pixel(page, 5, 5), peg = await pixel(page, 10, 10);
  const preview = await previewData(page);

  await after.click();
  await expect(after).toHaveAttribute('aria-pressed', 'true');
  await expect(before).toHaveAttribute('aria-pressed', 'false');
  // 燙後沒有中孔：豆子中心變成豆身的顏色（比中孔亮）
  await expect.poll(async () => (await pixel(page, 5, 5))[0]).toBeGreaterThan(hole[0] + 20);
  await expect.poll(() => previewData(page)).not.toEqual(preview);

  await noBoard.click();
  await expect.poll(() => pixel(page, 10, 10)).not.toEqual(peg); // 空格不畫釘子
  await expect(page.locator('.stage')).toHaveClass(/no-board/);

  // 重新整理後保留
  await page.reload();
  await expect(bar.getByRole('button', { name: '燙後' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: '無釘板' })).toHaveAttribute('aria-pressed', 'true');

  // 放大的預覽裡也能切，切了編輯區跟著變
  await page.getByRole('region', { name: '實體預覽' }).getByRole('button', { name: '放大' }).click();
  const dialog = page.getByRole('dialog', { name: '實體預覽' });
  await dialog.getByRole('button', { name: '燙前' }).click();
  await dialog.getByRole('button', { name: '有釘板' }).click();
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: '燙前' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: '有釘板' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pixel(page, 10, 10)).toEqual(peg);
});
