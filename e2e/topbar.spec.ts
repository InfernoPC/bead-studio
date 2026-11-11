import { test, expect, type Page } from '@playwright/test';
import { current, tool } from './fixtures';

// 同一個檔案共用伺服器，依序執行
test.describe.configure({ mode: 'serial' });

async function openDesign(page: Page, name: string, mm = 80) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: mm, heightMm: mm, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
}

async function state(page: Page) {
  return (await (await page.request.get('/api/state')).json()).current;
}

test('建立新作品 dialog creates an 80mm / 2.6mm design with 30 × 30 cells', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  const menuBtn = page.getByRole('button', { name: /^作品：/ });
  await menuBtn.click();
  await page.getByRole('menuitem', { name: '建立新作品' }).click();
  const dlg = page.getByRole('dialog', { name: '建立新作品' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('名稱').fill('小熊杯墊');
  await dlg.getByLabel('寬（mm）').fill('80');
  await dlg.getByLabel('高（mm）').fill('80');
  await dlg.getByRole('button', { name: '2.6 mm' }).click();
  await expect(dlg.getByText('= 30 × 30 格')).toBeVisible();
  await dlg.getByRole('button', { name: '5 mm' }).click();
  await expect(dlg.getByText('= 16 × 16 格')).toBeVisible();
  await dlg.getByRole('button', { name: '2.6 mm' }).click();
  await dlg.getByRole('button', { name: '建立作品' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('design-name')).toHaveText('小熊杯墊');
  await expect(page.getByText('30 × 30 格 · 8 × 8 cm · 2.6mm 豆')).toBeVisible();
  await expect(menuBtn).toBeFocused(); // 關閉後焦點回到作品選單

  // 作品選單列出作品，目前作品打勾；點另一個作品就開啟它
  await tool(page, 'new_design', { name: '第二個', widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('第二個');
  await menuBtn.click();
  const checked = page.getByRole('menuitemradio', { name: '第二個' });
  await expect(checked).toHaveAttribute('aria-checked', 'true');
  await expect(checked).toBeFocused(); // 鍵盤可用：開啟時焦點在目前作品，Esc 關閉並回到按鈕
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '建立新作品' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '作品' })).toBeHidden();
  await expect(menuBtn).toBeFocused();
  await menuBtn.click();
  await page.getByRole('menuitemradio', { name: '小熊杯墊' }).click();
  await expect(page.getByTestId('design-name')).toHaveText('小熊杯墊');
});

test('shrinking the board asks to confirm the crop; cancel keeps it, confirm applies', async ({ page }) => {
  await openDesign(page, '裁切測試');
  await tool(page, 'apply_ops', { ops: [
    { op: 'paste', x: 2, y: 14, rows: ['aa'], legend: { a: 'A1' } },
    { op: 'paste', x: 26, y: 14, rows: ['aa'], legend: { a: 'A1' } },
  ] });
  await expect.poll(async () => (await current(page)).total).toBe(4);

  const sizeBtn = page.getByRole('button', { name: /30 × 30 格/ });
  await sizeBtn.click();
  const dlg = page.getByRole('dialog', { name: '面板設定' });
  await dlg.getByLabel('寬（mm）').fill('40');
  await expect(dlg.getByText('= 15 × 30 格')).toBeVisible();
  await dlg.getByRole('button', { name: '套用設定' }).click();
  await expect(dlg.getByText('新尺寸會裁掉 4 顆豆子，仍要套用嗎？')).toBeVisible();
  await dlg.getByRole('button', { name: '返回修改' }).click();
  await dlg.getByRole('button', { name: '取消' }).click();
  await expect(dlg).toBeHidden();
  await expect(sizeBtn).toBeFocused();
  expect((await state(page)).cols).toBe(30);

  await sizeBtn.click();
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('寬（mm）').fill('40');
  await expect(dlg.getByText('= 15 × 30 格')).toBeVisible();
  await dlg.getByRole('button', { name: '套用設定' }).click();
  await dlg.getByRole('button', { name: '裁切並套用' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('15 × 30 格 · 4 × 8 cm · 2.6mm 豆')).toBeVisible();
  expect((await current(page)).total).toBe(0);
});

test('a shape-locked board change shows the reason and 解鎖形狀', async ({ page }) => {
  await openDesign(page, '鎖定測試');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 26, y: 14, rows: ['aa'], legend: { a: 'A1' } }] });
  const lock = page.getByRole('group', { name: '形狀' });
  await lock.getByRole('button', { name: '只換色' }).click();
  await expect(lock.getByRole('button', { name: '只換色' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).shapeLocked).toBe(true);

  await page.getByRole('button', { name: /30 × 30 格/ }).click();
  const dlg = page.getByRole('dialog', { name: '面板設定' });
  await dlg.getByLabel('寬（mm）').fill('40');
  await dlg.getByRole('button', { name: '套用設定' }).click();
  await expect(dlg.getByText(/形狀已鎖定/)).toBeVisible();
  await dlg.getByRole('button', { name: '解鎖形狀' }).click();
  await expect(lock.getByRole('button', { name: '可增減' })).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('button', { name: '套用設定' }).click();
  await expect(dlg.getByText('新尺寸會裁掉 2 顆豆子，仍要套用嗎？')).toBeVisible();
});

test('adding an 有的色 variant shows a second tab; tabs switch and change color range', async ({ page }) => {
  await openDesign(page, '版本測試');
  const tabs = page.getByRole('tablist', { name: '配色版本' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '新增配色版本' }).click();
  const form = page.getByRole('dialog', { name: '新增配色版本' });
  await form.getByRole('button', { name: '有的色' }).click();
  await form.getByLabel('名稱').fill('我有的');
  await form.getByRole('button', { name: '建立版本' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', { name: /我有的/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /我有的/ })).toContainText('有的色');

  await tabs.getByRole('tab', { name: /理想版/ }).click();
  await expect(tabs.getByRole('tab', { name: /理想版/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await state(page)).activeVariant).toBe('v1');

  // 右鍵改色彩範圍
  await tabs.getByRole('tab', { name: /我有的/ }).click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: '庫存' }).click();
  await expect(tabs.getByRole('tab', { name: /我有的/ })).toContainText('庫存');
  const v2 = (await state(page)).variants.find((v: { id: string }) => v.id === 'v2');
  expect(v2.paletteMode).toBe('stock');
});

test('export links point at the server PNG with the chosen view and variant', async ({ page }) => {
  await openDesign(page, '匯出測試');
  await page.getByRole('button', { name: '匯出', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '匯出圖片' });
  await menu.getByRole('button', { name: '全部版本' }).click();
  await menu.getByRole('button', { name: '施工圖' }).click();
  const link = menu.getByRole('link', { name: '下載圖片' });
  const href = (await link.getAttribute('href'))!;
  expect(href).toContain('view=pattern&variant=all');
  expect(href).toContain('scale=2');
  await expect(link).toHaveAttribute('download', '匯出測試-全部版本-施工圖.png');
  const res = await page.request.get(href);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('image/png');

  await menu.getByRole('button', { name: '目前版本' }).click();
  await menu.getByRole('button', { name: '3D 預覽' }).click();
  await expect(link).toHaveAttribute('download', '匯出測試-理想版-3D預覽.png');
  expect(await link.getAttribute('href')).toContain('view=3d&variant=v1');
});

test('snapshots save and restore; undo / redo buttons; errors show in a closable alert', async ({ page }) => {
  await openDesign(page, '快照測試');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 4, y: 4, rows: ['aaa'], legend: { a: 'A1' } }] });
  await expect.poll(async () => (await current(page)).total).toBe(3);

  await page.getByRole('button', { name: '快照', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '快照' });
  await expect(menu.getByLabel('快照名稱')).toHaveValue(/^快照 \d{2}:\d{2}$/);
  await menu.getByLabel('快照名稱').fill('三顆');
  await menu.getByRole('button', { name: '儲存快照' }).click();
  await expect(menu.getByRole('button', { name: /三顆/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await tool(page, 'apply_ops', { ops: [{ op: 'clear', region: { x: 0, y: 0, w: 30, h: 30 } }] });
  await expect.poll(async () => (await current(page)).total).toBe(0);

  await page.getByRole('button', { name: '快照', exact: true }).click();
  await menu.getByRole('button', { name: /三顆/ }).click();
  const confirm = page.getByRole('dialog', { name: '還原快照' });
  await expect(confirm.getByText('還原到「三顆」？')).toBeVisible();
  await confirm.getByRole('button', { name: '還原快照' }).click();
  await expect.poll(async () => (await current(page)).total).toBe(3);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(async () => (await current(page)).total).toBe(0);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(async () => (await current(page)).total).toBe(3);

  await page.getByRole('button', { name: '重做' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('沒有可以重做的步驟');
  await alert.getByRole('button', { name: '關閉提示' }).click();
  await expect(alert).toBeHidden();
});
