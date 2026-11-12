import { test, expect, type Page } from '@playwright/test';
import { current, tool } from './fixtures';

// 同一個檔案共用伺服器，依序執行；只有這個檔案需要剪貼簿權限
test.describe.configure({ mode: 'serial' });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openDesign(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: 52, heightMm: 52, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
}

async function state(page: Page) {
  return (await page.request.get('/api/state')).json();
}

type DragFile = { name: string; type: string; base64: string } | { text: string };

/** 在編輯區上派送拖曳事件（帶檔案或只帶文字），和從桌面拖檔進來一樣經過 window 的監聽器 */
async function drag(page: Page, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', payload: DragFile) {
  return page.evaluate(([type, p]) => {
    const dt = new DataTransfer();
    if ('text' in p) dt.setData('text/plain', p.text);
    else {
      const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], p.name, { type: p.type }));
    }
    const target = document.querySelector('[data-testid="editor-canvas"]') ?? document.body;
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [type, payload] as const);
}

/** 在瀏覽器裡畫一張 JPEG：中間一塊紅色方塊、四周白底 */
async function jpeg(page: Page): Promise<DragFile> {
  const base64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 60;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 60, 60);
    ctx.fillStyle = '#d02020'; ctx.fillRect(15, 15, 30, 30);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  return { name: '紅方塊.jpg', type: 'image/jpeg', base64 };
}

test('連接 AI shows the MCP command and copies it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  const btn = page.getByRole('button', { name: '連接 AI' });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const pop = page.getByRole('dialog', { name: '連接 AI' });
  await expect(pop.getByRole('heading', { name: '讓 Claude Code 幫你設計' })).toBeVisible();
  const command = 'claude mcp add --transport http beads http://localhost:5175/mcp';
  await expect(pop.getByText(command)).toBeVisible();
  await expect(pop.getByText('伺服器連線中')).toBeVisible();
  await expect(pop.getByText(/~\/BeadStudio/)).toBeVisible();

  await pop.getByRole('button', { name: '複製指令' }).click();
  await expect(pop.getByRole('button', { name: '已複製' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await expect(pop.getByRole('button', { name: '複製指令' })).toBeVisible({ timeout: 4000 }); // 2 秒後恢復

  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(btn).toBeFocused();
});

test('without clipboard access the command is selected instead', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '連接 AI' }).click();
  const pop = page.getByRole('dialog', { name: '連接 AI' });
  await pop.getByRole('button', { name: '複製指令' }).click();
  await expect(pop.getByText(/指令已經選取好/)).toBeVisible();
  expect(await page.evaluate(() => String(window.getSelection()))).toContain('/mcp');
});

test('the drop overlay only reacts to file drags', async ({ page }) => {
  await openDesign(page, '拖曳測試');
  const overlay = page.getByText('放開以導入圖片');
  expect(await drag(page, 'dragenter', { text: 'hello' })).toBe(false);
  await expect(overlay).toBeHidden();
  const file = await jpeg(page);
  await drag(page, 'dragenter', file);
  await expect(overlay).toBeVisible();
  expect(await drag(page, 'dragover', file)).toBe(true); // 不讓瀏覽器自己開檔案
  await drag(page, 'dragleave', file);
  await expect(overlay).toBeHidden();
});

test('a stuck drop overlay can be dismissed', async ({ page }) => {
  await openDesign(page, '拖曳卡住');
  const overlay = page.getByText('放開以導入圖片');
  const file = await jpeg(page);
  // 進了兩層（像是經過子元素）卻只離開一次，計數器以為還在頁面上。
  // 拖出視窗：dragleave 的 relatedTarget 是 null，之後沒有拖曳事件
  await drag(page, 'dragenter', file);
  await drag(page, 'dragenter', file);
  await drag(page, 'dragleave', file);
  await expect(overlay).toBeHidden();

  // 之後還有 dragover 就表示仍在頁面上（Safari 在子元素之間移動時 relatedTarget 也是 null）
  await drag(page, 'dragenter', file);
  await drag(page, 'dragenter', file);
  await drag(page, 'dragleave', file);
  await drag(page, 'dragover', file);
  await page.waitForTimeout(800);
  await expect(overlay).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  await drag(page, 'dragenter', file);
  await expect(overlay).toBeVisible();
  await page.mouse.move(300, 300);
  await page.mouse.move(310, 310);
  await expect(overlay).toBeHidden();
});

test('dropping an exported PNG restores it as a new design', async ({ page }) => {
  await openDesign(page, '貓咪吊飾');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 3, y: 3, rows: ['aaa'], legend: { a: 'A1' } }] });
  await expect.poll(async () => (await current(page)).total).toBe(3);
  const { current: d, designs } = await state(page);
  const png = await (await page.request.get(`/api/designs/${d.id}/export.png`)).body();

  await drag(page, 'drop', { name: '貓咪吊飾.png', type: 'image/png', base64: png.toString('base64') });
  await expect(page.getByRole('status').filter({ hasText: '已從 PNG metadata 還原作品' })).toBeVisible();
  await expect.poll(async () => (await state(page)).designs.length).toBe(designs.length + 1);
  const after = await state(page);
  expect(after.current.id).not.toBe(d.id);
  expect(after.current.name).toBe('貓咪吊飾');
  await page.getByRole('button', { name: /^作品：/ }).click();
  await expect(page.getByRole('menuitemradio', { name: '貓咪吊飾' })).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('other images ask for options first, then convert into the current design', async ({ page }) => {
  await openDesign(page, '轉換測試');
  await drag(page, 'drop', await jpeg(page));
  const card = page.getByRole('dialog', { name: '導入圖片' });
  await expect(card.getByText('轉換到：目前作品')).toBeVisible();
  await card.getByLabel(/去除背景/).check();
  await expect(card.getByLabel(/抖色/)).not.toBeChecked();
  await card.getByRole('button', { name: '開始轉換' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '已轉換圖片到 轉換測試' })).toBeVisible();
  const { total } = await current(page);
  const { cols, rows } = (await state(page)).current;
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(cols * rows); // 去除背景：白底沒有放豆
});

