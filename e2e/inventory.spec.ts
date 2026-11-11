import { test, expect, type Page } from '@playwright/test';
import { current, pixel, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

const inv = async (page: Page, code: string) => (await (await page.request.get('/api/state')).json()).inventory[code];
const calibrated = async (page: Page, code: string) =>
  ((await (await page.request.get('/api/state')).json()).palette as { code: string; calibratedHex?: string }[])
    .find((p) => p.code === code)?.calibratedHex ?? null;
const slot = (page: Page, code: string) => page.locator(`li.inv-slot[data-code="${code}"]`);

test.afterAll(async ({ request }) => {
  // 不影響其他 spec：收回這裡登記的庫存與校色
  await request.post('/api/tools/set_inventory', { data: { items: ['A1', 'A2', 'A3'].map((code) => ({ code, owned: false, count: 0 })) } });
  await request.post('/api/tools/calibrate_color', { data: { code: 'A1', hex: null } });
});

test('owned and count edits are saved, survive a reload, and show in the editor tray', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '庫存測試', widthMm: 26, heightMm: 26, bead: 2.6, margin: 0 });
  await expect(page.getByTestId('design-name')).toHaveText('庫存測試');

  await page.getByRole('link', { name: '管理庫存' }).click();
  await expect(page).toHaveURL(/#\/inventory$/);
  await expect(page.getByRole('heading', { name: '庫存與校色', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'A 系列' })).toBeVisible();

  const a1 = slot(page, 'A1');
  await a1.getByRole('checkbox', { name: 'A1 我有' }).check();
  await a1.getByRole('textbox', { name: 'A1 顆數' }).fill('120');
  await expect.poll(() => inv(page, 'A1')).toEqual({ owned: true, count: 120 });
  await expect(page.locator('.inv-foot')).toContainText('擁有 1 色，共 120 顆');

  await page.reload();
  await expect(slot(page, 'A1').getByRole('checkbox', { name: 'A1 我有' })).toBeChecked();
  await expect(slot(page, 'A1').getByRole('textbox', { name: 'A1 顆數' })).toHaveValue('120');

  // 還在延遲中的修改：馬上回編輯頁也會送出
  await slot(page, 'A3').getByRole('textbox', { name: 'A3 顆數' }).fill('40');
  await page.getByRole('link', { name: '返回編輯' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(() => inv(page, 'A3')).toEqual({ owned: true, count: 40 }); // 填了顆數就算擁有
  const tray = page.getByRole('listbox', { name: '色票豆盒' });
  await expect(tray.locator('[data-code="A1"] .tray-count')).toHaveText('120');
  await expect(tray.locator('[data-code="A3"] .tray-count')).toHaveText('40');
});

test('calibrating a color changes how its beads look in the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 0, rows: ['aaa'], legend: { a: 'A1' } }] });
  await expect.poll(async () => (await current(page)).total).toBe(3);
  const empty = await pixel(page, 5, 5);
  await expect.poll(() => pixel(page, 0, 0)).not.toEqual(empty);
  const before = await pixel(page, 0, 0);

  await page.goto('/#/inventory');
  const a1 = slot(page, 'A1');
  await a1.getByRole('textbox', { name: 'A1 顆數' }).waitFor();
  await a1.locator('input[type="color"]').fill('#00ff00');
  await expect.poll(() => calibrated(page, 'A1')).toBe('#00FF00');
  await expect(a1.getByRole('button', { name: '清除 A1 的校正' })).toBeVisible();

  await page.getByRole('link', { name: '返回編輯' }).click();
  await expect.poll(() => pixel(page, 0, 0)).not.toEqual(before);
  const [r, g, b] = await pixel(page, 0, 0);
  expect(g).toBeGreaterThan(r + 60);
  expect(g).toBeGreaterThan(b + 60);
});

test('weighing converts grams to a bead count with the unit weight', async ({ page }) => {
  await page.goto('/#/inventory');
  await expect(page.getByRole('textbox', { name: '一般豆' })).toHaveValue('0.06');
  const a2 = slot(page, 'A2');
  await a2.getByRole('button', { name: 'A2 秤重換算' }).click();
  const pop = page.getByRole('dialog', { name: 'A2 秤重換算' });
  await expect(pop).toBeVisible();
  await pop.getByRole('textbox').fill('-1');
  await expect(pop).toContainText('請輸入 0 以上的數字');
  await expect(pop.getByRole('button', { name: '填入顆數' })).toBeDisabled();
  await pop.getByRole('textbox').fill('6');
  await expect(pop).toContainText('約 100 顆（單顆 0.06 g）');
  await pop.getByRole('button', { name: '填入 100 顆' }).click();
  await expect(pop).toBeHidden();
  await expect(a2.getByRole('textbox', { name: 'A2 顆數' })).toHaveValue('100');
  await expect(a2.getByRole('button', { name: 'A2 秤重換算' })).toBeFocused();
  await expect.poll(() => inv(page, 'A2')).toEqual({ owned: true, count: 100 });

  // 單顆重量存在瀏覽器裡；0 不能當單顆重量
  const unit = page.getByRole('textbox', { name: '一般豆' });
  await unit.fill('0');
  await expect(page.locator('.inv-units')).toContainText('單顆重量要是大於 0 的數字');
  await unit.fill('0.05');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '一般豆' })).toHaveValue('0.05');
  await page.evaluate(() => localStorage.removeItem('bead-studio.unit-weights'));
});

test('「做完了，扣庫存」lists the deductions and subtracts the design usage after confirming', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 1, rows: ['bb'], legend: { b: 'H7' } }] }); // H7 沒有登記擁有
  await expect.poll(async () => (await current(page)).total).toBe(5);

  await page.getByRole('button', { name: '做完了，扣庫存' }).click();
  const dlg = page.getByRole('dialog', { name: '做完了，扣庫存' });
  await expect(dlg).toBeVisible();
  const row = dlg.getByRole('listitem').filter({ hasText: 'A1' });
  await expect(row).toContainText('扣 3');
  await expect(row).toContainText('120 → 117');
  await expect(dlg).toContainText('未擁有的色號不受影響：H7');
  await expect(dlg).toContainText('可以到庫存頁調整');

  await dlg.getByRole('button', { name: '扣除庫存' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => inv(page, 'A1')).toEqual({ owned: true, count: 117 });
  expect(await inv(page, 'H7')).toBeUndefined();
  await expect(page.getByRole('status').filter({ hasText: 'A1 扣 3 顆（120 → 117）' })).toBeVisible();
  await expect(page.getByRole('listbox', { name: '色票豆盒' }).locator('[data-code="A1"] .tray-count')).toHaveText('117');
});
