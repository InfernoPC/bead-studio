import { expect, type Page } from '@playwright/test';

/** 和 UI／MCP 一樣走 POST /api/tools/:name；失敗時讓測試直接失敗 */
export async function tool(page: Page, name: string, args: Record<string, unknown> = {}) {
  const res = await page.request.post(`/api/tools/${name}`, { data: args });
  expect(res.ok(), `${name} HTTP ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; text: string };
  expect(body.ok, `${name}: ${body.text}`).toBeTruthy();
  return body;
}
