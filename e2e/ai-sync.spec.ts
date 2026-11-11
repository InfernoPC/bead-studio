import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cellCenter, current, pickColorWithEyedropper, tool } from './fixtures';

test('AI edits over MCP show up live in the web page, and web edits are visible to MCP', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '即時同步', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('即時同步');

  const client = new Client({ name: 'e2e-ai', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:5175/mcp')));
  try {
    // AI 畫一個 6×4 的矩形：網頁不重新整理，用量總數 2 秒內更新
    const res = await client.callTool({
      name: 'apply_ops',
      arguments: { ops: [{ op: 'rect', x: 4, y: 4, w: 6, h: 4, color: 'A5', fill: true }] },
    });
    expect(res.isError).toBeFalsy();
    await expect(page.getByText('共 24 顆')).toBeVisible({ timeout: 2000 });

    // 網頁上畫一筆（一條 5 格的線）：MCP get_design 讀得到
    await pickColorWithEyedropper(page, 'A5');
    await page.keyboard.press('b');
    const a = await cellCenter(page, 15, 15);
    const b = await cellCenter(page, 19, 15);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await current(page)).total).toBe(29);

    const got = await client.callTool({ name: 'get_design', arguments: { region: { x: 15, y: 15, w: 5, h: 1 } } });
    const text = (got.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
    expect(text).toContain('A5');
    expect(text).toMatch(/5a|aaaaa/); // 那一列 5 顆同色（RLE 或展開都接受）
  } finally {
    await client.close();
  }
});
