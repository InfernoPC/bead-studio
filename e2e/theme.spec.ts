import { test, expect, type Page } from '@playwright/test';
import { current, pixel, tool } from './fixtures';

test.describe.configure({ mode: 'serial' });

const DARK_PAPER = 'rgb(42, 34, 28)'; // tokens.css 暗色 --paper #2A221C
const LIGHT_PAPER = 'rgb(246, 238, 223)'; // 亮色 --paper #F6EEDF

const themeButton = (page: Page) => page.getByRole('button', { name: /^外觀：/ });
const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the theme button cycles system → light → dark, dark survives a reload, and beads keep their colors', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '畫筆' })).toBeEnabled();
  await tool(page, 'new_design', { name: '主題測試', widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 });
  await expect(page.getByTestId('design-name')).toHaveText('主題測試');
  await tool(page, 'apply_ops', { ops: [{ op: 'paste', x: 6, y: 6, rows: ['a'], legend: { a: 'A5' } }] });
  await expect.poll(async () => (await current(page)).cells[6 * 30 + 6]).toBe('A5');
  const emptyLight = await pixel(page, 10, 10);
  await expect.poll(() => pixel(page, 6, 6)).not.toEqual(emptyLight); // 畫面已收到這顆豆
  const beadLight = await pixel(page, 6, 6);

  await expect(themeButton(page)).toHaveAccessibleName('外觀：跟隨系統');
  expect(await htmlTheme(page)).toBe('light');
  await themeButton(page).click();
  await expect(themeButton(page)).toHaveAccessibleName('外觀：亮');
  expect(await htmlTheme(page)).toBe('light');
  await themeButton(page).click();
  await expect(themeButton(page)).toHaveAccessibleName('外觀：暗');
  await expect.poll(() => htmlTheme(page)).toBe('dark');
  expect(await bodyBg(page)).toBe(DARK_PAPER);

  // 板面跟著變暗、重畫；豆子顏色不變
  await expect.poll(() => pixel(page, 10, 10)).not.toEqual(emptyLight);
  expect(await pixel(page, 6, 6)).toEqual(beadLight);

  await page.reload();
  await expect(themeButton(page)).toHaveAccessibleName('外觀：暗');
  expect(await htmlTheme(page)).toBe('dark');
  expect(await bodyBg(page)).toBe(DARK_PAPER);
  await expect.poll(() => pixel(page, 6, 6)).toEqual(beadLight);
});

test('following the system switches live when the system appearance changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(themeButton(page)).toHaveAccessibleName('外觀：跟隨系統');
  expect(await htmlTheme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => htmlTheme(page)).toBe('light');
  expect(await bodyBg(page)).toBe(LIGHT_PAPER);
});
