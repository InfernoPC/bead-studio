import { test, expect } from '@playwright/test';
import { current, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

const INV = [
  { code: 'A1', owned: true, count: 300 },
  { code: 'F2', owned: true, count: 30 },
  { code: 'B7', owned: true, count: 0 },
];

test.afterAll(async ({ request }) => {
  // 不影響其他 spec：把這裡登記的庫存收回
  await request.post('/api/tools/set_inventory', { data: { items: INV.map((i) => ({ code: i.code, owned: false, count: 0 })) } });
});

test('the tray filters by stock, finds colors by search, and picks on click', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '豆盒測試', widthMm: 26, heightMm: 26, bead: 2.6, margin: 0 });
  await expect(page.getByTestId('design-name')).toHaveText('豆盒測試');
  await tool(page, 'set_inventory', { items: INV });

  const tray = page.getByRole('listbox', { name: '色票豆盒' });
  const slots = tray.getByRole('option');
  await expect(slots).toHaveCount(222);

  // 沒有的顏色也有色條（色票資料的顏色），只是沒有豆子
  const e14 = tray.locator('[data-code="E14"]');
  const swatch = e14.getByTestId('tray-swatch');
  await expect(swatch).toBeVisible();
  const bg = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
  await expect(e14.locator('canvas')).toHaveCount(0);
  await expect(tray.locator('[data-code="A1"] canvas')).toHaveCount(1); // 有庫存的格子才畫豆子

  await page.getByRole('button', { name: '有庫存' }).click();
  await expect(slots).toHaveCount(2);
  await expect(slots.nth(0)).toHaveAttribute('data-code', 'A1');
  await expect(slots.nth(1)).toHaveAttribute('data-code', 'F2');
  await page.getByRole('button', { name: '我有的' }).click();
  await expect(slots).toHaveCount(3);

  await page.getByRole('button', { name: '全部 MARD' }).click();
  await page.getByRole('searchbox', { name: '搜尋色號或顏色' }).fill('F2');
  const f2 = tray.locator('[data-code="F2"]');
  await expect(f2).toBeVisible();
  await expect(slots.first()).toHaveAttribute('data-code', 'F2');

  await f2.click();
  await expect(f2).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tray-current')).toContainText('F2');
  await expect(page.locator('.tray-current')).toContainText('庫存 30 顆');

  // 搜尋不到的顏色在「有庫存」時，提示改看全部
  await page.getByRole('button', { name: '有庫存' }).click();
  await page.getByRole('searchbox', { name: '搜尋色號或顏色' }).fill('H2');
  await page.getByRole('button', { name: /改看全部 MARD/ }).click();
  await expect(tray.locator('[data-code="H2"]')).toBeVisible();
});

test('arrow keys move between compartments and Enter picks', async ({ page }) => {
  await page.goto('/');
  const tray = page.getByRole('listbox', { name: '色票豆盒' });
  await tray.locator('[data-code="A1"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tray.locator('[data-code="A2"]')).toBeFocused();
  // 鍵盤游標是虛線外框，和選取中的 --peach 框不同
  expect(await tray.locator('[data-code="A2"]').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
  await page.keyboard.press('ArrowDown');
  await expect(tray.locator('[data-code="A8"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tray-current')).toContainText('A8');
  await expect(page.locator('.tray-current')).toContainText('沒有這個顏色');
  await expect(page.getByRole('button', { name: /^A8 / })).toBeVisible(); // 最近用過
});

test('the usage panel counts beads, flags shortages, and toggles a single-color highlight', async ({ page }) => {
  await page.goto('/');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 0, rows: ['aab', 'a..'], legend: { a: 'F2', b: 'A1' } }] });
  await expect.poll(async () => (await current(page)).total).toBe(4);

  await expect(page.locator('#panel-usage')).toHaveText('用量');
  await expect(page.locator('.panel-meta').filter({ hasText: /顆/ })).toHaveText('共 4 顆');
  const rows = page.locator('.usage-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('F2');
  await expect(rows.nth(0)).toContainText('3 / 30');
  await expect(rows.nth(1)).toContainText('1 / 300');
  await expect(page.locator('.usage-short')).toHaveCount(0);

  await tool(page, 'set_inventory', { items: [{ code: 'F2', count: 1 }] });
  await expect(rows.nth(0).locator('.usage-short')).toHaveText('缺 2');

  await rows.nth(1).click();
  await expect(page.locator('.tray-current')).toContainText('A1');

  await rows.nth(0).click({ button: 'right' });
  await expect(page.locator('.usage-hint')).toContainText('正在只看 F2');
  await rows.nth(0).click({ button: 'right' });
  await expect(page.locator('.usage-hint')).not.toContainText('正在只看');
});
