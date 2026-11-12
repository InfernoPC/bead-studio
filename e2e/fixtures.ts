import { expect, type Page } from '@playwright/test';

/** 和 UI／MCP 一樣走 POST /api/tools/:name；失敗時讓測試直接失敗 */
export async function tool(page: Page, name: string, args: Record<string, unknown> = {}) {
  const res = await page.request.post(`/api/tools/${name}`, { data: args });
  expect(res.ok(), `${name} HTTP ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; text: string };
  expect(body.ok, `${name}: ${body.text}`).toBeTruthy();
  return body;
}

type Cells = (string | null)[];
export async function current(page: Page): Promise<{ version: number; total: number; cells: Cells }> {
  const res = await page.request.get('/api/state');
  const s = await res.json();
  const d = s.current;
  return { version: d.version, total: d.cells.filter(Boolean).length, cells: d.cells };
}

/** 格子 (i, j) 中心在頁面上的座標（依 canvas 上公開的檢視參數換算） */
export async function cellCenter(page: Page, i: number, j: number) {
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute('data-view'))!);
  return {
    x: box.x + view.offsetX + view.zoom * (view.pad + (i + 0.5) * view.cell),
    y: box.y + view.offsetY + view.zoom * (view.pad + (j + 0.5) * view.cell),
  };
}

/** canvas 上格子 (i, j) 中心的像素（裝置像素） */
export async function pixel(page: Page, i: number, j: number): Promise<number[]> {
  const canvas = page.getByTestId('editor-canvas');
  return canvas.evaluate((el, [i, j]) => {
    const c = el as HTMLCanvasElement;
    const v = JSON.parse(c.dataset.view!);
    const k = c.width / c.clientWidth;
    const x = Math.round(k * (v.offsetX + v.zoom * (v.pad + (i + 0.5) * v.cell)));
    const y = Math.round(k * (v.offsetY + v.zoom * (v.pad + (j + 0.5) * v.cell)));
    return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
  }, [i, j] as const);
}

/** 色票面板還沒做：先放一顆豆，用吸管取色，再把那一步復原 */
export async function pickColorWithEyedropper(page: Page, code: string) {
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 0, y: 0, rows: ['a'], legend: { a: code } }] });
  await expect.poll(async () => (await current(page)).cells[0]).toBe(code);
  const before = await pixel(page, 1, 0);
  await expect.poll(() => pixel(page, 0, 0)).not.toEqual(before); // 畫面已經收到這顆豆
  await page.keyboard.press('i');
  const seed = await cellCenter(page, 0, 0);
  await page.mouse.click(seed.x, seed.y);
  await tool(page, 'undo', {});
  await expect.poll(async () => (await current(page)).cells[0]).toBeNull();
}
