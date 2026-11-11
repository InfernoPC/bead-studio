import { test, expect, type Page } from '@playwright/test';
import { cellCenter, current, pickColorWithEyedropper, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

/** 一次畫 40 格（5 列 × 8 欄）的 AI 式更新 */
const BLOCK = { op: 'paste', x: 4, y: 6, rows: Array(5).fill('aaaaaaaa'), legend: { a: 'A5' } };

/**
 * 在頁面裡送出 apply_ops，等畫面第一次改變（WebSocket 收到新版本）後，
 * 在之後 100、600、1500、2500ms 各擷取一次 canvas
 */
async function captureWave(page: Page): Promise<string[]> {
  return page.evaluate(async (op) => {
    const c = document.querySelector('[data-testid="editor-canvas"]') as HTMLCanvasElement;
    const shot = () => c.toDataURL();
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const before = shot();
    const res = await fetch('/api/tools/apply_ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [op] }) });
    if (!res.ok) throw new Error(`apply_ops ${res.status}`);
    const deadline = performance.now() + 5000;
    while (shot() === before) { if (performance.now() > deadline) throw new Error('canvas never changed'); await frame(); }
    const t0 = performance.now();
    const out: string[] = [];
    for (const at of [100, 600, 1500, 2500]) {
      while (performance.now() - t0 < at) await frame();
      out.push(shot());
    }
    return out;
  }, BLOCK);
}

async function freshDesign(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name, widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText(name);
}

test('an AI update bounces the changed beads as a wave, then settles on the final board', async ({ page }) => {
  await freshDesign(page, '波浪測試');
  const [at100, at600, at1500, at2500] = await captureWave(page);
  expect(at100).not.toEqual(at600); // 100ms 時波浪還在傳
  expect(at1500).toEqual(at2500);   // 1500ms 時已經停在最終畫面
});

test('with reduced motion the final board shows right away', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshDesign(page, '不要動畫');
  const [at100, , at1500] = await captureWave(page);
  expect(at100).toEqual(at1500);
});

test('painted beads bounce under the mouse, and the server echo does not bounce them again', async ({ page }) => {
  await freshDesign(page, '筆畫跳動');
  await pickColorWithEyedropper(page, 'C7');
  await page.keyboard.press('b');
  const shot = () => page.getByTestId('editor-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const a = await cellCenter(page, 5, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // 剛畫下去的豆子在跳：馬上跟稍後的畫面不同
  const pair = await page.getByTestId('editor-canvas').evaluate(async (c) => {
    const el = c as HTMLCanvasElement;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    await frame(); await frame();
    const first = el.toDataURL();
    const t0 = performance.now();
    while (performance.now() - t0 < 500) await frame();
    return [first, el.toDataURL()];
  });
  expect(pair[0]).not.toEqual(pair[1]);
  for (let i = 6; i <= 10; i++) { const p = await cellCenter(page, i, 10); await page.mouse.move(p.x, p.y); }
  await page.waitForTimeout(500); // 最後一顆跳完
  const settled = await shot();
  const before = (await current(page)).version;
  await page.mouse.up();
  await expect.poll(async () => (await current(page)).version).toBe(before + 1);
  // 回聲進來之後畫面不再動
  for (let k = 0; k < 6; k++) { expect(await shot()).toEqual(settled); await page.waitForTimeout(60); }
});
