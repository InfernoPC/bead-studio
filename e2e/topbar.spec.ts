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

test('a board change that would crop asks first; there are no variant tabs or shape lock', async ({ page }) => {
  await openDesign(page, '裁切測試');
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '形狀' })).toHaveCount(0);
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 26, y: 14, rows: ['aa'], legend: { a: 'A1' } }] });
  await page.getByRole('button', { name: /30 × 30 格/ }).click();
  const dlg = page.getByRole('dialog', { name: '面板設定' });
  await dlg.getByLabel('寬（mm）').fill('40');
  await dlg.getByRole('button', { name: '套用設定' }).click();
  await expect(dlg.getByText('新尺寸會裁掉 2 顆豆子，仍要套用嗎？')).toBeVisible();
});

test('export links point at the server PNG with the chosen view', async ({ page }) => {
  await openDesign(page, '匯出測試');
  await page.getByRole('button', { name: '匯出', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '匯出圖片' });
  await expect(menu.getByRole('group', { name: '版本' })).toHaveCount(0);
  await menu.getByRole('button', { name: '施工圖' }).click();
  const link = menu.getByRole('link', { name: '下載圖片' });
  const href = (await link.getAttribute('href'))!;
  expect(href).toContain('view=pattern');
  expect(href).not.toContain('variant');
  expect(href).toContain('scale=2');
  await expect(link).toHaveAttribute('download', '匯出測試-施工圖.png');
  const res = await page.request.get(href);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('image/png');

  await menu.getByRole('button', { name: '3D 預覽' }).click();
  await expect(link).toHaveAttribute('download', '匯出測試-3D預覽.png');
  expect(await link.getAttribute('href')).toContain('view=3d');
});

test('snapshots save and restore; undo / redo buttons follow the server history', async ({ page }) => {
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

  const undo = page.getByRole('button', { name: '復原' }), redo = page.getByRole('button', { name: '重做' });
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect.poll(async () => (await current(page)).total).toBe(0);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect.poll(async () => (await current(page)).total).toBe(3);
  await expect(redo).toBeDisabled();
  await expect(redo).toBeFocused(); // 停用後焦點仍在按鈕上
  await redo.click({ force: true }); // 沒有步驟：安靜地不做事
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('undo / redo are disabled on a fresh design; ⌘Z there is a silent no-op', async ({ page }) => {
  await openDesign(page, '步驟測試');
  const undo = page.getByRole('button', { name: '復原' }), redo = page.getByRole('button', { name: '重做' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const undone = page.waitForResponse('**/api/tools/undo');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await undone; // 伺服器回 no_history，畫面不顯示任何提示
  await expect(page.getByTestId('status-notice')).toHaveText('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 4, y: 4, rows: ['a'], legend: { a: 'A1' } }] });
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test('a rejected top bar action shows the server text in a closable alert', async ({ page }) => {
  await openDesign(page, '提示測試');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 4, y: 4, rows: ['a'], legend: { a: 'A1' } }] });
  const undo = page.getByRole('button', { name: '復原' });
  await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
  await page.route('**/api/tools/undo', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await undo.click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('伺服器回應錯誤（500）：boom');
  await alert.getByRole('button', { name: '關閉提示' }).click();
  await expect(alert).toBeHidden();
});
