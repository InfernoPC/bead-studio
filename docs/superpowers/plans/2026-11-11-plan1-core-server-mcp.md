# Bead Studio Plan 1：核心引擎 + 伺服器 + MCP + Skill 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立拼豆設計的核心引擎、本機伺服器與 MCP 工具，讓 Claude Code 能建立、修改、檢查、預覽並匯出拼豆設計，並附上設計知識 skill。

**Architecture:** `src/core/` 是純 TypeScript 邏輯（無 I/O），之後的網頁 UI（Plan 2）會共用；`src/server/` 包含檔案儲存（DesignStore，含 undo/快照）、伺服器端渲染（@napi-rs/canvas）、PNG metadata，以及以 Fastify 提供的 MCP Streamable HTTP 端點（`/mcp`）。所有修改都走 `applyOps`（原子性批次指令）。

**Tech Stack:** Node 24、TypeScript 5（ESM）、pnpm、Vitest、tsx、Fastify 5、@modelcontextprotocol/sdk 1.x、zod 3、@napi-rs/canvas、png-chunks-extract／png-chunks-encode

**Spec:** `docs/superpowers/specs/2026-11-11-bead-studio-design.md`

**不在本計畫：** 網頁 UI、WebSocket 同步、庫存管理頁、顏色校正 UI（Plan 2）。

## Global Constraints

- 豆子尺寸只有 `2.6` 與 `5`（mm）；格數 = `floor(mm / bead)`
- 色彩範圍三段：`'all' | 'owned' | 'stock'`
- 形狀鎖定時，任何改變「有沒有豆子」的 op 讓整批被拒（`shape_locked`）
- 留邊違反只警告，不阻擋
- 色差一律使用 CIEDE2000（`deltaE00`），顏色顯示與比對使用 `calibratedHex ?? hex`
- `applyOps` 為原子性：任一條失敗，整批不套用，原設計不變
- 伺服器只綁定 `127.0.0.1`，預設埠 `5174`；MCP 端點 `/mcp`
- PNG metadata：`zTXt` chunk，keyword `bead-studio`，內容為 deflate 後的 Design JSON
- 檢查器門檻預設：`thinChainMin: 4`、`holeMinNeighbors: 3`、`minAdjacentDeltaE: 10`
- 使用者可見訊息（錯誤、摘要、檢查）用繁體中文
- 每個 task 結束都要 `pnpm test` 全綠並 commit；commit 訊息結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## 與規格的差異（刻意）

- `set_board` 改為獨立函式／MCP 工具，而非 `apply_ops` 裡的一條 op：它會改變格數，不適合與其他 op 混在同一批。
- 新增 MCP 工具 `set_inventory`、`export_png`、`select_variant`：Plan 2 的 UI 完成前，使用者可以透過 AI 設定庫存、匯出圖片。
- 幾何類 op 超出格子的部分會被裁切（不報錯），裁切數量回報在摘要的 `clipped`。

## Review Focus

1. **整批指令中有一條錯誤**：使用者預期設計完全不變，而不是做了一半。→ Task 7 測試 `atomic: a failing op leaves the original untouched`
2. **畫到格子外**（AI 算錯座標很常見）：預期畫得到的部分照畫、超出的被裁掉並回報，而不是整批失敗或當機。→ Task 7 測試 `clips out-of-grid drawing and reports clipped count`
3. **在另一個版本新增豆子，讓「庫存版」不夠用**：預期明確拒絕並說明缺什麼，而不是默默超量。→ Task 7 測試 `rejects when a stock variant cannot cover new beads`
4. **拖入沒有 metadata 或 metadata 損毀的 PNG**：預期退回一般圖片轉換，而不是當機。→ Task 14 測試 `returns null for corrupted zTXt`、Task 16 測試 `import_image falls back to image conversion`
5. **縮小面板會裁掉豆子**：預期未帶 `force` 時拒絕且設計不變。→ Task 4 測試 `refuses to crop without force`

---

## 檔案結構

```
bead-studio/
├─ package.json, tsconfig.json, .gitignore, README.md
├─ data/
│  ├─ palette.json            MARD 色表
│  ├─ PALETTE_SOURCES.md      色表資料來源
│  ├─ inventory.json          庫存（預設 {}）
│  └─ designs/                設計檔（執行時產生）
├─ config/checks.json         檢查器門檻
├─ src/
│  ├─ types/png-chunks.d.ts   第三方套件型別宣告
│  ├─ core/
│  │  ├─ errors.ts            OpError
│  │  ├─ color.ts             hex→Lab、CIEDE2000
│  │  ├─ palette.ts           Palette 類別、Inventory、allowedCodes
│  │  ├─ model.ts             Design 型別、createDesign、工具函式
│  │  ├─ board.ts             setBoard（改尺寸、重新取樣）
│  │  ├─ raster.ts            直線／矩形／橢圓／多邊形／油漆桶的格子計算
│  │  ├─ allocate.ts          顏色指派（含庫存上限）
│  │  ├─ opSchema.ts          zod：所有 op 的 schema
│  │  ├─ work.ts              Work 狀態、setCell/getCell/checkColor
│  │  ├─ ops.ts               applyOps
│  │  ├─ effects.ts           outline / gradient / shade
│  │  ├─ variants.ts          createVariant / recolorVariant
│  │  ├─ checks.ts            檢查器
│  │  ├─ textCodec.ts         RLE 文字格式
│  │  ├─ describe.ts          describe_design
│  │  ├─ importImage.ts       RGBA → 格子
│  │  └─ render/draw.ts       平面與 3D 繪圖（Canvas 2D API）
│  └─ server/
│     ├─ render.ts            renderPng（@napi-rs/canvas）
│     ├─ pngmeta.ts           embedDesign / extractDesign
│     ├─ store.ts             DesignStore
│     ├─ mcp.ts               buildMcpServer
│     ├─ app.ts               Fastify app（/mcp、/api/...）
│     └─ index.ts             進入點
├─ tests/                      與 src 對應的 *.test.ts，加上 fixtures.ts
└─ .claude/skills/bead-design/ Skill
```

---

### Task 1: 專案骨架 + 色彩數學

**Files:**
- Create: `package.json`、`tsconfig.json`、`src/core/errors.ts`、`src/core/color.ts`
- Test: `tests/color.test.ts`

**Interfaces:**
- Produces:
  - `type Lab = [number, number, number]`
  - `hexToRgb(hex: string): [number, number, number]`
  - `rgbToLab(rgb: [number, number, number]): Lab`
  - `hexToLab(hex: string): Lab`
  - `deltaE00(a: Lab, b: Lab): number`
  - `class OpError extends Error { code: string; opIndex?: number; cells: [number, number][] }`

- [ ] **Step 1: 初始化專案與相依套件**

```bash
cd /Users/timchen/Repositories/bead-studio
pnpm init
pnpm add fastify@^5 @modelcontextprotocol/sdk@^1 zod@^3.25 @napi-rs/canvas@^1 png-chunks-extract@^1 png-chunks-encode@^1
pnpm add -D typescript@^5 tsx@^4 vitest@^5 @types/node@^24
```

把 `package.json` 改成（保留 pnpm 寫入的 dependencies 區塊）：

```json
{
  "name": "bead-studio",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

建立 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 2: 寫失敗的測試** `tests/color.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { hexToLab, deltaE00, hexToRgb } from '../src/core/color';

describe('color', () => {
  it('parses hex', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });
  it('converts white and red to Lab (D65)', () => {
    const w = hexToLab('#FFFFFF');
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1])).toBeLessThan(0.05);
    expect(Math.abs(w[2])).toBeLessThan(0.05);
    const r = hexToLab('#FF0000');
    expect(r[0]).toBeCloseTo(53.24, 1);
    expect(r[1]).toBeCloseTo(80.09, 0);
    expect(r[2]).toBeCloseTo(67.2, 0);
  });
  it('matches Sharma CIEDE2000 reference pairs', () => {
    expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE00([50, -1.3802, -84.2814], [50, 0, -82.7485])).toBeCloseTo(1.0, 3);
    expect(deltaE00([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
  });
  it('is zero for identical colors', () => {
    expect(deltaE00([40, 10, -5], [40, 10, -5])).toBe(0);
  });
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `pnpm test tests/color.test.ts`
Expected: FAIL（找不到 `../src/core/color`）

- [ ] **Step 4: 實作** `src/core/errors.ts`

```ts
export type Pt = [number, number];

export class OpError extends Error {
  constructor(
    public code: string,
    message: string,
    public opIndex?: number,
    public cells: Pt[] = [],
  ) {
    super(message);
    this.name = 'OpError';
  }
}
```

`src/core/color.ts`

```ts
export type Lab = [number, number, number];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab([R, G, B]: [number, number, number]): Lab {
  const r = lin(R), g = lin(G), b = lin(B);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex));

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function deltaE00([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const t = deg(Math.atan2(b, a));
    return t >= 0 ? t : t + 360;
  };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
```

- [ ] **Step 5: 確認測試通過**

Run: `pnpm test tests/color.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json src tests
git commit -m "feat(core): project scaffold and CIEDE2000 color math"
```

---

### Task 2: Palette、Inventory 與測試 fixtures

**Files:**
- Create: `src/core/palette.ts`、`tests/fixtures.ts`
- Test: `tests/palette.test.ts`

**Interfaces:**
- Consumes: `hexToLab`、`hexToRgb`、`deltaE00`、`Lab`（Task 1）
- Produces:
  - `type PaletteColor = { code: string; name: string; series: string; hex: string; calibratedHex?: string; transparent?: boolean }`
  - `type PaletteEntry = PaletteColor & { displayHex: string; lab: Lab; rgb: [number, number, number] }`
  - `type Inventory = Record<string, { owned: boolean; count: number }>`
  - `type PaletteMode = 'all' | 'owned' | 'stock'`
  - `validatePalette(colors: PaletteColor[]): string[]`
  - `class Palette { has(code); get(code): PaletteEntry | undefined; all(): PaletteEntry[]; entries(codes: Iterable<string>): PaletteEntry[]; nearestLab(lab: Lab, allowed: Set<string>): PaletteEntry | null; nearestIn(code: string, allowed: Set<string>): string | null }`
  - `allowedCodes(p: Palette, inv: Inventory, mode: PaletteMode): Set<string>`
  - `stockCapacity(inv: Inventory): Map<string, number>`
  - `tests/fixtures.ts`：`FIX_COLORS`、`palette`、`invAll`、`ctxAll`、`smallDesign()`（`smallDesign` 在 Task 4 補上）

- [ ] **Step 1: 建立 fixtures** `tests/fixtures.ts`

```ts
import { Palette, type PaletteColor, type Inventory } from '../src/core/palette';

export const FIX_COLORS: PaletteColor[] = [
  { code: 'A1', name: '紅', series: 'A', hex: '#E8434F' },
  { code: 'A2', name: '深紅', series: 'A', hex: '#C9302C' },
  { code: 'A3', name: '粉紅', series: 'A', hex: '#FFC2C7' },
  { code: 'A4', name: '近紅', series: 'A', hex: '#E64652' },
  { code: 'B1', name: '黃', series: 'B', hex: '#FFE066' },
  { code: 'C1', name: '藍', series: 'C', hex: '#2E7EC4' },
  { code: 'H1', name: '白', series: 'H', hex: '#FFFFFF' },
  { code: 'H2', name: '黑', series: 'H', hex: '#111111' },
  { code: 'H3', name: '灰', series: 'H', hex: '#A3A19E' },
  { code: 'T1', name: '透明', series: 'T', hex: '#E9F1F3', transparent: true },
];

export const palette = new Palette(FIX_COLORS);

export const invAll: Inventory = Object.fromEntries(
  FIX_COLORS.map((c) => [c.code, { owned: true, count: 1000 }]),
);

export const ctxAll = { palette, inventory: invAll };
```

- [ ] **Step 2: 寫失敗的測試** `tests/palette.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Palette, validatePalette, allowedCodes, stockCapacity } from '../src/core/palette';
import { FIX_COLORS, palette } from './fixtures';

describe('palette', () => {
  it('validates a good palette', () => {
    expect(validatePalette(FIX_COLORS)).toEqual([]);
  });
  it('reports duplicates, bad hex and series mismatch', () => {
    const errs = validatePalette([
      { code: 'A1', name: 'x', series: 'A', hex: '#FFFFFF' },
      { code: 'A1', name: 'y', series: 'A', hex: '#FFF' },
      { code: 'B2', name: 'z', series: 'A', hex: '#000000' },
    ]);
    expect(errs.join('\n')).toMatch(/重複.*A1/);
    expect(errs.join('\n')).toMatch(/hex.*#FFF/);
    expect(errs.join('\n')).toMatch(/系列.*B2/);
  });
  it('prefers calibratedHex for display and matching', () => {
    const p = new Palette([{ code: 'A1', name: 'x', series: 'A', hex: '#FF0000', calibratedHex: '#00FF00' }]);
    expect(p.get('A1')!.displayHex).toBe('#00FF00');
    expect(p.get('A1')!.rgb).toEqual([0, 255, 0]);
  });
  it('filters allowed codes by mode', () => {
    const inv = { A1: { owned: true, count: 5 }, A2: { owned: true, count: 0 }, B1: { owned: false, count: 9 } };
    expect(allowedCodes(palette, inv, 'all').size).toBe(FIX_COLORS.length);
    expect([...allowedCodes(palette, inv, 'owned')].sort()).toEqual(['A1', 'A2']);
    expect([...allowedCodes(palette, inv, 'stock')]).toEqual(['A1']);
  });
  it('finds nearest allowed color', () => {
    expect(palette.nearestIn('A4', new Set(['A1', 'C1', 'H1']))).toBe('A1');
    expect(palette.nearestIn('A4', new Set())).toBeNull();
  });
  it('builds stock capacity only for owned colors', () => {
    const cap = stockCapacity({ A1: { owned: true, count: 5 }, B1: { owned: false, count: 9 } });
    expect(cap.get('A1')).toBe(5);
    expect(cap.has('B1')).toBe(false);
  });
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `pnpm test tests/palette.test.ts`
Expected: FAIL（找不到 `../src/core/palette`）

- [ ] **Step 4: 實作** `src/core/palette.ts`

```ts
import { deltaE00, hexToLab, hexToRgb, type Lab } from './color';

export type PaletteColor = {
  code: string; name: string; series: string; hex: string;
  calibratedHex?: string; transparent?: boolean;
};
export type PaletteEntry = PaletteColor & { displayHex: string; lab: Lab; rgb: [number, number, number] };
export type Inventory = Record<string, { owned: boolean; count: number }>;
export type PaletteMode = 'all' | 'owned' | 'stock';

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function validatePalette(colors: PaletteColor[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    if (seen.has(c.code)) errs.push(`色號重複：${c.code}`);
    seen.add(c.code);
    if (!HEX.test(c.hex)) errs.push(`${c.code} 的 hex 格式錯誤：${c.hex}`);
    if (c.calibratedHex && !HEX.test(c.calibratedHex)) errs.push(`${c.code} 的 calibratedHex 格式錯誤：${c.calibratedHex}`);
    if (!c.name) errs.push(`${c.code} 缺少名稱`);
    if (!c.code.startsWith(c.series)) errs.push(`${c.code} 的系列 ${c.series} 與色號不符`);
  }
  return errs;
}

export class Palette {
  private map = new Map<string, PaletteEntry>();

  constructor(colors: PaletteColor[]) {
    for (const c of colors) {
      const displayHex = (c.calibratedHex ?? c.hex).toUpperCase();
      this.map.set(c.code, { ...c, displayHex, lab: hexToLab(displayHex), rgb: hexToRgb(displayHex) });
    }
  }
  has(code: string) { return this.map.has(code); }
  get(code: string) { return this.map.get(code); }
  all() { return [...this.map.values()]; }
  entries(codes: Iterable<string>) {
    const out: PaletteEntry[] = [];
    for (const c of codes) { const e = this.map.get(c); if (e) out.push(e); }
    return out;
  }
  nearestLab(lab: Lab, allowed: Set<string>): PaletteEntry | null {
    let best: PaletteEntry | null = null, bd = Infinity;
    for (const e of this.entries(allowed)) {
      const d = deltaE00(lab, e.lab);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestIn(code: string, allowed: Set<string>): string | null {
    const e = this.map.get(code);
    if (!e) return null;
    return this.nearestLab(e.lab, allowed)?.code ?? null;
  }
}

export function allowedCodes(p: Palette, inv: Inventory, mode: PaletteMode): Set<string> {
  return new Set(
    p.all()
      .filter((c) => {
        if (mode === 'all') return true;
        const s = inv[c.code];
        if (!s?.owned) return false;
        return mode === 'owned' || s.count > 0;
      })
      .map((c) => c.code),
  );
}

export function stockCapacity(inv: Inventory): Map<string, number> {
  const m = new Map<string, number>();
  for (const [code, s] of Object.entries(inv)) if (s.owned) m.set(code, s.count);
  return m;
}
```

- [ ] **Step 5: 確認測試通過**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/palette.ts tests/fixtures.ts tests/palette.test.ts
git commit -m "feat(core): palette, inventory and allowed-color filtering"
```

---

### Task 3: MARD 色表資料 + 預設設定檔

**Files:**
- Create: `data/palette.json`、`data/PALETTE_SOURCES.md`、`data/inventory.json`、`config/checks.json`
- Test: `tests/paletteData.test.ts`

**Interfaces:**
- Produces: `data/palette.json`（`PaletteColor[]`）、`config/checks.json`（`ChecksConfig`，Task 10 使用）

- [ ] **Step 1: 寫失敗的測試** `tests/paletteData.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePalette, type PaletteColor } from '../src/core/palette';

const colors: PaletteColor[] = JSON.parse(readFileSync('data/palette.json', 'utf8'));

describe('MARD palette data', () => {
  it('is valid', () => {
    expect(validatePalette(colors)).toEqual([]);
  });
  it('covers the full MARD set', () => {
    expect(colors.length).toBeGreaterThanOrEqual(120);
  });
  it('uses MARD-style codes', () => {
    for (const c of colors) expect(c.code).toMatch(/^[A-Z]{1,2}\d{1,3}$/);
  });
  it('has at least one transparent bead flagged', () => {
    expect(colors.some((c) => c.transparent)).toBe(true);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/paletteData.test.ts`
Expected: FAIL（ENOENT data/palette.json）

- [ ] **Step 3: 整理 MARD 色表**

1. 用 WebSearch／WebFetch 搜尋「MARD 拼豆 色號 對照表 hex」「MARD bead color chart hex」、GitHub 上的拼豆工具 repo（例如搜尋 `mard palette json`）。至少找 2 個來源互相比對。
2. 每個色號依格式寫入 `data/palette.json`：

```json
[
  { "code": "A1", "name": "（來源中的中文名稱）", "series": "A", "hex": "#RRGGBB" }
]
```

   - `series` = 色號開頭的英文字母
   - 透明豆加上 `"transparent": true`
   - 兩個來源的 hex 差異很大（目測明顯不同色）時，用較常見的那個，並記錄在 `PALETTE_SOURCES.md` 的「待校正」清單
3. 寫 `data/PALETTE_SOURCES.md`：列出來源 URL、取得日期、待校正色號清單。
4. 寫 `data/inventory.json`：`{}`
5. 寫 `config/checks.json`：

```json
{ "thinChainMin": 4, "holeMinNeighbors": 3, "minAdjacentDeltaE": 10 }
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/paletteData.test.ts`
Expected: PASS。若 `validatePalette` 回報錯誤，修正 JSON 直到通過。

- [ ] **Step 5: Commit**

```bash
git add data config tests/paletteData.test.ts
git commit -m "data: MARD palette, default inventory and checks config"
```

---

### Task 4: 設計資料模型 + 面板尺寸變更

**Files:**
- Create: `src/core/model.ts`、`src/core/board.ts`
- Modify: `tests/fixtures.ts`（加 `smallDesign`、`paint`）
- Test: `tests/model.test.ts`、`tests/board.test.ts`

**Interfaces:**
- Consumes: `OpError`（Task 1）、`PaletteMode`（Task 2）
- Produces:
  - `type BeadSize = 2.6 | 5`
  - `type Board = { widthMm: number; heightMm: number; bead: BeadSize; margin: number }`
  - `type Marker = { type: 'hole'; x: number; y: number }`
  - `type Variant = { id: string; name: string; paletteMode: PaletteMode; cells: (string | null)[] }`
  - `type DesignCore = { id; name; version; board; cols; rows; mask: string; variants: Variant[]; activeVariant: string; shapeLocked: boolean; markers: Marker[] }`
  - `type Snapshot = { id: string; name: string; at: string; design: DesignCore }`
  - `type Design = DesignCore & { snapshots: Snapshot[] }`
  - `gridSize(b: Board): { cols: number; rows: number }`
  - `createDesign(a: { id: string; name: string; board: Board }): Design`
  - `cloneDesign(d: Design): Design`
  - `coreOf(d: Design): DesignCore`
  - `getVariant(d: Design, id?: string): Variant`（找不到時拋出 `OpError('no_variant')`）
  - `countCodes(cells: (string | null)[]): Record<string, number>`
  - `maskFromCells(cells: (string | null)[]): string`
  - `bbox(d: Design, cells: (string | null)[]): { x0: number; y0: number; x1: number; y1: number } | null`
  - `setBoard(d: Design, patch: Partial<Board>, opts: { keep: 'cells' | 'size'; force?: boolean }): { design: Design; cropped: number }`
  - fixtures：`smallDesign(cols?: number, rows?: number): Design`（5mm 豆、margin 1）、`paint(d: Design, pts: [number, number, string][], variant?: string): Design`（測試用：直接寫入格子並同步 mask）

- [ ] **Step 1: 寫失敗的測試** `tests/model.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createDesign, gridSize, getVariant, countCodes, bbox } from '../src/core/model';
import { smallDesign, paint } from './fixtures';

describe('model', () => {
  it('computes grid from physical size', () => {
    expect(gridSize({ widthMm: 80, heightMm: 80, bead: 2.6, margin: 2 })).toEqual({ cols: 30, rows: 30 });
    expect(gridSize({ widthMm: 50, heightMm: 25, bead: 5, margin: 1 })).toEqual({ cols: 10, rows: 5 });
  });
  it('creates an empty design with one ideal variant', () => {
    const d = createDesign({ id: 'x', name: '測試', board: { widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    expect(d.cols * d.rows).toBe(100);
    expect(d.mask).toBe('0'.repeat(100));
    expect(d.variants).toHaveLength(1);
    expect(d.variants[0]).toMatchObject({ id: 'v1', name: '理想版', paletteMode: 'all' });
    expect(d.shapeLocked).toBe(false);
  });
  it('throws for unknown variant', () => {
    expect(() => getVariant(smallDesign(), 'nope')).toThrow(/找不到配色版本/);
  });
  it('counts codes and computes bbox', () => {
    const d = paint(smallDesign(), [[2, 3, 'A1'], [5, 4, 'A1'], [4, 4, 'H1']]);
    const v = getVariant(d);
    expect(countCodes(v.cells)).toEqual({ A1: 2, H1: 1 });
    expect(bbox(d, v.cells)).toEqual({ x0: 2, y0: 3, x1: 5, y1: 4 });
    expect(bbox(smallDesign(), getVariant(smallDesign()).cells)).toBeNull();
  });
});
```

`tests/board.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { setBoard } from '../src/core/board';
import { getVariant } from '../src/core/model';
import { smallDesign, paint } from './fixtures';

const at = (d: ReturnType<typeof smallDesign>, x: number, y: number) => getVariant(d).cells[y * d.cols + x];

describe('setBoard', () => {
  it('grows the board and keeps content centered', () => {
    const d = paint(smallDesign(10, 10), [[0, 0, 'A1']]);
    const { design, cropped } = setBoard(d, { widthMm: 60, heightMm: 60 }, { keep: 'size' });
    expect(design.cols).toBe(12);
    expect(cropped).toBe(0);
    expect(at(design, 1, 1)).toBe('A1');
    expect(design.mask[1 * 12 + 1]).toBe('1');
  });
  it('refuses to crop without force and leaves design unchanged', () => {
    const d = paint(smallDesign(10, 10), [[0, 0, 'A1']]);
    expect(() => setBoard(d, { widthMm: 40, heightMm: 40 }, { keep: 'size' })).toThrow(/裁掉 1 顆/);
    expect(d.cols).toBe(10);
    const { design, cropped } = setBoard(d, { widthMm: 40, heightMm: 40 }, { keep: 'size', force: true });
    expect(design.cols).toBe(8);
    expect(cropped).toBe(1);
  });
  it('switching bead size keeping cells changes physical size', () => {
    const d = smallDesign(10, 10);
    const { design } = setBoard(d, { bead: 2.6 }, { keep: 'cells' });
    expect(design.cols).toBe(10);
    expect(design.board.widthMm).toBe(26);
  });
  it('switching bead size keeping size resamples', () => {
    const d = paint(smallDesign(10, 10), [[9, 9, 'A1']]);
    const { design } = setBoard(d, { bead: 2.6 }, { keep: 'size' });
    expect(design.cols).toBe(19);
    expect(design.board.widthMm).toBe(50);
    expect(at(design, 18, 18)).toBe('A1');
    expect(at(design, 0, 0)).toBeNull();
  });
  it('moves markers with recentering', () => {
    const d = { ...smallDesign(10, 10), markers: [{ type: 'hole' as const, x: 2, y: 2 }] };
    const { design } = setBoard(d, { widthMm: 60, heightMm: 60 }, { keep: 'size' });
    expect(design.markers).toEqual([{ type: 'hole', x: 3, y: 3 }]);
  });
});
```

在 `tests/fixtures.ts` 末尾加上：

```ts
import { createDesign, cloneDesign, getVariant, maskFromCells, type Design } from '../src/core/model';

export function smallDesign(cols = 10, rows = 10): Design {
  return createDesign({ id: 't', name: '測試', board: { widthMm: cols * 5, heightMm: rows * 5, bead: 5, margin: 1 } });
}

export function paint(d: Design, pts: [number, number, string][], variant?: string): Design {
  const n = cloneDesign(d);
  const v = getVariant(n, variant);
  for (const [x, y, c] of pts) v.cells[y * n.cols + x] = c;
  n.mask = maskFromCells(v.cells);
  for (const o of n.variants) if (o !== v) for (const [x, y, c] of pts) o.cells[y * n.cols + x] = c;
  return n;
}
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/model.test.ts tests/board.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作** `src/core/model.ts`

```ts
import { OpError } from './errors';
import type { PaletteMode } from './palette';

export type BeadSize = 2.6 | 5;
export type Board = { widthMm: number; heightMm: number; bead: BeadSize; margin: number };
export type Marker = { type: 'hole'; x: number; y: number };
export type Variant = { id: string; name: string; paletteMode: PaletteMode; cells: (string | null)[] };
export type DesignCore = {
  id: string; name: string; version: number; board: Board; cols: number; rows: number;
  mask: string; variants: Variant[]; activeVariant: string; shapeLocked: boolean; markers: Marker[];
};
export type Snapshot = { id: string; name: string; at: string; design: DesignCore };
export type Design = DesignCore & { snapshots: Snapshot[] };

export function gridSize(b: Board) {
  return {
    cols: Math.max(1, Math.floor(b.widthMm / b.bead + 1e-6)),
    rows: Math.max(1, Math.floor(b.heightMm / b.bead + 1e-6)),
  };
}

export function createDesign(a: { id: string; name: string; board: Board }): Design {
  const { cols, rows } = gridSize(a.board);
  return {
    id: a.id, name: a.name, version: 0, board: { ...a.board }, cols, rows,
    mask: '0'.repeat(cols * rows),
    variants: [{ id: 'v1', name: '理想版', paletteMode: 'all', cells: Array(cols * rows).fill(null) }],
    activeVariant: 'v1', shapeLocked: false, markers: [], snapshots: [],
  };
}

export const cloneDesign = (d: Design): Design => structuredClone(d);

export function coreOf(d: Design): DesignCore {
  const { snapshots: _s, ...core } = d;
  return structuredClone(core);
}

export function getVariant(d: DesignCore, id?: string): Variant {
  const want = id ?? d.activeVariant;
  const v = d.variants.find((x) => x.id === want);
  if (!v) throw new OpError('no_variant', `找不到配色版本 ${want}`);
  return v;
}

export function countCodes(cells: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cells) if (c) out[c] = (out[c] ?? 0) + 1;
  return out;
}

export const maskFromCells = (cells: (string | null)[]) => cells.map((c) => (c === null ? '0' : '1')).join('');

export function bbox(d: { cols: number; rows: number }, cells: (string | null)[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  cells.forEach((c, i) => {
    if (c === null) return;
    const x = i % d.cols, y = Math.floor(i / d.cols);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
```

`src/core/board.ts`

```ts
import { OpError } from './errors';
import { cloneDesign, gridSize, maskFromCells, type Board, type Design } from './model';

export function setBoard(
  d: Design, patch: Partial<Board>, opts: { keep: 'cells' | 'size'; force?: boolean },
): { design: Design; cropped: number } {
  const next = cloneDesign(d);
  const nb: Board = { ...d.board, ...patch };
  const beadChanged = nb.bead !== d.board.bead;

  if (beadChanged && opts.keep === 'cells') {
    nb.widthMm = +(d.cols * nb.bead).toFixed(2);
    nb.heightMm = +(d.rows * nb.bead).toFixed(2);
    next.board = nb;
    return { design: next, cropped: 0 };
  }

  const { cols, rows } = gridSize(nb);
  let src: (x: number, y: number) => number | null;
  let moveMarker: (x: number, y: number) => [number, number];
  let cropped = 0;

  if (beadChanged) {
    src = (x, y) => Math.floor(((y + 0.5) * d.rows) / rows) * d.cols + Math.floor(((x + 0.5) * d.cols) / cols);
    moveMarker = (x, y) => [Math.floor(((x + 0.5) * cols) / d.cols), Math.floor(((y + 0.5) * rows) / d.rows)];
  } else {
    const dx = Math.floor((cols - d.cols) / 2), dy = Math.floor((rows - d.rows) / 2);
    src = (x, y) => {
      const ox = x - dx, oy = y - dy;
      return ox >= 0 && oy >= 0 && ox < d.cols && oy < d.rows ? oy * d.cols + ox : null;
    };
    moveMarker = (x, y) => [x + dx, y + dy];
    for (let i = 0; i < d.mask.length; i++) {
      if (d.mask[i] !== '1') continue;
      const nx = (i % d.cols) + dx, ny = Math.floor(i / d.cols) + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) cropped++;
    }
    if (cropped > 0 && !opts.force) {
      throw new OpError('would_crop', `新尺寸會裁掉 ${cropped} 顆豆子；確認要裁切請加上 force: true`);
    }
  }

  for (const v of next.variants) {
    const old = v.cells;
    v.cells = Array.from({ length: cols * rows }, (_, i) => {
      const s = src(i % cols, Math.floor(i / cols));
      return s === null ? null : old[s];
    });
  }
  next.board = nb;
  next.cols = cols;
  next.rows = rows;
  next.mask = maskFromCells(next.variants[0].cells);
  next.markers = d.markers
    .map((m) => { const [x, y] = moveMarker(m.x, m.y); return { ...m, x, y }; })
    .filter((m) => m.x >= 0 && m.y >= 0 && m.x < cols && m.y < rows);
  return { design: next, cropped };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/model.ts src/core/board.ts tests
git commit -m "feat(core): design model and board resizing/resampling"
```

---

### Task 5: 格子幾何（raster）

**Files:**
- Create: `src/core/raster.ts`
- Test: `tests/raster.test.ts`

**Interfaces:**
- Consumes: `Pt`（Task 1 `errors.ts`）
- Produces:
  - `linePts(x1, y1, x2, y2): Pt[]`
  - `rectPts(x, y, w, h, fill: boolean): Pt[]`
  - `ellipsePts(x, y, w, h, fill: boolean): Pt[]`
  - `polygonPts(points: Pt[], fill: boolean): Pt[]`
  - `floodRegion(cols, rows, x, y, key: (x: number, y: number) => string): Pt[]`
  - `regionPts(r: { x; y; w; h }, cols, rows): Pt[]`（裁切到格子內）

- [ ] **Step 1: 寫失敗的測試** `tests/raster.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { linePts, rectPts, ellipsePts, polygonPts, floodRegion, regionPts } from '../src/core/raster';

const key = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).sort();

describe('raster', () => {
  it('draws bresenham lines both directions', () => {
    expect(linePts(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(key(linePts(3, 3, 0, 0))).toEqual(key([[0, 0], [1, 1], [2, 2], [3, 3]]));
  });
  it('rect fill vs outline', () => {
    expect(rectPts(0, 0, 3, 3, true)).toHaveLength(9);
    expect(rectPts(0, 0, 3, 3, false)).toHaveLength(8);
  });
  it('ellipse 1x1 is one cell; 5x5 disc is symmetric', () => {
    expect(ellipsePts(2, 2, 1, 1, true)).toEqual([[2, 2]]);
    const disc = ellipsePts(0, 0, 5, 5, true);
    expect(disc).toContainEqual([2, 0]);
    expect(disc).not.toContainEqual([0, 0]);
    const ring = ellipsePts(0, 0, 5, 5, false);
    expect(ring).not.toContainEqual([2, 2]);
    expect(ring).toContainEqual([2, 0]);
  });
  it('polygon fill includes outline cells', () => {
    const tri = polygonPts([[0, 0], [4, 0], [0, 4]], true);
    expect(tri).toContainEqual([1, 1]);
    expect(tri).toContainEqual([4, 0]);
    expect(tri).not.toContainEqual([4, 4]);
  });
  it('flood fills 4-connected same key only', () => {
    const g = ['aab', 'abb', 'aaa'];
    const pts = floodRegion(3, 3, 0, 0, (x, y) => g[y][x]);
    expect(key(pts)).toEqual(key([[0, 0], [1, 0], [0, 1], [0, 2], [1, 2], [2, 2]]));
  });
  it('clips regions to the grid', () => {
    expect(regionPts({ x: -1, y: -1, w: 3, h: 3 }, 5, 5)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/raster.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作** `src/core/raster.ts`

```ts
import type { Pt } from './errors';

export function linePts(x1: number, y1: number, x2: number, y2: number): Pt[] {
  const out: Pt[] = [];
  let x = x1, y = y1;
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

export function rectPts(x: number, y: number, w: number, h: number, fill: boolean): Pt[] {
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++)
      if (fill || i === x || j === y || i === x + w - 1 || j === y + h - 1) out.push([i, j]);
  return out;
}

export function ellipsePts(x: number, y: number, w: number, h: number, fill: boolean): Pt[] {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const inside = (i: number, j: number) =>
    i >= x && j >= y && i < x + w && j < y + h &&
    ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 <= 1;
  const out: Pt[] = [];
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      if (!inside(i, j)) continue;
      if (fill || !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1)) out.push([i, j]);
    }
  return out;
}

export function polygonPts(points: Pt[], fill: boolean): Pt[] {
  const set = new Map<string, Pt>();
  const add = (p: Pt) => set.set(`${p[0]},${p[1]}`, p);
  points.forEach((p, k) => {
    const q = points[(k + 1) % points.length];
    linePts(p[0], p[1], q[0], q[1]).forEach(add);
  });
  if (fill) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    for (let j = Math.min(...ys); j <= Math.max(...ys); j++)
      for (let i = Math.min(...xs); i <= Math.max(...xs); i++) {
        let inside = false;
        for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
          const [xa, ya] = points[a], [xb, yb] = points[b];
          if ((ya > j) !== (yb > j) && i < ((xb - xa) * (j - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) add([i, j]);
      }
  }
  return [...set.values()];
}

export function floodRegion(cols: number, rows: number, x: number, y: number, key: (x: number, y: number) => string): Pt[] {
  const target = key(x, y);
  const seen = new Uint8Array(cols * rows);
  const out: Pt[] = [];
  const stack: Pt[] = [[x, y]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= cols || j >= rows || seen[j * cols + i] || key(i, j) !== target) continue;
    seen[j * cols + i] = 1;
    out.push([i, j]);
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return out;
}

export function regionPts(r: { x: number; y: number; w: number; h: number }, cols: number, rows: number): Pt[] {
  return rectPts(r.x, r.y, r.w, r.h, true).filter(([i, j]) => i >= 0 && j >= 0 && i < cols && j < rows);
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/raster.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/raster.ts tests/raster.test.ts
git commit -m "feat(core): grid rasterization helpers"
```

---

### Task 6: 顏色指派（含庫存上限）

**Files:**
- Create: `src/core/allocate.ts`
- Test: `tests/allocate.test.ts`

**Interfaces:**
- Consumes: `deltaE00`、`Lab`、`PaletteEntry`、`OpError`
- Produces:
  - `type Target = { index: number; lab: Lab }`
  - `allocate(targets: Target[], allowed: PaletteEntry[], capacity?: Map<string, number>): Map<number, string>`：回傳 `index → 色號`。`allowed` 為空時拋出 `OpError('no_colors')`；總容量不足時拋出 `OpError('stock_insufficient')`，訊息含缺少的顆數。

- [ ] **Step 1: 寫失敗的測試** `tests/allocate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { allocate } from '../src/core/allocate';
import { palette } from './fixtures';

const lab = (code: string) => palette.get(code)!.lab;
const allowed = (...codes: string[]) => palette.entries(codes);

describe('allocate', () => {
  it('assigns nearest colors without capacity', () => {
    const m = allocate([{ index: 0, lab: lab('A4') }, { index: 5, lab: lab('H1') }], allowed('A1', 'H1', 'C1'));
    expect(m.get(0)).toBe('A1');
    expect(m.get(5)).toBe('H1');
  });
  it('respects capacity by moving the cheapest cells to next-best colors', () => {
    const targets = [0, 1, 2].map((i) => ({ index: i, lab: lab('A1') }));
    const m = allocate(targets, allowed('A1', 'A2', 'H1'), new Map([['A1', 1], ['A2', 5], ['H1', 5]]));
    const vals = [...m.values()];
    expect(vals.filter((c) => c === 'A1')).toHaveLength(1);
    expect(vals.filter((c) => c === 'A2')).toHaveLength(2);
  });
  it('throws with the missing count when stock is insufficient', () => {
    const targets = [0, 1, 2].map((i) => ({ index: i, lab: lab('A1') }));
    expect(() => allocate(targets, allowed('A1'), new Map([['A1', 1]]))).toThrow(/缺 2 顆/);
  });
  it('throws when no colors are allowed', () => {
    expect(() => allocate([{ index: 0, lab: lab('A1') }], [])).toThrow(/沒有可用的顏色/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/allocate.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/allocate.ts`

```ts
import { deltaE00, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

export type Target = { index: number; lab: Lab };

export function allocate(targets: Target[], allowed: PaletteEntry[], capacity?: Map<string, number>): Map<number, string> {
  if (targets.length === 0) return new Map();
  if (allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  const cap = (ci: number) => (capacity ? capacity.get(allowed[ci].code) ?? 0 : Infinity);
  if (capacity) {
    const total = allowed.reduce((s, _, ci) => s + cap(ci), 0);
    if (total < targets.length) {
      throw new OpError('stock_insufficient', `需要 ${targets.length} 顆，可用庫存只有 ${total} 顆，缺 ${targets.length - total} 顆`);
    }
  }
  const dist = targets.map((t) => allowed.map((c) => deltaE00(t.lab, c.lab)));
  const assign = dist.map((row) => row.indexOf(Math.min(...row)));

  if (capacity) {
    const used = allowed.map(() => 0);
    assign.forEach((ci) => used[ci]++);
    for (;;) {
      const over = used.findIndex((u, ci) => u > cap(ci));
      if (over < 0) break;
      let best = { t: -1, ci: -1, cost: Infinity };
      assign.forEach((ci, t) => {
        if (ci !== over) return;
        dist[t].forEach((d, cj) => {
          if (cj === over || used[cj] >= cap(cj)) return;
          const cost = d - dist[t][ci];
          if (cost < best.cost) best = { t, ci: cj, cost };
        });
      });
      if (best.t < 0) throw new OpError('stock_insufficient', '庫存不足，無法分配顏色');
      used[over]--; used[best.ci]++; assign[best.t] = best.ci;
    }
  }
  return new Map(targets.map((t, k) => [t.index, allowed[assign[k]].code]));
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/allocate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/allocate.ts tests/allocate.test.ts
git commit -m "feat(core): stock-aware color allocation"
```

---

### Task 7: Op schema 與 applyOps

**Files:**
- Create: `src/core/opSchema.ts`、`src/core/work.ts`、`src/core/ops.ts`
- Test: `tests/ops.test.ts`

**Interfaces:**
- Consumes: Task 1–6 的所有輸出
- Produces:
  - `OpSchema`（zod discriminated union，key `op`）、`type Op = z.infer<typeof OpSchema>`、`RegionSchema`
  - `type OpCtx = { palette: Palette; inventory: Inventory }`
  - `type Work = { cols; rows; cells: (string|null)[]; allowed: Set<string>; palette: Palette; markers: Marker[]; clipped: number; opIndex: number }`
  - `getCell(w: Work, x, y): string | null`（格子外回傳 `null`）
  - `setCell(w: Work, x, y, code: string | null): void`（格子外 `clipped++`）
  - `checkColor(w: Work, code: string): void`
  - `type Summary = { variant: string; total: number; counts: Record<string, number>; delta: Record<string, number>; clipped: number }`
  - `applyOps(design: Design, rawOps: unknown[], ctx: OpCtx, variantId?: string): { design: Design; summary: Summary }`
  - `syncOtherVariants(d: Design, from: Variant, ctx: OpCtx): void`（Task 9 也會用到）

- [ ] **Step 1: 寫失敗的測試** `tests/ops.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyOps } from '../src/core/ops';
import { getVariant, cloneDesign } from '../src/core/model';
import { OpError } from '../src/core/errors';
import { smallDesign, paint, palette, ctxAll } from './fixtures';

const cell = (d: any, x: number, y: number, v?: string) => getVariant(d, v).cells[y * d.cols + x];

function twoVariants(mode: 'all' | 'owned' | 'stock') {
  const d = smallDesign();
  d.variants.push({ id: 'v2', name: '庫存版', paletteMode: mode, cells: Array(100).fill(null) });
  return d;
}

describe('applyOps', () => {
  it('paste uses legend, "." keeps, "_" clears', () => {
    const d0 = paint(smallDesign(), [[3, 1, 'H1']]);
    const { design } = applyOps(d0, [
      { op: 'paste', x: 1, y: 1, rows: ['ab_', '.a.'], legend: { a: 'A1', b: 'H2' } },
    ], ctxAll);
    expect(cell(design, 1, 1)).toBe('A1');
    expect(cell(design, 2, 1)).toBe('H2');
    expect(cell(design, 3, 1)).toBeNull();
    expect(cell(design, 1, 2)).toBeNull();
    expect(cell(design, 2, 2)).toBe('A1');
    expect(design.mask[1 * 10 + 1]).toBe('1');
  });

  it('draws rect / ellipse / line / polygon and summarizes counts', () => {
    const { design, summary } = applyOps(smallDesign(), [
      { op: 'rect', x: 0, y: 0, w: 3, h: 3, color: 'A1', fill: false },
      { op: 'line', x1: 5, y1: 5, x2: 8, y2: 5, color: 'H2' },
    ], ctxAll);
    expect(summary.counts).toEqual({ A1: 8, H2: 4 });
    expect(summary.delta).toEqual({ A1: 8, H2: 4 });
    expect(summary.total).toBe(12);
    expect(cell(design, 1, 1)).toBeNull();
  });

  it('clips out-of-grid drawing and reports clipped count', () => {
    const { design, summary } = applyOps(smallDesign(), [{ op: 'rect', x: 8, y: 8, w: 4, h: 4, color: 'A1', fill: true }], ctxAll);
    expect(summary.counts.A1).toBe(4);
    expect(summary.clipped).toBe(12);
    expect(cell(design, 9, 9)).toBe('A1');
  });

  it('atomic: a failing op leaves the original untouched', () => {
    const d0 = smallDesign();
    const before = JSON.stringify(d0);
    expect(() => applyOps(d0, [
      { op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1', fill: true },
      { op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'ZZ9', fill: true },
    ], ctxAll)).toThrow(/未知色號 ZZ9/);
    expect(JSON.stringify(d0)).toBe(before);
  });

  it('reports schema errors with op index', () => {
    try {
      applyOps(smallDesign(), [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1' }, { op: 'nope' }], ctxAll);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(OpError);
      expect((e as OpError).code).toBe('bad_op');
      expect((e as OpError).opIndex).toBe(1);
    }
  });

  it('flood fill replaces a connected region', () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1'], [2, 0, 'H1'], [0, 1, 'A1']]);
    const { design } = applyOps(d0, [{ op: 'fill', x: 0, y: 0, color: 'C1' }], ctxAll);
    expect(cell(design, 1, 0)).toBe('C1');
    expect(cell(design, 0, 1)).toBe('C1');
    expect(cell(design, 2, 0)).toBe('H1');
  });

  it('replace_color, clear, move, mirror, rotate', () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'H1']]);
    let d = applyOps(d0, [{ op: 'replace_color', from: 'A1', to: 'C1' }], ctxAll).design;
    expect(cell(d, 0, 0)).toBe('C1');
    d = applyOps(d, [{ op: 'move', region: { x: 0, y: 0, w: 2, h: 1 }, dx: 2, dy: 3 }], ctxAll).design;
    expect(cell(d, 0, 0)).toBeNull();
    expect(cell(d, 2, 3)).toBe('C1');
    expect(cell(d, 3, 3)).toBe('H1');
    d = applyOps(d, [{ op: 'mirror', region: { x: 2, y: 3, w: 2, h: 1 }, axis: 'h' }], ctxAll).design;
    expect(cell(d, 2, 3)).toBe('H1');
    d = applyOps(d, [{ op: 'rotate', region: { x: 2, y: 2, w: 2, h: 2 }, turns: 1 }], ctxAll).design;
    // 區域 (2,2)-(3,3)：左下 H1、右下 C1 → 順時針 90° → 左上 H1、左下 C1
    expect(cell(d, 2, 2)).toBe('H1');
    expect(cell(d, 2, 3)).toBe('C1');
    d = applyOps(d, [{ op: 'clear', region: { x: 0, y: 0, w: 10, h: 10 } }], ctxAll).design;
    expect(d.mask).toBe('0'.repeat(100));
  });

  it('rotate 90 on a non-square region is rejected', () => {
    expect(() => applyOps(smallDesign(), [{ op: 'rotate', region: { x: 0, y: 0, w: 2, h: 3 }, turns: 1 }], ctxAll)).toThrow(/正方形/);
  });

  it('shape lock rejects adding beads but allows recoloring', () => {
    const d0 = { ...paint(smallDesign(), [[0, 0, 'A1']]), shapeLocked: true };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctxAll))
      .toThrow(/形狀已鎖定/);
    const { design } = applyOps(d0, [{ op: 'replace_color', from: 'A1', to: 'H2' }], ctxAll);
    expect(cell(design, 0, 0)).toBe('H2');
  });

  it('shape lock allows transforms that keep occupancy', () => {
    const d0 = { ...paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'H1']]), shapeLocked: true };
    const { design } = applyOps(d0, [{ op: 'mirror', region: { x: 0, y: 0, w: 2, h: 1 }, axis: 'h' }], ctxAll);
    expect(cell(design, 0, 0)).toBe('H1');
  });

  it('palette mode rejects colors outside the range with a suggestion', () => {
    const d0 = twoVariants('owned');
    const ctx = { palette, inventory: { A1: { owned: true, count: 10 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A4' }], ctx, 'v2'))
      .toThrow(/A4 不在.*最接近的可用色是 A1/);
  });

  it('adding beads propagates to other variants with nearest allowed color; removing clears all', () => {
    const d0 = twoVariants('owned');
    const ctx = { palette, inventory: { A1: { owned: true, count: 10 }, H1: { owned: true, count: 10 } } };
    let d = applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A4' }], ctx).design;
    expect(cell(d, 0, 0, 'v1')).toBe('A4');
    expect(cell(d, 0, 0, 'v2')).toBe('A1');
    d = applyOps(d, [{ op: 'clear', region: { x: 0, y: 0, w: 1, h: 1 } }], ctx).design;
    expect(cell(d, 0, 0, 'v2')).toBeNull();
  });

  it('stock variant gets next-best stocked color when the nearest runs out', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 }, A2: { owned: true, count: 5 } } };
    const { design } = applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx);
    const v2 = [cell(design, 0, 0, 'v2'), cell(design, 1, 0, 'v2')].sort();
    expect(v2).toEqual(['A1', 'A2']);
  });

  it('rejects when a stock variant cannot cover new beads', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx))
      .toThrow(/庫存版.*缺 1 顆/);
  });

  it('rejects painting a stock variant beyond its stock', () => {
    const d0 = twoVariants('stock');
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 } } };
    expect(() => applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1', fill: true }], ctx, 'v2'))
      .toThrow(/A1 需要 2 顆，庫存只有 1 顆/);
  });

  it('set_hole adds and removes markers', () => {
    let d = applyOps(smallDesign(), [{ op: 'set_hole', x: 4, y: 0 }], ctxAll).design;
    expect(d.markers).toEqual([{ type: 'hole', x: 4, y: 0 }]);
    d = applyOps(d, [{ op: 'set_hole', x: 4, y: 0, remove: true }], ctxAll).design;
    expect(d.markers).toEqual([]);
  });

  it('does not mutate its input', () => {
    const d0 = smallDesign();
    const copy = cloneDesign(d0);
    applyOps(d0, [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'A1', fill: true }], ctxAll);
    expect(d0).toEqual(copy);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/ops.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/opSchema.ts`

```ts
import { z } from 'zod';

const int = z.number().int();
const code = z.string().min(1);
export const RegionSchema = z.object({ x: int, y: int, w: int.positive(), h: int.positive() });
const Light = z.enum(['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']);

export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('paste'), x: int, y: int, rows: z.array(z.string()), legend: z.record(z.string(), code) }),
  z.object({ op: z.literal('rect'), x: int, y: int, w: int.positive(), h: int.positive(), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('ellipse'), x: int, y: int, w: int.positive(), h: int.positive(), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('line'), x1: int, y1: int, x2: int, y2: int, color: code }),
  z.object({ op: z.literal('polygon'), points: z.array(z.tuple([int, int])).min(3), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('fill'), x: int, y: int, color: code }),
  z.object({ op: z.literal('replace_color'), from: code, to: code, region: RegionSchema.optional() }),
  z.object({ op: z.literal('clear'), region: RegionSchema }),
  z.object({ op: z.literal('move'), region: RegionSchema, dx: int, dy: int }),
  z.object({ op: z.literal('mirror'), region: RegionSchema, axis: z.enum(['h', 'v']) }),
  z.object({ op: z.literal('rotate'), region: RegionSchema, turns: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ op: z.literal('outline'), target: code, color: code, side: z.enum(['outer', 'inner']), connect: z.union([z.literal(4), z.literal(8)]).optional() }),
  z.object({
    op: z.literal('gradient'), target: code, region: RegionSchema.optional(), colors: z.array(code).min(2),
    direction: z.union([z.enum(['h', 'v', 'radial']), z.number()]), dither: z.boolean().optional(),
  }),
  z.object({ op: z.literal('shade'), target: code, light: Light, highlight: code, shadow: code, depth: int.positive().optional() }),
  z.object({ op: z.literal('set_hole'), x: int, y: int, remove: z.boolean().optional() }),
]);

export type Op = z.infer<typeof OpSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Light = z.infer<typeof Light>;
```

`src/core/work.ts`

```ts
import { OpError } from './errors';
import type { Marker } from './model';
import type { Palette } from './palette';

export type Work = {
  cols: number; rows: number;
  cells: (string | null)[];
  allowed: Set<string>;
  palette: Palette;
  markers: Marker[];
  clipped: number;
  opIndex: number;
};

export const inGrid = (w: Work, x: number, y: number) => x >= 0 && y >= 0 && x < w.cols && y < w.rows;

export function getCell(w: Work, x: number, y: number): string | null {
  return inGrid(w, x, y) ? w.cells[y * w.cols + x] : null;
}

export function checkColor(w: Work, code: string): void {
  if (!w.palette.has(code)) throw new OpError('unknown_color', `第 ${w.opIndex} 條指令：未知色號 ${code}`, w.opIndex);
  if (!w.allowed.has(code)) {
    const near = w.palette.nearestIn(code, w.allowed);
    throw new OpError('color_not_allowed', `第 ${w.opIndex} 條指令：色號 ${code} 不在此版本的色彩範圍內，最接近的可用色是 ${near ?? '（無）'}`, w.opIndex);
  }
}

export function setCell(w: Work, x: number, y: number, code: string | null): void {
  if (!inGrid(w, x, y)) { w.clipped++; return; }
  if (code !== null) checkColor(w, code);
  w.cells[y * w.cols + x] = code;
}
```

`src/core/ops.ts`

```ts
import { allocate } from './allocate';
import { OpError, type Pt } from './errors';
import { cloneDesign, countCodes, getVariant, maskFromCells, type Design, type Variant } from './model';
import { OpSchema, type Op } from './opSchema';
import { allowedCodes, stockCapacity, type Inventory, type Palette } from './palette';
import { ellipsePts, floodRegion, linePts, polygonPts, rectPts, regionPts } from './raster';
import { checkColor, getCell, inGrid, setCell, type Work } from './work';

export type OpCtx = { palette: Palette; inventory: Inventory };
export type Summary = { variant: string; total: number; counts: Record<string, number>; delta: Record<string, number>; clipped: number };

function parseOps(raw: unknown[]): Op[] {
  return raw.map((r, i) => {
    const res = OpSchema.safeParse(r);
    if (!res.success) {
      const issue = res.error.issues[0];
      throw new OpError('bad_op', `第 ${i} 條指令格式錯誤：${issue.path.join('.') || 'op'} ${issue.message}`, i);
    }
    return res.data;
  });
}

const paintPts = (w: Work, pts: Pt[], color: string) => pts.forEach(([x, y]) => setCell(w, x, y, color));

function runOp(w: Work, op: Op): void {
  switch (op.op) {
    case 'paste':
      op.rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        if (ch === '_') return setCell(w, op.x + i, op.y + j, null);
        const code = op.legend[ch];
        if (!code) throw new OpError('bad_legend', `第 ${w.opIndex} 條指令：legend 沒有定義字元「${ch}」`, w.opIndex);
        setCell(w, op.x + i, op.y + j, code);
      }));
      return;
    case 'rect': return paintPts(w, rectPts(op.x, op.y, op.w, op.h, op.fill ?? true), op.color);
    case 'ellipse': return paintPts(w, ellipsePts(op.x, op.y, op.w, op.h, op.fill ?? true), op.color);
    case 'line': return paintPts(w, linePts(op.x1, op.y1, op.x2, op.y2), op.color);
    case 'polygon': return paintPts(w, polygonPts(op.points, op.fill ?? true), op.color);
    case 'fill': {
      if (!inGrid(w, op.x, op.y)) throw new OpError('out_of_bounds', `第 ${w.opIndex} 條指令：起點 (${op.x},${op.y}) 在格子外`, w.opIndex);
      return paintPts(w, floodRegion(w.cols, w.rows, op.x, op.y, (x, y) => String(getCell(w, x, y))), op.color);
    }
    case 'replace_color': {
      checkColor(w, op.to);
      const pts = op.region ? regionPts(op.region, w.cols, w.rows) : regionPts({ x: 0, y: 0, w: w.cols, h: w.rows }, w.cols, w.rows);
      return pts.forEach(([x, y]) => { if (getCell(w, x, y) === op.from) setCell(w, x, y, op.to); });
    }
    case 'clear': return regionPts(op.region, w.cols, w.rows).forEach(([x, y]) => setCell(w, x, y, null));
    case 'move': {
      const src = regionPts(op.region, w.cols, w.rows).map(([x, y]) => [x, y, getCell(w, x, y)] as const);
      src.forEach(([x, y]) => setCell(w, x, y, null));
      src.forEach(([x, y, c]) => { if (c !== null) setCell(w, x + op.dx, y + op.dy, c); });
      return;
    }
    case 'mirror': {
      const { x, y, w: rw, h: rh } = op.region;
      const copy = regionPts(op.region, w.cols, w.rows).map(([i, j]) => [i, j, getCell(w, i, j)] as const);
      copy.forEach(([i, j, c]) => {
        const ti = op.axis === 'h' ? x + rw - 1 - (i - x) : i;
        const tj = op.axis === 'v' ? y + rh - 1 - (j - y) : j;
        if (inGrid(w, ti, tj)) w.cells[tj * w.cols + ti] = c;
      });
      return;
    }
    case 'rotate': {
      const { x, y, w: rw, h: rh } = op.region;
      if (op.turns % 2 === 1 && rw !== rh) throw new OpError('bad_op', `第 ${w.opIndex} 條指令：旋轉 90°/270° 需要正方形範圍`, w.opIndex);
      const copy = regionPts(op.region, w.cols, w.rows).map(([i, j]) => [i - x, j - y, getCell(w, i, j)] as const);
      copy.forEach(([u, v]) => { if (inGrid(w, x + u, y + v)) w.cells[(y + v) * w.cols + x + u] = null; });
      copy.forEach(([u0, v0, c]) => {
        let u = u0, v = v0;
        for (let k = 0; k < op.turns; k++) [u, v] = [rw - 1 - v, u];
        setCell(w, x + u, y + v, c);
      });
      return;
    }
    case 'set_hole': {
      if (!inGrid(w, op.x, op.y)) throw new OpError('out_of_bounds', `第 ${w.opIndex} 條指令：掛孔 (${op.x},${op.y}) 在格子外`, w.opIndex);
      w.markers = w.markers.filter((m) => !(m.type === 'hole' && m.x === op.x && m.y === op.y));
      if (!op.remove) w.markers.push({ type: 'hole', x: op.x, y: op.y });
      return;
    }
    case 'outline':
    case 'gradient':
    case 'shade':
      throw new OpError('unsupported', `第 ${w.opIndex} 條指令：${op.op} 尚未支援`, w.opIndex);
  }
}

function assertStock(v: Variant, inv: Inventory): void {
  for (const [code, n] of Object.entries(countCodes(v.cells))) {
    const have = inv[code]?.owned ? inv[code].count : 0;
    if (n > have) throw new OpError('stock_exceeded', `版本「${v.name}」的 ${code} 需要 ${n} 顆，庫存只有 ${have} 顆`);
  }
}

export function syncOtherVariants(d: Design, from: Variant, ctx: OpCtx): void {
  for (const o of d.variants) {
    if (o === from) continue;
    const added: number[] = [];
    from.cells.forEach((c, i) => {
      if (c === null) o.cells[i] = null;
      else if (o.cells[i] === null) added.push(i);
    });
    if (added.length === 0) continue;
    const allowed = ctx.palette.entries(allowedCodes(ctx.palette, ctx.inventory, o.paletteMode));
    let capacity: Map<string, number> | undefined;
    if (o.paletteMode === 'stock') {
      capacity = stockCapacity(ctx.inventory);
      for (const [code, n] of Object.entries(countCodes(o.cells))) capacity.set(code, (capacity.get(code) ?? 0) - n);
    }
    try {
      const m = allocate(added.map((i) => ({ index: i, lab: ctx.palette.get(from.cells[i]!)!.lab })), allowed, capacity);
      m.forEach((code, i) => { o.cells[i] = code; });
    } catch (e) {
      if (e instanceof OpError) throw new OpError(e.code, `版本「${o.name}」無法補上新增的豆子：${e.message}`);
      throw e;
    }
  }
}

export function applyOps(design: Design, rawOps: unknown[], ctx: OpCtx, variantId?: string): { design: Design; summary: Summary } {
  const ops = parseOps(rawOps);
  const next = cloneDesign(design);
  const v = getVariant(next, variantId);
  const before = countCodes(v.cells);
  const w: Work = {
    cols: next.cols, rows: next.rows, cells: [...v.cells],
    allowed: allowedCodes(ctx.palette, ctx.inventory, v.paletteMode),
    palette: ctx.palette, markers: next.markers.map((m) => ({ ...m })), clipped: 0, opIndex: 0,
  };
  ops.forEach((op, i) => {
    w.opIndex = i;
    const mask = next.shapeLocked ? maskFromCells(w.cells) : '';
    runOp(w, op);
    if (next.shapeLocked) {
      const after = maskFromCells(w.cells);
      if (after !== mask) {
        const cells: Pt[] = [];
        for (let k = 0; k < after.length; k++) if (after[k] !== mask[k]) cells.push([k % w.cols, Math.floor(k / w.cols)]);
        throw new OpError('shape_locked', `形狀已鎖定：第 ${i} 條指令會改變 ${cells.length} 格的有無（例如 (${cells[0][0]},${cells[0][1]})），只能換色`, i, cells);
      }
    }
  });
  v.cells = w.cells;
  next.markers = w.markers;
  if (v.paletteMode === 'stock') assertStock(v, ctx.inventory);
  syncOtherVariants(next, v, ctx);
  next.mask = maskFromCells(v.cells);

  const counts = countCodes(v.cells);
  const delta: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(counts)])) {
    const dlt = (counts[k] ?? 0) - (before[k] ?? 0);
    if (dlt !== 0) delta[k] = dlt;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { design: next, summary: { variant: v.id, total, counts, delta, clipped: w.clipped } };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/ops.test.ts`
Expected: PASS。若 `rotate` 測試失敗，對照測試中的註解（左下 H1、右下 C1 順時針轉 90° 後為左上 H1、左下 C1），檢查 `(u,v) → (rw-1-v, u)` 的方向。

- [ ] **Step 5: Commit**

```bash
git add src/core/opSchema.ts src/core/work.ts src/core/ops.ts tests/ops.test.ts
git commit -m "feat(core): atomic applyOps with shape lock, palette modes and variant sync"
```

---

### Task 8: 美化效果（outline / gradient / shade）

**Files:**
- Create: `src/core/effects.ts`
- Modify: `src/core/ops.ts`（`outline`／`gradient`／`shade` 三個 case）
- Test: `tests/effects.test.ts`

**Interfaces:**
- Consumes: `Work`、`getCell`、`setCell`、`checkColor`（Task 7）、`Op`（Task 7）
- Produces: `outline(w, op)`、`gradient(w, op)`、`shade(w, op)`，參數型別為對應的 `Extract<Op, { op: '...' }>`

- [ ] **Step 1: 寫失敗的測試** `tests/effects.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { applyOps } from '../src/core/ops';
import { getVariant } from '../src/core/model';
import { smallDesign, paint, ctxAll } from './fixtures';

const cell = (d: any, x: number, y: number) => getVariant(d).cells[y * d.cols + x];
const block = (x0: number, y0: number, n: number, c: string) => {
  const pts: [number, number, string][] = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) pts.push([x, y, c]);
  return pts;
};

describe('effects', () => {
  it('outer outline (8-connected) surrounds a single bead', () => {
    const { summary } = applyOps(paint(smallDesign(), [[4, 4, 'A1']]), [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer' }], ctxAll);
    expect(summary.counts.H2).toBe(8);
  });
  it('outer outline with connect 4 skips diagonals', () => {
    const { summary } = applyOps(paint(smallDesign(), [[4, 4, 'A1']]), [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer', connect: 4 }], ctxAll);
    expect(summary.counts.H2).toBe(4);
  });
  it('inner outline recolors the border of a block', () => {
    const { design } = applyOps(paint(smallDesign(), block(2, 2, 3, 'A1')), [{ op: 'outline', target: 'A1', color: 'H2', side: 'inner' }], ctxAll);
    expect(cell(design, 3, 3)).toBe('A1');
    expect(cell(design, 2, 2)).toBe('H2');
    expect(cell(design, 4, 3)).toBe('H2');
  });
  it('horizontal gradient splits evenly', () => {
    const row: [number, number, string][] = [0, 1, 2, 3, 4, 5].map((x) => [x, 0, 'H1']);
    const { design } = applyOps(paint(smallDesign(), row), [{ op: 'gradient', target: 'H1', colors: ['A1', 'B1', 'C1'], direction: 'h' }], ctxAll);
    expect([0, 1, 2, 3, 4, 5].map((x) => cell(design, x, 0))).toEqual(['A1', 'A1', 'B1', 'B1', 'C1', 'C1']);
  });
  it('gradient never adds beads', () => {
    const { summary } = applyOps(paint(smallDesign(), [[1, 1, 'H1']]), [{ op: 'gradient', target: 'shape', colors: ['A1', 'C1'], direction: 'v', dither: true }], ctxAll);
    expect(summary.total).toBe(1);
  });
  it('shade from top-left lights top/left edges and darkens bottom/right', () => {
    const { design } = applyOps(paint(smallDesign(), block(0, 0, 3, 'A1')), [
      { op: 'shade', target: 'A1', light: 'tl', highlight: 'A3', shadow: 'A2' },
    ], ctxAll);
    expect(cell(design, 0, 0)).toBe('A3');
    expect(cell(design, 1, 0)).toBe('A3');
    expect(cell(design, 0, 1)).toBe('A3');
    expect(cell(design, 1, 1)).toBe('A1');
    expect(cell(design, 2, 2)).toBe('A2');
    expect(cell(design, 2, 1)).toBe('A2');
    expect(cell(design, 2, 0)).toBe('A1');
  });
  it('outer outline is rejected when shape is locked', () => {
    const d = { ...paint(smallDesign(), [[4, 4, 'A1']]), shapeLocked: true };
    expect(() => applyOps(d, [{ op: 'outline', target: 'shape', color: 'H2', side: 'outer' }], ctxAll)).toThrow(/形狀已鎖定/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/effects.test.ts`
Expected: FAIL（`尚未支援`）

- [ ] **Step 3: 實作** `src/core/effects.ts`

```ts
import type { Op, Region, Light } from './opSchema';
import { checkColor, setCell, type Work } from './work';

type OpOf<K extends Op['op']> = Extract<Op, { op: K }>;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS: Record<Light, [number, number]> = {
  tl: [-1, -1], t: [0, -1], tr: [1, -1], l: [-1, 0], r: [1, 0], bl: [-1, 1], b: [0, 1], br: [1, 1],
};

function targetSet(w: Work, target: string, region?: Region): Set<number> {
  const s = new Set<number>();
  w.cells.forEach((c, i) => {
    if (c === null || (target !== 'shape' && c !== target)) return;
    if (region) {
      const x = i % w.cols, y = Math.floor(i / w.cols);
      if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return;
    }
    s.add(i);
  });
  return s;
}

const idxOf = (w: Work, x: number, y: number) => (x >= 0 && y >= 0 && x < w.cols && y < w.rows ? y * w.cols + x : -1);

export function outline(w: Work, op: OpOf<'outline'>): void {
  const T = targetSet(w, op.target);
  const nbs = op.side === 'outer' && op.connect !== 4 ? N8 : N4;
  const hits: number[] = [];
  for (let i = 0; i < w.cells.length; i++) {
    const x = i % w.cols, y = Math.floor(i / w.cols);
    const around = nbs.map(([dx, dy]) => idxOf(w, x + dx, y + dy));
    if (op.side === 'outer' && !T.has(i) && around.some((k) => T.has(k))) hits.push(i);
    if (op.side === 'inner' && T.has(i) && around.some((k) => !T.has(k))) hits.push(i);
  }
  hits.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.color));
}

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

export function gradient(w: Work, op: OpOf<'gradient'>): void {
  op.colors.forEach((c) => checkColor(w, c));
  const T = [...targetSet(w, op.target, op.region)];
  if (T.length === 0) return;
  const pos = T.map((i) => [i % w.cols, Math.floor(i / w.cols)] as const);
  let val: number[];
  if (op.direction === 'radial') {
    const cx = pos.reduce((s, p) => s + p[0], 0) / pos.length, cy = pos.reduce((s, p) => s + p[1], 0) / pos.length;
    val = pos.map(([x, y]) => Math.hypot(x - cx, y - cy));
  } else {
    const deg = op.direction === 'h' ? 0 : op.direction === 'v' ? 90 : op.direction;
    const ux = Math.cos((deg * Math.PI) / 180), uy = Math.sin((deg * Math.PI) / 180);
    val = pos.map(([x, y]) => x * ux + y * uy);
  }
  const lo = Math.min(...val), hi = Math.max(...val), n = op.colors.length;
  T.forEach((i, k) => {
    const t = hi === lo ? 0 : (val[k] - lo) / (hi - lo);
    const [x, y] = pos[k];
    let ci: number;
    if (op.dither) {
      const p = t * (n - 1), base = Math.floor(p), frac = p - base;
      ci = Math.min(n - 1, frac > BAYER[y % 4][x % 4] / 16 + 1 / 32 ? base + 1 : base);
    } else {
      ci = Math.min(n - 1, Math.floor(t * n));
    }
    setCell(w, x, y, op.colors[ci]);
  });
}

export function shade(w: Work, op: OpOf<'shade'>): void {
  checkColor(w, op.highlight);
  checkColor(w, op.shadow);
  const T = targetSet(w, op.target);
  const [dx, dy] = DIRS[op.light];
  const depth = op.depth ?? 1;
  const hi: number[] = [], sh: number[] = [];
  for (const i of T) {
    const x = i % w.cols, y = Math.floor(i / w.cols);
    let lit = false, dark = false;
    for (let k = 1; k <= depth; k++) {
      if (!T.has(idxOf(w, x + dx * k, y + dy * k))) lit = true;
      if (!T.has(idxOf(w, x - dx * k, y - dy * k))) dark = true;
    }
    if (lit && !dark) hi.push(i);
    else if (dark && !lit) sh.push(i);
  }
  hi.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.highlight));
  sh.forEach((i) => setCell(w, i % w.cols, Math.floor(i / w.cols), op.shadow));
}
```

修改 `src/core/ops.ts`：在開頭 import 加上

```ts
import { gradient, outline, shade } from './effects';
```

並把 `runOp` 的最後三個 case 換成：

```ts
    case 'outline': return outline(w, op);
    case 'gradient': return gradient(w, op);
    case 'shade': return shade(w, op);
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test`
Expected: PASS（含 Task 7 測試）

- [ ] **Step 5: Commit**

```bash
git add src/core/effects.ts src/core/ops.ts tests/effects.test.ts
git commit -m "feat(core): outline, gradient and shade effects"
```

---

### Task 9: 配色版本

**Files:**
- Create: `src/core/variants.ts`
- Test: `tests/variants.test.ts`

**Interfaces:**
- Consumes: `allocate`、`OpCtx`、`allowedCodes`、`stockCapacity`、`getVariant`、`cloneDesign`
- Produces:
  - `recolorVariant(d: Design, variantId: string, ctx: OpCtx, opts?: { mode?: PaletteMode; from?: string }): Design`：以 `from`（預設為自己）的顏色為目標，在新的色彩範圍內重新指派
  - `createVariant(d: Design, a: { name: string; paletteMode: PaletteMode; from?: string }, ctx: OpCtx): { design: Design; id: string }`
  - `selectVariant(d: Design, id: string): Design`

- [ ] **Step 1: 寫失敗的測試** `tests/variants.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createVariant, recolorVariant, selectVariant } from '../src/core/variants';
import { getVariant } from '../src/core/model';
import { smallDesign, paint, palette } from './fixtures';

describe('variants', () => {
  it('creates an owned-colors variant mapping to nearest owned color, same shape', () => {
    const d = paint(smallDesign(), [[0, 0, 'A4'], [1, 0, 'H1']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 9 }, H1: { owned: true, count: 9 } } };
    const { design, id } = createVariant(d, { name: '有的色', paletteMode: 'owned' }, ctx);
    expect(id).toBe('v2');
    const v = getVariant(design, id);
    expect(v.cells[0]).toBe('A1');
    expect(v.cells[1]).toBe('H1');
    expect(v.cells.filter(Boolean)).toHaveLength(2);
  });
  it('stock variant respects counts', () => {
    const d = paint(smallDesign(), [[0, 0, 'A1'], [1, 0, 'A1'], [2, 0, 'A1']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 1 }, A2: { owned: true, count: 9 } } };
    const { design, id } = createVariant(d, { name: '庫存版', paletteMode: 'stock' }, ctx);
    const v = getVariant(design, id);
    expect(v.cells.filter((c) => c === 'A1')).toHaveLength(1);
    expect(v.cells.filter((c) => c === 'A2')).toHaveLength(2);
  });
  it('recolorVariant changes mode in place', () => {
    const d = paint(smallDesign(), [[0, 0, 'A4']]);
    const ctx = { palette, inventory: { A1: { owned: true, count: 9 } } };
    const out = recolorVariant(d, 'v1', ctx, { mode: 'owned' });
    expect(getVariant(out, 'v1').paletteMode).toBe('owned');
    expect(getVariant(out, 'v1').cells[0]).toBe('A1');
  });
  it('selectVariant switches the active variant', () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    const ctx = { palette, inventory: {} };
    const { design, id } = createVariant(d, { name: 'x', paletteMode: 'all' }, ctx);
    expect(selectVariant(design, id).activeVariant).toBe('v2');
    expect(() => selectVariant(design, 'v9')).toThrow(/找不到配色版本/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/variants.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/variants.ts`

```ts
import { allocate } from './allocate';
import { cloneDesign, getVariant, type Design } from './model';
import type { OpCtx } from './ops';
import { allowedCodes, stockCapacity, type PaletteMode } from './palette';

export function recolorVariant(d: Design, variantId: string, ctx: OpCtx, opts: { mode?: PaletteMode; from?: string } = {}): Design {
  const next = cloneDesign(d);
  const v = getVariant(next, variantId);
  const src = getVariant(next, opts.from ?? variantId);
  const mode = opts.mode ?? v.paletteMode;
  const allowed = ctx.palette.entries(allowedCodes(ctx.palette, ctx.inventory, mode));
  const targets = src.cells.flatMap((c, i) => (c === null ? [] : [{ index: i, lab: ctx.palette.get(c)!.lab }]));
  const m = allocate(targets, allowed, mode === 'stock' ? stockCapacity(ctx.inventory) : undefined);
  v.cells = src.cells.map((c, i) => (c === null ? null : m.get(i)!));
  v.paletteMode = mode;
  return next;
}

export function createVariant(d: Design, a: { name: string; paletteMode: PaletteMode; from?: string }, ctx: OpCtx): { design: Design; id: string } {
  const next = cloneDesign(d);
  const n = Math.max(0, ...next.variants.map((v) => Number(v.id.slice(1)) || 0)) + 1;
  const id = `v${n}`;
  const from = getVariant(next, a.from);
  next.variants.push({ id, name: a.name, paletteMode: a.paletteMode, cells: [...from.cells] });
  return { design: recolorVariant(next, id, ctx, { mode: a.paletteMode, from: from.id }), id };
}

export function selectVariant(d: Design, id: string): Design {
  getVariant(d, id);
  return { ...cloneDesign(d), activeVariant: id };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/variants.ts tests/variants.test.ts
git commit -m "feat(core): create, recolor and select color variants"
```

---

### Task 10: 檢查器

**Files:**
- Create: `src/core/checks.ts`
- Test: `tests/checks.test.ts`

**Interfaces:**
- Consumes: `Design`、`getVariant`、`countCodes`、`Palette`、`Inventory`、`deltaE00`、`Pt`
- Produces:
  - `type ChecksConfig = { thinChainMin: number; holeMinNeighbors: number; minAdjacentDeltaE: number }`
  - `DEFAULT_CHECKS: ChecksConfig`
  - `type IssueId = 'margin' | 'floating' | 'thin_chain' | 'hole' | 'stock' | 'low_contrast'`
  - `type Issue = { id: IssueId; message: string; cells: Pt[] }`
  - `runChecks(d: Design, variantId: string | undefined, ctx: { palette: Palette; inventory: Inventory; config: ChecksConfig }): Issue[]`
  - `formatIssues(issues: Issue[]): string`（沒有問題時回傳 `✅ 沒有發現問題`）

- [ ] **Step 1: 寫失敗的測試** `tests/checks.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runChecks, DEFAULT_CHECKS, formatIssues } from '../src/core/checks';
import { smallDesign, paint, palette, invAll } from './fixtures';

const ctx = { palette, inventory: invAll, config: DEFAULT_CHECKS };
const ids = (d: any, c = ctx) => runChecks(d, undefined, c).map((i) => i.id);

describe('checks', () => {
  it('clean design has no issues', () => {
    const d = paint(smallDesign(), [[3, 3, 'A1'], [4, 3, 'A1'], [3, 4, 'A1'], [4, 4, 'A1']]);
    expect(runChecks(d, undefined, ctx)).toEqual([]);
    expect(formatIssues([])).toBe('✅ 沒有發現問題');
  });
  it('flags beads in the margin', () => {
    const d = paint(smallDesign(), [[0, 5, 'A1'], [1, 5, 'A1']]);
    const issue = runChecks(d, undefined, ctx).find((i) => i.id === 'margin')!;
    expect(issue.cells).toEqual([[0, 5]]);
  });
  it('flags floating beads', () => {
    expect(ids(paint(smallDesign(), [[5, 5, 'A1']]))).toContain('floating');
  });
  it('flags long thin chains but not short ones', () => {
    const line5: [number, number, string][] = [2, 3, 4, 5, 6].map((x) => [x, 4, 'A1']);
    const line3: [number, number, string][] = [2, 3, 4].map((x) => [x, 4, 'A1']);
    expect(ids(paint(smallDesign(), line5))).toContain('thin_chain');
    expect(ids(paint(smallDesign(), line3))).not.toContain('thin_chain');
  });
  it('flags a weak hanging hole', () => {
    const d = { ...paint(smallDesign(), [[4, 4, 'A1'], [4, 5, 'A1'], [5, 5, 'A1'], [5, 4, 'A1']]), markers: [{ type: 'hole' as const, x: 4, y: 4 }] };
    const issue = runChecks(d, undefined, ctx).find((i) => i.id === 'hole')!;
    expect(issue.message).toMatch(/透明豆/);
  });
  it('flags a hole marker without a bead', () => {
    const d = { ...smallDesign(), markers: [{ type: 'hole' as const, x: 4, y: 4 }] };
    expect(runChecks(d, undefined, ctx).find((i) => i.id === 'hole')!.message).toMatch(/沒有豆子/);
  });
  it('flags stock shortage', () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'A1']]);
    const c = { ...ctx, inventory: { A1: { owned: true, count: 1 } } };
    expect(runChecks(d, undefined, c).find((i) => i.id === 'stock')!.message).toMatch(/A1.*缺 1 顆/);
  });
  it('flags low-contrast neighbours', () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'A4']]);
    expect(runChecks(d, undefined, ctx).find((i) => i.id === 'low_contrast')!.message).toMatch(/A1↔A4/);
    expect(ids(paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'H1']]))).not.toContain('low_contrast');
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/checks.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/checks.ts`

```ts
import { deltaE00 } from './color';
import type { Pt } from './errors';
import { countCodes, getVariant, type Design } from './model';
import type { Inventory, Palette } from './palette';

export type ChecksConfig = { thinChainMin: number; holeMinNeighbors: number; minAdjacentDeltaE: number };
export const DEFAULT_CHECKS: ChecksConfig = { thinChainMin: 4, holeMinNeighbors: 3, minAdjacentDeltaE: 10 };
export type IssueId = 'margin' | 'floating' | 'thin_chain' | 'hole' | 'stock' | 'low_contrast';
export type Issue = { id: IssueId; message: string; cells: Pt[] };

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function runChecks(
  d: Design, variantId: string | undefined,
  ctx: { palette: Palette; inventory: Inventory; config: ChecksConfig },
): Issue[] {
  const v = getVariant(d, variantId);
  const { cols, rows } = d;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < cols && y < rows ? v.cells[y * cols + x] : null);
  const occ = (x: number, y: number) => at(x, y) !== null;
  const deg = (x: number, y: number) => N4.filter(([dx, dy]) => occ(x + dx, y + dy)).length;
  const issues: Issue[] = [];
  const m = d.board.margin;

  const inMargin: Pt[] = [], floating: Pt[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!occ(x, y)) continue;
    if (x < m || y < m || x >= cols - m || y >= rows - m) inMargin.push([x, y]);
    if (deg(x, y) === 0) floating.push([x, y]);
  }
  if (inMargin.length) issues.push({ id: 'margin', message: `${inMargin.length} 顆豆子超出留邊範圍（${m} 格）`, cells: inMargin });
  if (floating.length) issues.push({ id: 'floating', message: `${floating.length} 顆孤立浮豆（四周沒有相連，燙完容易脫落）`, cells: floating });

  const visited = new Set<string>();
  const chains: Pt[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!occ(x, y) || deg(x, y) !== 1 || visited.has(`${x},${y}`)) continue;
    const chain: Pt[] = [[x, y]];
    let prev: Pt | null = null, cur: Pt = [x, y];
    for (;;) {
      const nexts = N4.map(([dx, dy]) => [cur[0] + dx, cur[1] + dy] as Pt)
        .filter(([a, b]) => occ(a, b) && !(prev && a === prev[0] && b === prev[1]));
      if (nexts.length !== 1) break;
      const nx = nexts[0];
      const dn = deg(nx[0], nx[1]);
      if (dn > 2) break;
      chain.push(nx);
      if (dn !== 2) break;
      prev = cur; cur = nx;
    }
    chain.forEach(([a, b]) => visited.add(`${a},${b}`));
    if (chain.length >= ctx.config.thinChainMin) chains.push(...chain);
  }
  if (chains.length) issues.push({ id: 'thin_chain', message: `有單顆寬的細線（≥ ${ctx.config.thinChainMin} 顆），燙完容易斷`, cells: chains });

  for (const mk of d.markers) {
    if (mk.type !== 'hole') continue;
    if (!occ(mk.x, mk.y)) {
      issues.push({ id: 'hole', message: `掛孔 (${mk.x},${mk.y}) 位置沒有豆子`, cells: [[mk.x, mk.y]] });
    } else if (deg(mk.x, mk.y) < ctx.config.holeMinNeighbors) {
      issues.push({ id: 'hole', message: `掛孔 (${mk.x},${mk.y}) 只有 ${deg(mk.x, mk.y)} 個相鄰豆，太靠邊，建議外圍補透明豆`, cells: [[mk.x, mk.y]] });
    }
  }

  for (const [code, n] of Object.entries(countCodes(v.cells))) {
    const have = ctx.inventory[code]?.owned ? ctx.inventory[code].count : 0;
    if (n > have) {
      const cells: Pt[] = [];
      v.cells.forEach((c, i) => { if (c === code) cells.push([i % cols, Math.floor(i / cols)]); });
      issues.push({ id: 'stock', message: have === 0 ? `${code} 沒有庫存，需購買 ${n} 顆` : `${code} 庫存不足：需要 ${n} 顆，缺 ${n - have} 顆`, cells });
    }
  }

  const pairs = new Map<string, { dE: number; cells: Pt[] }>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = at(x, y);
    if (!a) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const b = at(x + dx, y + dy);
      if (!b || b === a) continue;
      const ea = ctx.palette.get(a), eb = ctx.palette.get(b);
      if (!ea || !eb) continue;
      const dE = deltaE00(ea.lab, eb.lab);
      if (dE >= ctx.config.minAdjacentDeltaE) continue;
      const key = [a, b].sort().join('↔');
      const p = pairs.get(key) ?? { dE, cells: [] };
      p.cells.push([x, y], [x + dx, y + dy]);
      pairs.set(key, p);
    }
  }
  if (pairs.size) {
    const list = [...pairs].map(([k, p]) => `${k} ΔE=${p.dE.toFixed(1)}`).join('、');
    issues.push({ id: 'low_contrast', message: `相鄰顏色太接近，邊界看不清：${list}`, cells: [...pairs.values()].flatMap((p) => p.cells) });
  }
  return issues;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return '✅ 沒有發現問題';
  return issues.map((i) => {
    const sample = i.cells.slice(0, 6).map(([x, y]) => `(${x},${y})`).join(' ');
    return `⚠ ${i.message}${sample ? `｜位置 ${sample}${i.cells.length > 6 ? ' …' : ''}` : ''}`;
  }).join('\n');
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/checks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/checks.ts tests/checks.test.ts
git commit -m "feat(core): design checks (margin, floating, thin chains, hole, stock, contrast)"
```

---

### Task 11: 文字格式（RLE）+ describe_design

**Files:**
- Create: `src/core/textCodec.ts`、`src/core/describe.ts`
- Test: `tests/textCodec.test.ts`、`tests/describe.test.ts`

**Interfaces:**
- Consumes: `Design`、`getVariant`、`countCodes`、`bbox`、`Palette`、`deltaE00`
- Produces:
  - `legendFor(cells: (string | null)[]): Map<string, string>`（色號 → 單一字元；依數量排序，字元依序取 `a-z`、`A-Z`、`!#$%&*+=?@^~`）
  - `rle(s: string): string`、`unrle(s: string): string`
  - `encodeDesignText(d: Design, variantId?: string): string`
  - `describeDesign(d: Design, variantId: string | undefined, palette: Palette): string`

- [ ] **Step 1: 寫失敗的測試** `tests/textCodec.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeDesignText, rle, unrle, legendFor } from '../src/core/textCodec';
import { smallDesign, paint } from './fixtures';
import { createDesign } from '../src/core/model';

describe('text codec', () => {
  it('rle round trips', () => {
    expect(rle('aaab..')).toBe('3ab2.');
    expect(unrle('3ab2.')).toBe('aaab..');
    expect(unrle(rle('abcabc'))).toBe('abcabc');
  });
  it('assigns legend chars by frequency', () => {
    const m = legendFor(['H2', 'A1', 'A1', null]);
    expect(m.get('A1')).toBe('a');
    expect(m.get('H2')).toBe('b');
  });
  it('encodes only the bbox with a header', () => {
    const d0 = createDesign({ id: 't', name: 't', board: { widthMm: 30, heightMm: 15, bead: 5, margin: 1 } });
    const d = paint(d0, [[1, 1, 'A1'], [2, 1, 'A1'], [3, 1, 'A1'], [4, 1, 'H2']]);
    expect(encodeDesignText(d)).toBe([
      '6x3 margin=1 bead=5 locked=false variant=v1 理想版(all)',
      'bbox=(1,1)-(4,1)',
      'legend: a=A1 b=H2',
      'y1: 3ab',
    ].join('\n'));
  });
  it('handles empty designs', () => {
    expect(encodeDesignText(smallDesign())).toContain('bbox=none');
  });
});
```

`tests/describe.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { describeDesign } from '../src/core/describe';
import { smallDesign, paint, palette } from './fixtures';

describe('describeDesign', () => {
  it('reports symmetry, color blocks, contrast and a thumbnail', () => {
    const d = paint(smallDesign(), [
      [3, 3, 'H2'], [4, 3, 'H2'], [5, 3, 'H2'], [6, 3, 'H2'],
      [3, 4, 'H2'], [4, 4, 'A1'], [5, 4, 'A1'], [6, 4, 'A4'],
      [3, 5, 'H2'], [4, 5, 'H2'], [5, 5, 'H2'], [6, 5, 'H2'],
    ]);
    const text = describeDesign(d, undefined, palette);
    expect(text).toMatch(/尺寸 10×10 格/);
    expect(text).toMatch(/左右對稱 \d+%/);
    expect(text).toMatch(/H2 黑 9 顆 1 塊/);
    expect(text).toMatch(/A1 紅 2 顆 1 塊/);
    expect(text).toMatch(/A1↔A4/);
    expect(text).toMatch(/縮圖/);
  });
  it('handles an empty design', () => {
    expect(describeDesign(smallDesign(), undefined, palette)).toMatch(/空白/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/textCodec.test.ts tests/describe.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/textCodec.ts`

```ts
import { bbox, countCodes, getVariant, type Design } from './model';

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*+=?@^~';

export function legendFor(cells: (string | null)[]): Map<string, string> {
  const counts = Object.entries(countCodes(cells)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(counts.map(([code], i) => [code, CHARS[i] ?? '?']));
}

export function rle(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? String(j - i) : '') + s[i];
    i = j;
  }
  return out;
}

export function unrle(s: string): string {
  let out = '', num = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    out += ch.repeat(num ? Number(num) : 1);
    num = '';
  }
  return out;
}

export function encodeDesignText(d: Design, variantId?: string): string {
  const v = getVariant(d, variantId);
  const head = `${d.cols}x${d.rows} margin=${d.board.margin} bead=${d.board.bead} locked=${d.shapeLocked} variant=${v.id} ${v.name}(${v.paletteMode})`;
  const holes = d.markers.filter((m) => m.type === 'hole').map((m) => `(${m.x},${m.y})`).join(' ');
  const lines = [head];
  const b = bbox(d, v.cells);
  if (!b) { lines.push('bbox=none'); if (holes) lines.push(`holes: ${holes}`); return lines.join('\n'); }
  lines.push(`bbox=(${b.x0},${b.y0})-(${b.x1},${b.y1})`);
  const legend = legendFor(v.cells);
  lines.push('legend: ' + [...legend].map(([code, ch]) => `${ch}=${code}`).join(' '));
  if (holes) lines.push(`holes: ${holes}`);
  for (let y = b.y0; y <= b.y1; y++) {
    let row = '';
    for (let x = b.x0; x <= b.x1; x++) {
      const c = v.cells[y * d.cols + x];
      row += c === null ? '.' : legend.get(c)!;
    }
    lines.push(`y${y}: ${rle(row)}`);
  }
  return lines.join('\n');
}
```

`src/core/describe.ts`

```ts
import { deltaE00 } from './color';
import { bbox, getVariant, type Design } from './model';
import type { Palette } from './palette';
import { legendFor } from './textCodec';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function describeDesign(d: Design, variantId: string | undefined, palette: Palette): string {
  const v = getVariant(d, variantId);
  const { cols, rows } = d;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < cols && y < rows ? v.cells[y * cols + x] : null);
  const b = bbox(d, v.cells);
  const out: string[] = [];
  out.push(`尺寸 ${cols}×${rows} 格（${d.board.widthMm}×${d.board.heightMm}mm，${d.board.bead}mm 豆），版本 ${v.name}(${v.paletteMode})${d.shapeLocked ? '，形狀已鎖定' : ''}`);
  if (!b) { out.push('畫面空白，還沒有任何豆子'); return out.join('\n'); }
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, m = d.board.margin;
  const marginOk = b.x0 >= m && b.y0 >= m && b.x1 < cols - m && b.y1 < rows - m;
  out.push(`內容範圍 (${b.x0},${b.y0})-(${b.x1},${b.y1})，${bw}×${bh} 格，留邊${marginOk ? ' OK' : ' ⚠ 超出'}`);

  const sym = (axis: 'h' | 'v') => {
    let match = 0, total = 0;
    const bad: string[] = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const mx = axis === 'h' ? b.x0 + b.x1 - x : x, my = axis === 'v' ? b.y0 + b.y1 - y : y;
      total++;
      if (at(x, y) === at(mx, my)) match++;
      else if ((axis === 'h' ? x < mx : y < my) && bad.length < 8) bad.push(`(${x},${y})`);
    }
    return `${Math.round((match / total) * 100)}%${bad.length ? `（不對稱：${bad.join(' ')}）` : ''}`;
  };
  out.push(`左右對稱 ${sym('h')}`);
  out.push(`上下對稱 ${sym('v')}`);

  out.push('色塊：');
  const seen = new Uint8Array(cols * rows);
  const byCode = new Map<string, { n: number; comps: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }>();
  for (let i = 0; i < v.cells.length; i++) {
    const c = v.cells[i];
    if (!c) continue;
    const s = byCode.get(c) ?? { n: 0, comps: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, sx: 0, sy: 0 };
    const x = i % cols, y = Math.floor(i / cols);
    s.n++; s.sx += x; s.sy += y;
    s.x0 = Math.min(s.x0, x); s.y0 = Math.min(s.y0, y); s.x1 = Math.max(s.x1, x); s.y1 = Math.max(s.y1, y);
    if (!seen[i]) {
      s.comps++;
      const stack = [i];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen[k]) continue;
        seen[k] = 1;
        const kx = k % cols, ky = Math.floor(k / cols);
        for (const [dx, dy] of N4) if (at(kx + dx, ky + dy) === c) stack.push((ky + dy) * cols + kx + dx);
      }
    }
    byCode.set(c, s);
  }
  const third = (val: number, lo: number, len: number, words: [string, string, string]) =>
    words[Math.min(2, Math.floor(((val - lo) / Math.max(1, len)) * 3))];
  for (const [code, s] of [...byCode].sort((a, b2) => b2[1].n - a[1].n)) {
    const pos = `${third(s.sy / s.n, b.y0, bh, ['上', '中', '下'])}${third(s.sx / s.n, b.x0, bw, ['左', '中', '右'])}`;
    out.push(`  ${code} ${palette.get(code)?.name ?? ''} ${s.n} 顆 ${s.comps} 塊 範圍(${s.x0},${s.y0})-(${s.x1},${s.y1}) 位置：${pos === '中中' ? '中央' : pos}`);
  }

  const edge = new Map<string, number>();
  let edgeTotal = 0;
  for (let i = 0; i < v.cells.length; i++) {
    const c = v.cells[i];
    if (!c) continue;
    const x = i % cols, y = Math.floor(i / cols);
    if (N4.some(([dx, dy]) => at(x + dx, y + dy) === null)) { edgeTotal++; edge.set(c, (edge.get(c) ?? 0) + 1); }
  }
  const [topEdge, topN] = [...edge].sort((a, b2) => b2[1] - a[1])[0];
  out.push(`外框：邊緣格最常見的是 ${topEdge}，佔 ${Math.round((topN / edgeTotal) * 100)}%${topN === edgeTotal ? '（封閉外框）' : ''}`);

  const low = new Map<string, number>();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const a = at(x, y);
    if (!a) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const c2 = at(x + dx, y + dy);
      if (!c2 || c2 === a) continue;
      const dE = deltaE00(palette.get(a)!.lab, palette.get(c2)!.lab);
      if (dE < 10) low.set([a, c2].sort().join('↔'), dE);
    }
  }
  out.push(`低對比相鄰：${low.size ? [...low].map(([k, dE]) => `${k} ΔE=${dE.toFixed(1)}`).join('、') : '無'}`);

  const legend = legendFor(v.cells);
  out.push(`縮圖（2×2 合 1，${[...legend].map(([c, ch]) => `${ch}=${c}`).join(' ')}）：`);
  for (let y = b.y0; y <= b.y1; y += 2) {
    let line = '  ';
    for (let x = b.x0; x <= b.x1; x += 2) {
      const cnt = new Map<string, number>();
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const c = x + dx <= b.x1 && y + dy <= b.y1 ? at(x + dx, y + dy) : null;
        if (c) cnt.set(c, (cnt.get(c) ?? 0) + 1);
      }
      const total = [...cnt.values()].reduce((s, n) => s + n, 0);
      line += total >= 2 ? legend.get([...cnt].sort((a, b2) => b2[1] - a[1])[0][0]) : '.';
    }
    out.push(line);
  }
  return out.join('\n');
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/textCodec.ts src/core/describe.ts tests/textCodec.test.ts tests/describe.test.ts
git commit -m "feat(core): compact RLE text format and describe_design"
```

---

### Task 12: 圖片轉拼豆

**Files:**
- Create: `src/core/importImage.ts`
- Test: `tests/importImage.test.ts`

**Interfaces:**
- Consumes: `PaletteEntry`、`rgbToLab`、`deltaE00`、`allocate`
- Produces:
  - `type ImportOpts = { cols: number; rows: number; margin: number; allowed: PaletteEntry[]; capacity?: Map<string, number>; removeBg?: boolean; dither?: boolean }`
  - `imageToCells(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, o: ImportOpts): (string | null)[]`（長度 `cols*rows`；有 `capacity` 時忽略 `dither`，改用 `allocate`）

- [ ] **Step 1: 寫失敗的測試** `tests/importImage.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { imageToCells } from '../src/core/importImage';
import { palette } from './fixtures';

function img(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const a = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(px(x, y), (y * w + x) * 4);
  return a;
}
const allowed = palette.entries(['A1', 'H1', 'H2', 'C1']);

describe('imageToCells', () => {
  it('scales into the area inside the margin and matches colors', () => {
    const rgba = img(2, 2, (x) => (x === 0 ? [232, 67, 79, 255] : [255, 255, 255, 255]));
    const cells = imageToCells(rgba, 2, 2, { cols: 4, rows: 4, margin: 1, allowed });
    expect(cells[1 * 4 + 1]).toBe('A1');
    expect(cells[1 * 4 + 2]).toBe('H1');
    expect(cells[0]).toBeNull();
  });
  it('transparent pixels become empty', () => {
    const rgba = img(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [17, 17, 17, 255]));
    const cells = imageToCells(rgba, 2, 1, { cols: 2, rows: 1, margin: 0, allowed });
    expect(cells).toEqual([null, 'H2']);
  });
  it('removes a uniform background', () => {
    const rgba = img(4, 4, (x, y) => (x > 0 && x < 3 && y > 0 && y < 3 ? [46, 126, 196, 255] : [255, 255, 255, 255]));
    const cells = imageToCells(rgba, 4, 4, { cols: 4, rows: 4, margin: 0, allowed, removeBg: true });
    expect(cells.filter(Boolean)).toEqual(['C1', 'C1', 'C1', 'C1']);
  });
  it('respects stock capacity', () => {
    const rgba = img(3, 1, () => [232, 67, 79, 255]);
    const cells = imageToCells(rgba, 3, 1, { cols: 3, rows: 1, margin: 0, allowed, capacity: new Map([['A1', 1], ['H2', 5]]) });
    expect(cells.filter((c) => c === 'A1')).toHaveLength(1);
  });
  it('preserves aspect ratio', () => {
    const rgba = img(4, 2, () => [17, 17, 17, 255]);
    const cells = imageToCells(rgba, 4, 2, { cols: 4, rows: 4, margin: 0, allowed });
    expect(cells.filter(Boolean)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/importImage.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/importImage.ts`

```ts
import { allocate } from './allocate';
import { deltaE00, rgbToLab, type Lab } from './color';
import { OpError } from './errors';
import type { PaletteEntry } from './palette';

export type ImportOpts = {
  cols: number; rows: number; margin: number; allowed: PaletteEntry[];
  capacity?: Map<string, number>; removeBg?: boolean; dither?: boolean;
};

function nearest(lab: Lab, allowed: PaletteEntry[]): PaletteEntry {
  let best = allowed[0], bd = Infinity;
  for (const e of allowed) { const d = deltaE00(lab, e.lab); if (d < bd) { bd = d; best = e; } }
  return best;
}

export function imageToCells(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, o: ImportOpts): (string | null)[] {
  if (o.allowed.length === 0) throw new OpError('no_colors', '沒有可用的顏色（檢查色彩範圍與庫存）');
  const availW = Math.max(1, o.cols - 2 * o.margin), availH = Math.max(1, o.rows - 2 * o.margin);
  const scale = Math.min(availW / w, availH / h);
  const outW = Math.max(1, Math.min(availW, Math.round(w * scale)));
  const outH = Math.max(1, Math.min(availH, Math.round(h * scale)));
  const ox = Math.floor((o.cols - outW) / 2), oy = Math.floor((o.rows - outH) / 2);

  const px = (x: number, y: number) => rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4);
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const bgLab = rgbToLab([0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4) as [number, number, number]);

  const samples: ([number, number, number] | null)[] = [];
  for (let ty = 0; ty < outH; ty++) for (let tx = 0; tx < outW; tx++) {
    const x0 = Math.floor((tx * w) / outW), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / outW));
    const y0 = Math.floor((ty * h) / outH), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / outH));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = px(x, y), al = p[3] / 255;
      r += p[0] * al; g += p[1] * al; b += p[2] * al; a += al; n++;
    }
    if (a / n < 0.5) { samples.push(null); continue; }
    const rgb: [number, number, number] = [r / a, g / a, b / a];
    if (o.removeBg && deltaE00(rgbToLab(rgb), bgLab) < 10) { samples.push(null); continue; }
    samples.push(rgb);
  }

  const local: (string | null)[] = Array(outW * outH).fill(null);
  if (o.capacity) {
    const targets = samples.flatMap((s, i) => (s ? [{ index: i, lab: rgbToLab(s) }] : []));
    allocate(targets, o.allowed, o.capacity).forEach((code, i) => { local[i] = code; });
  } else if (o.dither) {
    const buf = samples.map((s) => (s ? [...s] : null));
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i];
      if (!s) continue;
      const clamped = s.map((c) => Math.max(0, Math.min(255, c))) as [number, number, number];
      const e = nearest(rgbToLab(clamped), o.allowed);
      local[i] = e.code;
      const err = [0, 1, 2].map((k) => clamped[k] - e.rgb[k]);
      const x = i % outW;
      const spread: [number, number][] = [[1, 7 / 16], [outW - 1, 3 / 16], [outW, 5 / 16], [outW + 1, 1 / 16]];
      for (const [off, f] of spread) {
        const j = i + off;
        const jx = j % outW;
        if (j >= buf.length || !buf[j] || Math.abs(jx - x) > 1) continue;
        for (let k = 0; k < 3; k++) buf[j]![k] += err[k] * f;
      }
    }
  } else {
    samples.forEach((s, i) => { if (s) local[i] = nearest(rgbToLab(s), o.allowed).code; });
  }

  const cells: (string | null)[] = Array(o.cols * o.rows).fill(null);
  local.forEach((c, i) => { cells[(oy + Math.floor(i / outW)) * o.cols + ox + (i % outW)] = c; });
  return cells;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/importImage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/importImage.ts tests/importImage.test.ts
git commit -m "feat(core): image to bead grid conversion"
```

---

### Task 13: 渲染（平面、施工圖、3D、燙後）

**Files:**
- Create: `src/core/render/draw.ts`、`src/server/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Design`、`Variant`、`Palette`、`getVariant`、`countCodes`
- Produces:
  - `UI` 色彩常數、`shadeHex(hex, amt)`、`drawBeadFlat(ctx, cx, cy, R, hex)`
  - `type FlatOpts = { cell: number; pegs?: boolean; codes?: boolean; rulers?: boolean; guides?: boolean; margin?: boolean; markers?: boolean }`
  - `flatLayout(d, o): { pad: number; w: number; h: number }`
  - `drawFlat(ctx: CanvasRenderingContext2D, d: Design, v: Variant, p: Palette, o: FlatOpts): void`
  - `type IsoOpts = { size: number; tilt?: number; yaw?: number; board?: boolean; ironed?: boolean; zoom?: number }`
  - `drawIso(ctx, d, v, p, o: IsoOpts): void`
  - `type View = 'flat' | 'pattern' | '3d' | 'ironed'`
  - `renderPng(d: Design, p: Palette, opts: { variant?: string; view?: View; scale?: number }): Promise<Buffer>`（`variant: 'all'` 時所有版本並排）

- [ ] **Step 1: 寫失敗的測試** `tests/render.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { renderPng } from '../src/server/render';
import { flatLayout } from '../src/core/render/draw';
import { createVariant } from '../src/core/variants';
import { smallDesign, paint, palette, ctxAll } from './fixtures';

async function pixel(png: Buffer, x: number, y: number) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { size: [img.width, img.height], rgba: [...ctx.getImageData(x, y, 1, 1).data] };
}

describe('renderPng', () => {
  it('renders a flat view with a red bead where expected', async () => {
    const d = paint(smallDesign(), [[0, 0, 'A1']]);
    const png = await renderPng(d, palette, { view: 'flat' });
    const L = flatLayout(d, { cell: 14, rulers: true });
    // 標題列高 24px；豆子中心偏左上一點點（避開中孔）
    const { rgba } = await pixel(png, L.pad + 4, 24 + L.pad + 4);
    expect(rgba[0]).toBeGreaterThan(rgba[1] + 60);
  });
  it('renders all variants side by side', async () => {
    const d0 = paint(smallDesign(), [[0, 0, 'A1']]);
    const { design } = createVariant(d0, { name: '第二版', paletteMode: 'all' }, ctxAll);
    const one = await pixel(await renderPng(design, palette, { view: 'flat' }), 0, 0);
    const all = await pixel(await renderPng(design, palette, { view: 'flat', variant: 'all' }), 0, 0);
    expect(all.size[0]).toBeGreaterThan(one.size[0] * 2 - 1);
  });
  it('renders pattern, 3d and ironed views without throwing', async () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'H1']]);
    for (const view of ['pattern', '3d', 'ironed'] as const) {
      const png = await renderPng(d, palette, { view });
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/render.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/core/render/draw.ts`（移植自已確認的 mockup：B 霧面豆、A 奶油 UI）

```ts
import type { Design, Variant } from '../model';
import type { Palette } from '../palette';

type C2D = CanvasRenderingContext2D;

export const UI = {
  bg: '#FBF6EE', board: '#EFE3D0', boardEdge: '#D9C6A8', peg: '#E2D2BA',
  ruler: '#9C8670', guide: 'rgba(156,134,112,0.3)', margin: '#E8A87C', hole: '#D0574B', text: '#5B4636',
};

export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const f = amt < 0 ? 0 : 255, t = Math.abs(amt);
  const [r, g, b] = ch.map((c) => Math.round(c + (f - c) * t));
  return `rgb(${r},${g},${b})`;
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

export function drawBeadFlat(ctx: C2D, cx: number, cy: number, R: number, hex: string): void {
  const g = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.2, cx, cy, R);
  g.addColorStop(0, shadeHex(hex, 0.12));
  g.addColorStop(1, shadeHex(hex, -0.14));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shadeHex(hex, -0.35);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.36, 0, Math.PI * 2); ctx.fill();
}

export type FlatOpts = { cell: number; pegs?: boolean; codes?: boolean; rulers?: boolean; guides?: boolean; margin?: boolean; markers?: boolean };

export function flatLayout(d: Design, o: FlatOpts) {
  const pad = o.rulers ? 18 : 6;
  return { pad, w: d.cols * o.cell + pad * 2, h: d.rows * o.cell + pad * 2 };
}

export function drawFlat(ctx: C2D, d: Design, v: Variant, p: Palette, o: FlatOpts): void {
  const { pad, w, h } = flatLayout(d, o);
  const cs = o.cell;
  ctx.fillStyle = UI.bg; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (o.rulers) {
    ctx.fillStyle = UI.ruler; ctx.font = `${Math.max(8, Math.round(Math.min(cs, 18) * 0.6))}px sans-serif`;
    for (let i = 0; i < d.cols; i += 5) ctx.fillText(String(i + 1), pad + i * cs + cs / 2, pad / 2);
    for (let j = 0; j < d.rows; j += 5) ctx.fillText(String(j + 1), pad / 2, pad + j * cs + cs / 2);
  }
  ctx.fillStyle = UI.board; ctx.fillRect(pad, pad, d.cols * cs, d.rows * cs);
  for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) {
    const cx = pad + i * cs + cs / 2, cy = pad + j * cs + cs / 2;
    const code = v.cells[j * d.cols + i];
    if (!code) {
      if (o.pegs !== false) { ctx.fillStyle = UI.peg; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, cs * 0.1), 0, Math.PI * 2); ctx.fill(); }
      continue;
    }
    const hex = p.get(code)?.displayHex ?? '#FF00FF';
    drawBeadFlat(ctx, cx, cy, cs * 0.47, hex);
    if (o.codes) {
      ctx.fillStyle = luminance(hex) > 0.55 ? '#3A2E25' : '#FFFFFF';
      ctx.font = `bold ${Math.round(cs * 0.34)}px sans-serif`;
      ctx.fillText(code, cx, cy);
    }
  }
  if (o.guides) {
    ctx.strokeStyle = UI.guide; ctx.lineWidth = 1;
    for (let k = 5; k < d.cols; k += 5) { ctx.beginPath(); ctx.moveTo(pad + k * cs, pad); ctx.lineTo(pad + k * cs, pad + d.rows * cs); ctx.stroke(); }
    for (let k = 5; k < d.rows; k += 5) { ctx.beginPath(); ctx.moveTo(pad, pad + k * cs); ctx.lineTo(pad + d.cols * cs, pad + k * cs); ctx.stroke(); }
  }
  const m = d.board.margin;
  if (o.margin && m > 0) {
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = UI.margin; ctx.lineWidth = 1.5;
    ctx.strokeRect(pad + m * cs, pad + m * cs, (d.cols - 2 * m) * cs, (d.rows - 2 * m) * cs);
    ctx.restore();
  }
  if (o.markers) {
    ctx.strokeStyle = UI.hole; ctx.lineWidth = 2;
    for (const mk of d.markers) {
      ctx.beginPath(); ctx.arc(pad + mk.x * cs + cs / 2, pad + mk.y * cs + cs / 2, cs * 0.42, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

export type IsoOpts = { size: number; tilt?: number; yaw?: number; board?: boolean; ironed?: boolean; zoom?: number };

export function drawIso(ctx: C2D, d: Design, v: Variant, p: Palette, o: IsoOpts): void {
  const S = o.size, tilt = ((o.tilt ?? 40) * Math.PI) / 180, yaw = ((o.yaw ?? 20) * Math.PI) / 180;
  const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ironed = !!o.ironed, showBoard = o.board !== false;
  const BH = ironed ? 0.55 : 0.85, R = 0.47, HOLE = 0.17;
  const raw = (u: number, w: number, z: number) => { const rx = u * cy - w * sy, ry = u * sy + w * cy; return [rx, ry * ct - z * st, ry]; };
  const s = ((S - 10) / (Math.max(d.cols, d.rows) * 1.45)) * (o.zoom ?? 1);
  const P2 = (u: number, w: number, z: number) => { const r = raw(u, w, z); return [S / 2 + r[0] * s, S / 2 + r[1] * s, r[2]]; };
  ctx.fillStyle = UI.bg; ctx.fillRect(0, 0, S, S);
  const hw = d.cols / 2, hh = d.rows / 2;
  const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const poly = (pts: number[][]) => { ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); };
  if (showBoard) {
    ctx.fillStyle = UI.boardEdge;
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      poly([P2(a[0], a[1], 0), P2(b[0], b[1], 0), P2(b[0], b[1], -0.35), P2(a[0], a[1], -0.35)]);
    }
    ctx.fillStyle = UI.board; poly(corners.map(([u, w]) => P2(u, w, 0)));
  }
  const items: { u: number; w: number; c: string | null; dep: number }[] = [];
  for (let j = 0; j < d.rows; j++) for (let i = 0; i < d.cols; i++) {
    const u = i - hw + 0.5, w = j - hh + 0.5;
    items.push({ u, w, c: v.cells[j * d.cols + i], dep: raw(u, w, 0)[2] });
  }
  items.sort((a, b) => a.dep - b.dep);
  const ex = R * s, ey = R * s * ct, hx = HOLE * s;
  const rsq: [number, number][] = [];
  { const a = 0.5, r = 0.22, seg = 5;
    const cs: [number, number, number][] = [[a - r, a - r, 0], [-(a - r), a - r, Math.PI / 2], [-(a - r), -(a - r), Math.PI], [a - r, -(a - r), Math.PI * 1.5]];
    for (const [cx0, cy0, st0] of cs) for (let k = 0; k <= seg; k++) { const an = st0 + (k / seg) * (Math.PI / 2); rsq.push([cx0 + r * Math.cos(an), cy0 + r * Math.sin(an)]); } }
  for (const it of items) {
    const [bx, by] = P2(it.u, it.w, 0);
    if (!it.c) {
      if (showBoard) { ctx.fillStyle = UI.peg; ctx.beginPath(); ctx.ellipse(bx, by, 0.09 * s, 0.09 * s * ct, 0, 0, Math.PI * 2); ctx.fill(); }
      continue;
    }
    const base = p.get(it.c)?.displayHex ?? '#FF00FF';
    const [tx, ty] = P2(it.u, it.w, BH);
    if (ironed) {
      for (let z = 0; z < BH; z += 0.1) {
        ctx.fillStyle = shadeHex(base, -0.3 + z * 0.3);
        poly(rsq.map(([du, dw]) => P2(it.u + du, it.w + dw, z)));
      }
      ctx.fillStyle = shadeHex(base, 0.04); poly(rsq.map(([du, dw]) => P2(it.u + du, it.w + dw, BH)));
      ctx.fillStyle = shadeHex(base, -0.45); ctx.beginPath(); ctx.ellipse(tx, ty, hx * 0.55, hx * 0.55 * ct, 0, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    if (st > 0.01) {
      const g = ctx.createLinearGradient(bx - ex, 0, bx + ex, 0);
      g.addColorStop(0, shadeHex(base, -0.3)); g.addColorStop(0.45, shadeHex(base, -0.08)); g.addColorStop(1, shadeHex(base, -0.35));
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(bx - ex, ty); ctx.lineTo(bx - ex, by); ctx.ellipse(bx, by, ex, ey, 0, Math.PI, 0, true); ctx.lineTo(bx + ex, ty); ctx.closePath(); ctx.fill();
    }
    const tg = ctx.createRadialGradient(tx - ex * 0.2, ty - ey * 0.2, ex * 0.2, tx, ty, ex);
    tg.addColorStop(0, shadeHex(base, 0.12)); tg.addColorStop(1, shadeHex(base, -0.08));
    ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(tx, ty, ex, ey, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shadeHex(base, -0.4); ctx.beginPath(); ctx.ellipse(tx, ty, hx, hx * ct, 0, 0, Math.PI * 2); ctx.fill();
  }
}
```

`src/server/render.ts`

```ts
import { createCanvas } from '@napi-rs/canvas';
import { countCodes, getVariant, type Design, type Variant } from '../core/model';
import type { Palette } from '../core/palette';
import { drawBeadFlat, drawFlat, drawIso, flatLayout, UI, type FlatOpts } from '../core/render/draw';

export type View = 'flat' | 'pattern' | '3d' | 'ironed';
type C2D = CanvasRenderingContext2D;

function panel(d: Design, v: Variant, p: Palette, view: View, scale: number) {
  if (view === '3d' || view === 'ironed') {
    const size = Math.round(360 * scale);
    return { w: size, h: size, draw: (c: C2D) => drawIso(c, d, v, p, { size, ironed: view === 'ironed' }) };
  }
  const o: FlatOpts = { cell: Math.round((view === 'pattern' ? 26 : 14) * scale), rulers: true, guides: true, margin: true, markers: true, codes: view === 'pattern' };
  const L = flatLayout(d, o);
  if (view === 'flat') return { w: L.w, h: L.h, draw: (c: C2D) => drawFlat(c, d, v, p, o) };
  const counts = Object.entries(countCodes(v.cells)).sort((a, b) => b[1] - a[1]);
  const colW = 150, perRow = Math.max(1, Math.floor(L.w / colW));
  const tableH = Math.ceil(counts.length / perRow) * 22 + 12;
  return {
    w: L.w, h: L.h + tableH,
    draw: (c: C2D) => {
      drawFlat(c, d, v, p, o);
      c.fillStyle = UI.bg; c.fillRect(0, L.h, L.w, tableH);
      c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '13px sans-serif';
      counts.forEach(([code, n], k) => {
        const x = 10 + (k % perRow) * colW, y = L.h + 16 + Math.floor(k / perRow) * 22;
        drawBeadFlat(c, x + 7, y, 7, p.get(code)?.displayHex ?? '#FF00FF');
        c.fillStyle = UI.text; c.fillText(`${code} ${p.get(code)?.name ?? ''} ×${n}`, x + 20, y);
      });
    },
  };
}

export async function renderPng(d: Design, p: Palette, opts: { variant?: string; view?: View; scale?: number }): Promise<Buffer> {
  const view = opts.view ?? 'flat', scale = opts.scale ?? 1;
  const vs = opts.variant === 'all' ? d.variants : [getVariant(d, opts.variant)];
  const panels = vs.map((v) => ({ v, ...panel(d, v, p, view, scale) }));
  const title = 24, gap = 16;
  const W = panels.reduce((s, q) => s + q.w, 0) + gap * (panels.length - 1);
  const H = Math.max(...panels.map((q) => q.h)) + title;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as C2D;
  ctx.fillStyle = UI.bg; ctx.fillRect(0, 0, W, H);
  let x = 0;
  for (const q of panels) {
    ctx.save();
    ctx.fillStyle = UI.text; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${q.v.name}（${q.v.paletteMode}）`, x + 6, title / 2);
    ctx.translate(x, title);
    q.draw(ctx);
    ctx.restore();
    x += q.w + gap;
  }
  return canvas.encode('png');
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/render.test.ts`
Expected: PASS

- [ ] **Step 5: 目視檢查**

```bash
mkdir -p /tmp/bead-render && pnpm tsx -e "
import { writeFileSync } from 'node:fs';
import { renderPng } from './src/server/render';
import { applyOps } from './src/core/ops';
import { smallDesign, ctxAll, palette } from './tests/fixtures';
const { design } = applyOps(smallDesign(), [{ op:'ellipse', x:2, y:2, w:6, h:6, color:'A1' }, { op:'outline', target:'shape', color:'H2', side:'outer' }], ctxAll);
for (const view of ['flat','pattern','3d','ironed'] as const) writeFileSync('/tmp/bead-render/'+view+'.png', await renderPng(design, palette, { view }));
"
```

用 Read 工具打開 4 張 PNG 檢查：霧面豆有中孔、施工圖有色號與用量表、3D 有圓柱側面、燙後豆子相連成圓角方塊。CJK 文字若顯示成方框，在 `src/server/render.ts` 開頭加上 `import { GlobalFonts } from '@napi-rs/canvas'` 與 `GlobalFonts.loadSystemFonts?.()`，再重跑一次。

- [ ] **Step 6: Commit**

```bash
git add src/core/render src/server/render.ts tests/render.test.ts
git commit -m "feat(render): flat, pattern, 3D and ironed bead rendering"
```

---

### Task 14: PNG metadata

**Files:**
- Create: `src/types/png-chunks.d.ts`、`src/server/pngmeta.ts`
- Test: `tests/pngmeta.test.ts`

**Interfaces:**
- Consumes: `Design`、`renderPng`
- Produces:
  - `embedDesign(png: Buffer, d: Design): Buffer`
  - `extractDesign(png: Buffer): Design | null`（不是 PNG、沒有 chunk、內容損毀、結構不對時都回傳 `null`）

- [ ] **Step 1: 寫失敗的測試** `tests/pngmeta.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import { embedDesign, extractDesign } from '../src/server/pngmeta';
import { renderPng } from '../src/server/render';
import { smallDesign, paint, palette } from './fixtures';

describe('png metadata', () => {
  it('round trips a design', async () => {
    const d = paint(smallDesign(), [[1, 1, 'A1']]);
    const png = embedDesign(await renderPng(d, palette, {}), d);
    expect(extractDesign(png)).toEqual(d);
  });
  it('replaces an existing bead-studio chunk instead of duplicating', async () => {
    const d = smallDesign();
    const once = embedDesign(await renderPng(d, palette, {}), d);
    const twice = embedDesign(once, { ...d, name: '新名字' });
    expect(extract(twice).filter((c: any) => c.name === 'zTXt')).toHaveLength(1);
    expect(extractDesign(twice)!.name).toBe('新名字');
  });
  it('returns null for a plain PNG and for non-PNG data', async () => {
    expect(extractDesign(await renderPng(smallDesign(), palette, {}))).toBeNull();
    expect(extractDesign(Buffer.from('hello'))).toBeNull();
  });
  it('returns null for corrupted zTXt', async () => {
    const chunks = extract(await renderPng(smallDesign(), palette, {}));
    const bad = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), Buffer.from('not zlib')]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: bad });
    expect(extractDesign(Buffer.from(encode(chunks)))).toBeNull();
  });
  it('returns null when JSON is not a design', async () => {
    const chunks = extract(await renderPng(smallDesign(), palette, {}));
    const body = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from('{"a":1}'))]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
    expect(extractDesign(Buffer.from(encode(chunks)))).toBeNull();
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/pngmeta.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/types/png-chunks.d.ts`

```ts
declare module 'png-chunks-extract' {
  const extract: (data: Uint8Array) => { name: string; data: Uint8Array }[];
  export default extract;
}
declare module 'png-chunks-encode' {
  const encode: (chunks: { name: string; data: Uint8Array }[]) => Uint8Array;
  export default encode;
}
```

`src/server/pngmeta.ts`

```ts
import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import type { Design } from '../core/model';

const KEY = 'bead-studio';

const keywordOf = (data: Uint8Array) => Buffer.from(data.subarray(0, data.indexOf(0))).toString('latin1');

export function embedDesign(png: Buffer, d: Design): Buffer {
  const chunks = extract(png).filter((c) => !(c.name === 'zTXt' && keywordOf(c.data) === KEY));
  const body = Buffer.concat([
    Buffer.from(KEY, 'latin1'), Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(JSON.stringify(d), 'utf8')),
  ]);
  chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
  return Buffer.from(encode(chunks));
}

function isDesign(x: any): x is Design {
  return x && typeof x.cols === 'number' && typeof x.rows === 'number' && typeof x.mask === 'string'
    && x.mask.length === x.cols * x.rows && Array.isArray(x.variants) && x.variants.length > 0
    && x.variants.every((v: any) => Array.isArray(v.cells) && v.cells.length === x.cols * x.rows);
}

export function extractDesign(png: Buffer): Design | null {
  try {
    for (const c of extract(png)) {
      if (c.name !== 'zTXt' || keywordOf(c.data) !== KEY) continue;
      const start = c.data.indexOf(0) + 2;
      const d = JSON.parse(zlib.inflateSync(c.data.subarray(start)).toString('utf8'));
      return isDesign(d) ? d : null;
    }
  } catch {
    return null;
  }
  return null;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/pngmeta.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types src/server/pngmeta.ts tests/pngmeta.test.ts
git commit -m "feat(server): embed and extract design metadata in PNG zTXt"
```

---

### Task 15: DesignStore（檔案、目前作品、undo、快照、庫存）

**Files:**
- Create: `src/server/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `Design`、`DesignCore`、`createDesign`、`coreOf`、`Palette`、`Inventory`、`ChecksConfig`、`DEFAULT_CHECKS`、`OpError`、`validatePalette`
- Produces:
  - `type StoreOpts = { dataDir: string; configDir: string; historyLimit?: number }`
  - `class DesignStore extends EventEmitter`：
    - `palette: Palette`、`inventory: Inventory`、`checks: ChecksConfig`、`currentId: string | null`
    - `load(): void`
    - `ctx(): { palette: Palette; inventory: Inventory }`
    - `list(): { id: string; name: string; version: number; current: boolean }[]`
    - `get(id?: string): Design`（找不到時拋出 `OpError('no_design')`）
    - `open(id: string): Design`
    - `create(name: string, board: Board): Design`
    - `importDesign(d: Design): Design`（給新 id，設為目前作品）
    - `update(id: string | undefined, fn: (d: Design) => Design): Design`（推 undo、`version+1`、存檔、emit `'change'`）
    - `undo(id?: string): Design`、`redo(id?: string): Design`
    - `snapshot(id: string | undefined, name: string): Snapshot`、`restoreSnapshot(id: string | undefined, snapId: string): Design`
    - `setInventory(items: { code: string; owned?: boolean; count?: number }[]): Inventory`
  - 事件：`'change'`（參數 `Design`）

- [ ] **Step 1: 寫失敗的測試** `tests/store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignStore } from '../src/server/store';
import { applyOps } from '../src/core/ops';
import { FIX_COLORS } from './fixtures';

let dir: string;
const board = { widthMm: 50, heightMm: 50, bead: 5 as const, margin: 1 };

function mkStore() {
  const s = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  s.load();
  return s;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beads-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  writeFileSync(join(dir, 'config/checks.json'), JSON.stringify({ thinChainMin: 5, holeMinNeighbors: 3, minAdjacentDeltaE: 10 }));
});

describe('DesignStore', () => {
  it('loads palette and checks config; inventory defaults to empty', () => {
    const s = mkStore();
    expect(s.palette.has('A1')).toBe(true);
    expect(s.checks.thinChainMin).toBe(5);
    expect(s.inventory).toEqual({});
  });
  it('creates, persists and reloads designs including current id', () => {
    const s = mkStore();
    const d = s.create('蘑菇', board);
    expect(s.currentId).toBe(d.id);
    expect(existsSync(join(dir, 'data/designs', `${d.id}.json`))).toBe(true);
    const s2 = mkStore();
    expect(s2.list()).toEqual([{ id: d.id, name: '蘑菇', version: 0, current: true }]);
  });
  it('update bumps version, emits change and supports undo/redo', () => {
    const s = mkStore();
    s.create('x', board);
    let changes = 0;
    s.on('change', () => changes++);
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], s.ctx()).design);
    expect(s.get().version).toBe(1);
    expect(s.get().mask[0]).toBe('1');
    s.undo();
    expect(s.get().mask[0]).toBe('0');
    s.redo();
    expect(s.get().mask[0]).toBe('1');
    expect(changes).toBe(3);
  });
  it('undo with empty history throws a friendly error', () => {
    const s = mkStore();
    s.create('x', board);
    expect(() => s.undo()).toThrow(/沒有可以復原/);
  });
  it('snapshots survive reload and can be restored', () => {
    const s = mkStore();
    s.create('x', board);
    const snap = s.snapshot(undefined, '大改前');
    s.update(undefined, (d) => applyOps(d, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], s.ctx()).design);
    const s2 = mkStore();
    s2.restoreSnapshot(undefined, snap.id);
    expect(s2.get().mask[0]).toBe('0');
    expect(s2.get().snapshots).toHaveLength(1);
  });
  it('setInventory merges and persists', () => {
    const s = mkStore();
    s.setInventory([{ code: 'A1', owned: true, count: 100 }]);
    s.setInventory([{ code: 'A1', count: 80 }, { code: 'H1', owned: true }]);
    expect(JSON.parse(readFileSync(join(dir, 'data/inventory.json'), 'utf8'))).toEqual({
      A1: { owned: true, count: 80 }, H1: { owned: true, count: 0 },
    });
  });
  it('rejects unknown colors in setInventory', () => {
    expect(() => mkStore().setInventory([{ code: 'ZZ1', owned: true }])).toThrow(/未知色號 ZZ1/);
  });
  it('get without a current design throws', () => {
    expect(() => mkStore().get()).toThrow(/沒有開啟中的作品/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/store.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/server/store.ts`

```ts
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CHECKS, type ChecksConfig } from '../core/checks';
import { OpError } from '../core/errors';
import { coreOf, createDesign, type Board, type Design, type DesignCore, type Snapshot } from '../core/model';
import { Palette, validatePalette, type Inventory, type PaletteColor } from '../core/palette';

export type StoreOpts = { dataDir: string; configDir: string; historyLimit?: number };

function writeJsonAtomic(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class DesignStore extends EventEmitter {
  palette!: Palette;
  inventory: Inventory = {};
  checks: ChecksConfig = DEFAULT_CHECKS;
  currentId: string | null = null;
  private designs = new Map<string, Design>();
  private history = new Map<string, { undo: DesignCore[]; redo: DesignCore[] }>();

  constructor(private opts: StoreOpts) { super(); }

  private get designDir() { return join(this.opts.dataDir, 'designs'); }
  private get statePath() { return join(this.opts.dataDir, 'state.json'); }

  load(): void {
    mkdirSync(this.designDir, { recursive: true });
    const colors: PaletteColor[] = JSON.parse(readFileSync(join(this.opts.dataDir, 'palette.json'), 'utf8'));
    const errs = validatePalette(colors);
    if (errs.length) throw new Error(`palette.json 有誤：\n${errs.join('\n')}`);
    this.palette = new Palette(colors);
    const invPath = join(this.opts.dataDir, 'inventory.json');
    this.inventory = existsSync(invPath) ? JSON.parse(readFileSync(invPath, 'utf8')) : {};
    const chkPath = join(this.opts.configDir, 'checks.json');
    this.checks = existsSync(chkPath) ? { ...DEFAULT_CHECKS, ...JSON.parse(readFileSync(chkPath, 'utf8')) } : DEFAULT_CHECKS;
    this.designs.clear();
    for (const f of readdirSync(this.designDir)) {
      if (!f.endsWith('.json')) continue;
      const d: Design = JSON.parse(readFileSync(join(this.designDir, f), 'utf8'));
      this.designs.set(d.id, d);
    }
    const state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : {};
    this.currentId = state.currentId && this.designs.has(state.currentId) ? state.currentId : null;
  }

  ctx() { return { palette: this.palette, inventory: this.inventory }; }

  list() {
    return [...this.designs.values()].map((d) => ({ id: d.id, name: d.name, version: d.version, current: d.id === this.currentId }));
  }

  get(id?: string): Design {
    const want = id ?? this.currentId;
    if (!want) throw new OpError('no_design', '沒有開啟中的作品，請先 new_design 或 open_design');
    const d = this.designs.get(want);
    if (!d) throw new OpError('no_design', `找不到作品 ${want}`);
    return d;
  }

  private save(d: Design) {
    this.designs.set(d.id, d);
    writeJsonAtomic(join(this.designDir, `${d.id}.json`), d);
  }

  private setCurrent(id: string) {
    this.currentId = id;
    writeJsonAtomic(this.statePath, { currentId: id });
  }

  open(id: string): Design {
    const d = this.get(id);
    this.setCurrent(id);
    this.emit('change', d);
    return d;
  }

  create(name: string, board: Board): Design {
    const d = createDesign({ id: newId('d'), name, board });
    this.save(d);
    this.setCurrent(d.id);
    this.emit('change', d);
    return d;
  }

  importDesign(src: Design): Design {
    const d: Design = { ...structuredClone(src), id: newId('d'), version: 0 };
    this.save(d);
    this.setCurrent(d.id);
    this.emit('change', d);
    return d;
  }

  private hist(id: string) {
    let h = this.history.get(id);
    if (!h) { h = { undo: [], redo: [] }; this.history.set(id, h); }
    return h;
  }

  private commit(prev: Design, next: Design): Design {
    const d: Design = { ...next, id: prev.id, version: prev.version + 1 };
    this.save(d);
    this.emit('change', d);
    return d;
  }

  update(id: string | undefined, fn: (d: Design) => Design): Design {
    const prev = this.get(id);
    const next = fn(prev);
    const h = this.hist(prev.id);
    h.undo.push(coreOf(prev));
    if (h.undo.length > (this.opts.historyLimit ?? 200)) h.undo.shift();
    h.redo = [];
    return this.commit(prev, next);
  }

  undo(id?: string): Design {
    const cur = this.get(id);
    const h = this.hist(cur.id);
    const core = h.undo.pop();
    if (!core) throw new OpError('no_history', '沒有可以復原的步驟');
    h.redo.push(coreOf(cur));
    return this.commit(cur, { ...core, snapshots: cur.snapshots });
  }

  redo(id?: string): Design {
    const cur = this.get(id);
    const h = this.hist(cur.id);
    const core = h.redo.pop();
    if (!core) throw new OpError('no_history', '沒有可以重做的步驟');
    h.undo.push(coreOf(cur));
    return this.commit(cur, { ...core, snapshots: cur.snapshots });
  }

  snapshot(id: string | undefined, name: string): Snapshot {
    const cur = this.get(id);
    const snap: Snapshot = { id: newId('s'), name, at: new Date().toISOString(), design: coreOf(cur) };
    this.save({ ...cur, snapshots: [...cur.snapshots, snap] });
    return snap;
  }

  restoreSnapshot(id: string | undefined, snapId: string): Design {
    const cur = this.get(id);
    const snap = cur.snapshots.find((s) => s.id === snapId);
    if (!snap) throw new OpError('no_snapshot', `找不到快照 ${snapId}`);
    return this.update(cur.id, (d) => ({ ...structuredClone(snap.design), snapshots: d.snapshots }));
  }

  setInventory(items: { code: string; owned?: boolean; count?: number }[]): Inventory {
    for (const it of items) if (!this.palette.has(it.code)) throw new OpError('unknown_color', `未知色號 ${it.code}`);
    const inv = structuredClone(this.inventory);
    for (const it of items) {
      const prev = inv[it.code] ?? { owned: false, count: 0 };
      inv[it.code] = { owned: it.owned ?? prev.owned, count: it.count ?? prev.count };
    }
    this.inventory = inv;
    writeJsonAtomic(join(this.opts.dataDir, 'inventory.json'), inv);
    return inv;
  }
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts tests/store.test.ts
git commit -m "feat(server): design store with persistence, undo/redo, snapshots and inventory"
```

---

### Task 16: MCP 工具

**Files:**
- Create: `src/server/mcp.ts`
- Test: `tests/mcp.test.ts`

**Interfaces:**
- Consumes: `DesignStore`（Task 15）、`applyOps`、`setBoard`、`createVariant`、`recolorVariant`、`selectVariant`、`runChecks`、`formatIssues`、`encodeDesignText`、`describeDesign`、`imageToCells`、`renderPng`、`embedDesign`、`extractDesign`、`OpSchema`、`allowedCodes`、`stockCapacity`、`getVariant`、`maskFromCells`
- Produces:
  - `type Vision = 'auto' | 'on' | 'off'`
  - `buildMcpServer(store: DesignStore, opts?: { vision?: Vision }): McpServer`
  - 工具：`list_designs`、`open_design`、`new_design`、`get_design`、`describe_design`、`render_preview`、`get_palette`、`run_checks`、`apply_ops`、`set_board`、`create_variant`、`set_variant_mode`、`select_variant`、`set_shape_lock`、`import_image`、`export_png`、`set_inventory`、`snapshot`、`restore_snapshot`、`undo`、`redo`

- [ ] **Step 1: 寫失敗的測試** `tests/mcp.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCanvas } from '@napi-rs/canvas';
import { DesignStore } from '../src/server/store';
import { buildMcpServer, type Vision } from '../src/server/mcp';
import { extractDesign } from '../src/server/pngmeta';
import { FIX_COLORS } from './fixtures';

let dir: string;
let store: DesignStore;

async function connect(vision: Vision = 'on') {
  const server = buildMcpServer(store, { vision });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as any;
  const text = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    return { ok: !r.isError, text: r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'), raw: r };
  };
  return { client, call, text };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beads-mcp-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
});

const NEW = { name: '測試', widthMm: 50, heightMm: 50, bead: 5, margin: 1 };

describe('MCP tools', () => {
  it('lists all tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apply_ops', 'create_variant', 'describe_design', 'export_png', 'get_design', 'get_palette',
      'import_image', 'list_designs', 'new_design', 'open_design', 'redo', 'render_preview',
      'restore_snapshot', 'run_checks', 'select_variant', 'set_board', 'set_inventory',
      'set_shape_lock', 'set_variant_mode', 'snapshot', 'undo',
    ]);
  });

  it('new_design → apply_ops → get_design round trip with summary and checks', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 1, color: 'A1' }] });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/共 2 顆/);
    expect(r.text).toMatch(/A1 \+2/);
    expect(r.text).toMatch(/超出留邊/);
    const g = await text('get_design');
    expect(g.text).toMatch(/legend: a=A1/);
    expect(g.text).toMatch(/y0: 2a/);
  });

  it('apply_ops errors are reported, not thrown, and leave the design unchanged', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }, { op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'NOPE' }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/unknown_color/);
    expect(store.get().version).toBe(0);
  });

  it('render_preview returns an image when vision is on, text when off', async () => {
    const on = await connect('on');
    await on.text('new_design', NEW);
    const img = await on.call('render_preview', { view: '3d' });
    expect(img.content[0].type).toBe('image');
    expect(img.content[0].mimeType).toBe('image/png');
    const off = await connect('off');
    const t = await off.text('render_preview');
    expect(t.text).toMatch(/畫面空白/);
  });

  it('variants, shape lock and palette modes', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('set_inventory', { items: [{ code: 'A1', owned: true, count: 1 }, { code: 'A2', owned: true, count: 10 }] });
    await text('apply_ops', { ops: [{ op: 'rect', x: 3, y: 3, w: 3, h: 1, color: 'A4' }] });
    const cv = await text('create_variant', { name: '庫存版', paletteMode: 'stock' });
    expect(cv.text).toMatch(/v2/);
    const counts = store.get().variants[1].cells.filter(Boolean);
    expect(counts.filter((c) => c === 'A1')).toHaveLength(1);
    await text('set_shape_lock', { locked: true });
    const r = await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }] });
    expect(r.text).toMatch(/shape_locked/);
    const sel = await text('select_variant', { variant: 'v2' });
    expect(sel.ok).toBe(true);
    expect(store.get().activeVariant).toBe('v2');
    const mode = await text('set_variant_mode', { variant: 'v2', paletteMode: 'owned' });
    expect(mode.ok).toBe(true);
  });

  it('get_palette lists colors with stock for the given mode', async () => {
    const { text } = await connect();
    await text('set_inventory', { items: [{ code: 'A1', owned: true, count: 200 }] });
    const r = await text('get_palette', { mode: 'owned' });
    expect(r.text.trim()).toBe('A1 紅 #E8434F 庫存200');
  });

  it('set_board refuses to crop without force', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }] });
    const r = await text('set_board', { widthMm: 40, heightMm: 40 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/would_crop/);
    const ok = await text('set_board', { widthMm: 40, heightMm: 40, force: true });
    expect(ok.ok).toBe(true);
    expect(store.get().cols).toBe(8);
  });

  it('export_png embeds metadata; import_image restores it as a new design', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 2, h: 2, color: 'C1' }] });
    const out = join(dir, 'out.png');
    await text('export_png', { path: out, view: 'pattern' });
    expect(extractDesign(readFileSync(out))!.mask).toBe(store.get().mask);
    const before = store.list().length;
    const r = await text('import_image', { path: out });
    expect(r.text).toMatch(/還原/);
    expect(store.list().length).toBe(before + 1);
  });

  it('import_image falls back to image conversion for a plain PNG', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const c = createCanvas(4, 4);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2E7EC4'; ctx.fillRect(0, 0, 4, 4);
    const p = join(dir, 'plain.png');
    writeFileSync(p, await c.encode('png'));
    const r = await text('import_image', { path: p });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/轉換/);
    expect(store.get().variants[0].cells.filter((x) => x === 'C1').length).toBe(64);
  });

  it('undo, redo, snapshot and restore', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    const s = await text('snapshot', { name: '空白' });
    const snapId = s.text.match(/s-[a-z0-9]+/)![0];
    await text('apply_ops', { ops: [{ op: 'rect', x: 2, y: 2, w: 1, h: 1, color: 'A1' }] });
    await text('undo');
    expect(store.get().mask).not.toContain('1');
    await text('redo');
    expect(store.get().mask).toContain('1');
    await text('restore_snapshot', { snapshotId: snapId });
    expect(store.get().mask).not.toContain('1');
  });

  it('describe_design and run_checks return text', async () => {
    const { text } = await connect();
    await text('new_design', NEW);
    await text('apply_ops', { ops: [{ op: 'rect', x: 5, y: 5, w: 1, h: 1, color: 'A1' }] });
    expect((await text('describe_design')).text).toMatch(/A1 紅 1 顆/);
    expect((await text('run_checks')).text).toMatch(/浮豆/);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/mcp.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/server/mcp.ts`

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { z } from 'zod';
import { setBoard } from '../core/board';
import { formatIssues, runChecks } from '../core/checks';
import { describeDesign } from '../core/describe';
import { OpError } from '../core/errors';
import { imageToCells } from '../core/importImage';
import { getVariant, maskFromCells } from '../core/model';
import { OpSchema } from '../core/opSchema';
import { applyOps, syncOtherVariants, type Summary } from '../core/ops';
import { allowedCodes, stockCapacity } from '../core/palette';
import { encodeDesignText } from '../core/textCodec';
import { createVariant, recolorVariant, selectVariant } from '../core/variants';
import { embedDesign, extractDesign } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

export type Vision = 'auto' | 'on' | 'off';

const Mode = z.enum(['all', 'owned', 'stock']);
const ViewE = z.enum(['flat', 'pattern', '3d', 'ironed']);
const designId = z.string().optional().describe('作品 id；省略時用目前開啟的作品');
const variant = z.string().optional().describe('配色版本 id（例如 v1）；省略時用目前顯示的版本');

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });

function wrap<A>(fn: (a: A) => Promise<{ content: Content[] }> | { content: Content[] }) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      if (e instanceof OpError) {
        const where = e.opIndex !== undefined ? `（op #${e.opIndex}）` : '';
        return { isError: true, content: [{ type: 'text' as const, text: `${e.code}${where}: ${e.message}` }] };
      }
      return { isError: true, content: [{ type: 'text' as const, text: `error: ${(e as Error).message}` }] };
    }
  };
}

function summaryText(s: Summary, checks: string): string {
  const total = Object.values(s.delta).reduce((a, b) => a + b, 0);
  const delta = Object.entries(s.delta).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ') || '無';
  return [
    `OK 版本 ${s.variant} 共 ${s.total} 顆（${total >= 0 ? '+' : ''}${total}）`,
    `變化：${delta}`,
    s.clipped ? `裁切：${s.clipped} 格超出畫布被略過` : '',
    `檢查：\n${checks}`,
  ].filter(Boolean).join('\n');
}

export function buildMcpServer(store: DesignStore, opts: { vision?: Vision } = {}): McpServer {
  const vision = opts.vision ?? 'auto';
  const server = new McpServer({ name: 'bead-studio', version: '0.1.0' });
  const checksText = (id?: string, v?: string) =>
    formatIssues(runChecks(store.get(id), v, { ...store.ctx(), config: store.checks }));

  server.registerTool('list_designs', { description: '列出所有作品（* 表示目前開啟）', inputSchema: {} },
    wrap(() => ok(store.list().map((d) => `${d.current ? '*' : ' '} ${d.id} ${d.name} v${d.version}`).join('\n') || '（沒有作品）')));

  server.registerTool('open_design', { description: '開啟作品，之後的操作預設作用於它（瀏覽器也會切換）', inputSchema: { id: z.string() } },
    wrap(({ id }) => { const d = store.open(id); return ok(`已開啟 ${d.name}（${d.cols}×${d.rows}）`); }));

  server.registerTool('new_design', {
    description: '建立新作品並開啟。尺寸以 mm 指定，格數自動換算 = floor(mm / bead)',
    inputSchema: {
      name: z.string(), widthMm: z.number().positive(), heightMm: z.number().positive(),
      bead: z.union([z.literal(2.6), z.literal(5)]), margin: z.number().int().min(0).default(2),
    },
  }, wrap(({ name, widthMm, heightMm, bead, margin }) => {
    const d = store.create(name, { widthMm, heightMm, bead, margin });
    return ok(`已建立 ${d.id}「${d.name}」：${d.cols}×${d.rows} 格，留邊 ${margin} 格`);
  }));

  server.registerTool('get_design', {
    description: '讀取設計（只回傳有豆子的範圍，每列 RLE：數字=重複次數，"."=空格）',
    inputSchema: { designId, variant },
  }, wrap(({ designId: id, variant: v }) => ok(encodeDesignText(store.get(id), v))));

  server.registerTool('describe_design', {
    description: '用文字描述設計：對稱性、色塊分佈、外框、低對比、縮圖。不能看圖時用它檢查成果',
    inputSchema: { designId, variant },
  }, wrap(({ designId: id, variant: v }) => ok(describeDesign(store.get(id), v, store.palette))));

  server.registerTool('render_preview', {
    description: '渲染預覽圖。view: flat 平面 / pattern 施工圖 / 3d 立體 / ironed 燙後；variant 填 "all" 會並排所有版本',
    inputSchema: { designId, variant, view: ViewE.default('flat'), scale: z.number().min(0.5).max(3).default(1) },
  }, wrap(async ({ designId: id, variant: v, view, scale }) => {
    const d = store.get(id);
    if (vision === 'off') return ok(describeDesign(d, v === 'all' ? undefined : v, store.palette));
    const png = await renderPng(d, store.palette, { variant: v, view: view as View, scale });
    return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
  }));

  server.registerTool('get_palette', {
    description: '列出顏色：每行「色號 名稱 hex 庫存N」。mode 省略時用該版本的色彩範圍',
    inputSchema: { mode: Mode.optional(), designId, variant },
  }, wrap(({ mode, designId: id, variant: v }) => {
    const m = mode ?? getVariant(store.get(id), v).paletteMode;
    const codes = allowedCodes(store.palette, store.inventory, m);
    return ok(store.palette.entries(codes).map((e) => {
      const s = store.inventory[e.code];
      return `${e.code} ${e.name} ${e.displayHex} 庫存${s?.owned ? s.count : 0}${e.transparent ? ' 透明' : ''}`;
    }).join('\n'));
  }));

  server.registerTool('run_checks', { description: '執行檢查器（留邊、浮豆、細線、掛孔、庫存、對比）', inputSchema: { designId, variant } },
    wrap(({ designId: id, variant: v }) => ok(checksText(id, v))));

  server.registerTool('apply_ops', {
    description: [
      '批次修改設計（原子性：任一條失敗則全部不套用；整批算一個 undo 步驟）。',
      '座標從 0 開始，x 往右、y 往下。超出畫布的部分會被裁切並回報。',
      'op 種類：paste{x,y,rows,legend}（"."不動 "_"清除）、rect/ellipse{x,y,w,h,color,fill?}、line{x1,y1,x2,y2,color}、',
      'polygon{points,color,fill?}、fill{x,y,color}、replace_color{from,to,region?}、clear{region}、move{region,dx,dy}、',
      'mirror{region,axis:h|v}、rotate{region,turns:1|2|3}、outline{target:"shape"|色號,color,side:outer|inner,connect?:4|8}、',
      'gradient{target,colors[],direction:h|v|radial|角度,region?,dither?}、shade{target,light:tl|t|tr|l|r|bl|b|br,highlight,shadow,depth?}、',
      'set_hole{x,y,remove?}',
    ].join(''),
    inputSchema: { designId, variant, ops: z.array(OpSchema).min(1) },
  }, wrap(({ designId: id, variant: v, ops }) => {
    let summary!: Summary;
    const d = store.update(id, (cur) => { const r = applyOps(cur, ops, store.ctx(), v); summary = r.summary; return r.design; });
    return ok(summaryText(summary, checksText(d.id, summary.variant)));
  }));

  server.registerTool('set_board', {
    description: '改面板尺寸／豆子尺寸／留邊。換豆子尺寸時 keep: cells（保持格數）或 size（保持實體尺寸、重新取樣）。會裁掉豆子時需 force: true',
    inputSchema: {
      designId, widthMm: z.number().positive().optional(), heightMm: z.number().positive().optional(),
      bead: z.union([z.literal(2.6), z.literal(5)]).optional(), margin: z.number().int().min(0).optional(),
      keep: z.enum(['cells', 'size']).default('size'), force: z.boolean().default(false),
    },
  }, wrap(({ designId: id, keep, force, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    let cropped = 0;
    const d = store.update(id, (cur) => { const r = setBoard(cur, clean, { keep, force }); cropped = r.cropped; return r.design; });
    return ok(`面板 ${d.board.widthMm}×${d.board.heightMm}mm、${d.board.bead}mm 豆 → ${d.cols}×${d.rows} 格，留邊 ${d.board.margin}${cropped ? `，裁掉 ${cropped} 顆` : ''}`);
  }));

  server.registerTool('create_variant', {
    description: '從現有版本複製出新配色版本，依色彩範圍自動換成最接近的顏色（stock 模式會遵守庫存數量）',
    inputSchema: { designId, name: z.string(), paletteMode: Mode, from: z.string().optional() },
  }, wrap(({ designId: id, name, paletteMode, from }) => {
    let vid = '';
    store.update(id, (cur) => { const r = createVariant(cur, { name, paletteMode, from }, store.ctx()); vid = r.id; return r.design; });
    return ok(`已建立配色版本 ${vid}「${name}」（${paletteMode}）`);
  }));

  server.registerTool('set_variant_mode', {
    description: '變更某版本的色彩範圍並重新對色',
    inputSchema: { designId, variant: z.string(), paletteMode: Mode },
  }, wrap(({ designId: id, variant: v, paletteMode }) => {
    store.update(id, (cur) => recolorVariant(cur, v, store.ctx(), { mode: paletteMode }));
    return ok(`版本 ${v} 已改為 ${paletteMode} 並重新對色`);
  }));

  server.registerTool('select_variant', { description: '切換目前顯示的配色版本', inputSchema: { designId, variant: z.string() } },
    wrap(({ designId: id, variant: v }) => { store.update(id, (cur) => selectVariant(cur, v)); return ok(`目前版本：${v}`); }));

  server.registerTool('set_shape_lock', { description: '鎖定形狀（只能換色）或解鎖', inputSchema: { designId, locked: z.boolean() } },
    wrap(({ designId: id, locked }) => { store.update(id, (cur) => ({ ...cur, shapeLocked: locked })); return ok(locked ? '🔒 形狀已鎖定' : '🔓 形狀已解鎖'); }));

  server.registerTool('import_image', {
    description: '導入圖片。含 bead-studio metadata 的 PNG 會還原成新作品；其他圖片會轉換到目前作品的指定版本（覆蓋原內容）',
    inputSchema: { path: z.string(), designId, variant, removeBg: z.boolean().default(false), dither: z.boolean().default(false) },
  }, wrap(async ({ path, designId: id, variant: v, removeBg, dither }) => {
    const buf = readFileSync(path);
    const meta = extractDesign(buf);
    if (meta) { const d = store.importDesign(meta); return ok(`已從 PNG metadata 還原作品 ${d.id}「${d.name}」`); }
    const img = await loadImage(buf);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    const d = store.update(id, (cur) => {
      const target = getVariant(cur, v);
      const allowed = store.palette.entries(allowedCodes(store.palette, store.inventory, target.paletteMode));
      const cells = imageToCells(rgba, img.width, img.height, {
        cols: cur.cols, rows: cur.rows, margin: cur.board.margin, allowed, removeBg, dither,
        capacity: target.paletteMode === 'stock' ? stockCapacity(store.inventory) : undefined,
      });
      if (cur.shapeLocked) throw new OpError('shape_locked', '形狀已鎖定，無法導入圖片（會改變豆子位置）');
      const next = structuredClone(cur);
      const tv = getVariant(next, target.id);
      tv.cells = cells;
      next.mask = maskFromCells(cells);
      for (const o of next.variants) if (o !== tv) o.cells = o.cells.map(() => null);
      syncOtherVariants(next, tv, store.ctx());
      return next;
    });
    const n = getVariant(d, v).cells.filter(Boolean).length;
    return ok(`已轉換圖片到 ${d.name}：${n} 顆豆子\n檢查：\n${checksText(d.id, v)}`);
  }));

  server.registerTool('export_png', {
    description: '匯出 PNG（含可還原的 metadata）。variant 填 "all" 會並排所有版本',
    inputSchema: { path: z.string(), designId, variant, view: ViewE.default('flat'), scale: z.number().min(0.5).max(4).default(2) },
  }, wrap(async ({ path, designId: id, variant: v, view, scale }) => {
    const d = store.get(id);
    writeFileSync(path, embedDesign(await renderPng(d, store.palette, { variant: v, view: view as View, scale }), d));
    return ok(`已匯出 ${path}`);
  }));

  server.registerTool('set_inventory', {
    description: '設定庫存：items 中每個 {code, owned?, count?} 會合併到現有庫存',
    inputSchema: { items: z.array(z.object({ code: z.string(), owned: z.boolean().optional(), count: z.number().int().min(0).optional() })).min(1) },
  }, wrap(({ items }) => {
    const inv = store.setInventory(items);
    const owned = Object.entries(inv).filter(([, s]) => s.owned);
    return ok(`已更新。目前擁有 ${owned.length} 色，共 ${owned.reduce((a, [, s]) => a + s.count, 0)} 顆`);
  }));

  server.registerTool('snapshot', { description: '儲存快照（大改之前建議先存）', inputSchema: { designId, name: z.string() } },
    wrap(({ designId: id, name }) => { const s = store.snapshot(id, name); return ok(`已儲存快照 ${s.id}「${s.name}」`); }));

  server.registerTool('restore_snapshot', { description: '還原快照（可再 undo）', inputSchema: { designId, snapshotId: z.string() } },
    wrap(({ designId: id, snapshotId }) => { store.restoreSnapshot(id, snapshotId); return ok(`已還原快照 ${snapshotId}`); }));

  server.registerTool('undo', { description: '復原上一步', inputSchema: { designId } },
    wrap(({ designId: id }) => { const d = store.undo(id); return ok(`已復原（版本 ${d.version}）`); }));

  server.registerTool('redo', { description: '重做', inputSchema: { designId } },
    wrap(({ designId: id }) => { const d = store.redo(id); return ok(`已重做（版本 ${d.version}）`); }));

  return server;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test tests/mcp.test.ts`
Expected: PASS。若 SDK 的 `registerTool` 簽名與上面不同（例如 SDK 主版本有變），以 `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` 為準調整，不要改測試的行為期望。

- [ ] **Step 5: 全部測試與型別檢查**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS，無型別錯誤

- [ ] **Step 6: Commit**

```bash
git add src/server/mcp.ts tests/mcp.test.ts
git commit -m "feat(mcp): bead studio MCP tools"
```

---

### Task 17: HTTP 伺服器 + 啟動

**Files:**
- Create: `src/server/app.ts`、`src/server/index.ts`、`README.md`
- Test: `tests/app.test.ts`

**Interfaces:**
- Consumes: `DesignStore`、`buildMcpServer`、`Vision`、`renderPng`、`embedDesign`
- Produces:
  - `buildApp(store: DesignStore, opts?: { vision?: Vision }): FastifyInstance`
  - 路由：`POST /mcp`（stateless Streamable HTTP）、`GET|DELETE /mcp` → 405、`GET /health`、`GET /api/designs/:id/export.png?variant=&view=&scale=`
  - `pnpm start` 在 `127.0.0.1:${PORT ?? 5174}` 啟動；環境變數 `BEADS_VISION`、`BEADS_DATA_DIR`（預設 `data`）、`BEADS_CONFIG_DIR`（預設 `config`）

- [ ] **Step 1: 寫失敗的測試** `tests/app.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DesignStore } from '../src/server/store';
import { buildApp } from '../src/server/app';
import { extractDesign } from '../src/server/pngmeta';
import { FIX_COLORS } from './fixtures';

let app: ReturnType<typeof buildApp>;
let base: string;
let store: DesignStore;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beads-app-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'data/palette.json'), JSON.stringify(FIX_COLORS));
  store = new DesignStore({ dataDir: join(dir, 'data'), configDir: join(dir, 'config') });
  store.load();
  app = buildApp(store);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

describe('http app', () => {
  it('health check', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });
  it('serves MCP over streamable HTTP', async () => {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'apply_ops')).toBe(true);
    const r: any = await client.callTool({ name: 'new_design', arguments: { name: 'http', widthMm: 50, heightMm: 50, bead: 5, margin: 1 } });
    expect(r.content[0].text).toMatch(/已建立/);
    await client.close();
  });
  it('rejects GET /mcp with 405', async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
  it('exports PNG with metadata', async () => {
    const d = store.list()[0];
    const res = await fetch(`${base}/api/designs/${d.id}/export.png?view=pattern`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(extractDesign(Buffer.from(await res.arrayBuffer()))!.id).toBe(d.id);
  });
  it('404s for unknown design export', async () => {
    expect((await fetch(`${base}/api/designs/nope/export.png`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/app.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作** `src/server/app.ts`

```ts
import Fastify from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OpError } from '../core/errors';
import { buildMcpServer, type Vision } from './mcp';
import { embedDesign } from './pngmeta';
import { renderPng, type View } from './render';
import type { DesignStore } from './store';

export function buildApp(store: DesignStore, opts: { vision?: Vision } = {}) {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post('/mcp', async (req, reply) => {
    const server = buildMcpServer(store, opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  const notAllowed = async (_: unknown, reply: any) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  app.get<{ Params: { id: string }; Querystring: { variant?: string; view?: View; scale?: string } }>(
    '/api/designs/:id/export.png',
    async (req, reply) => {
      try {
        const d = store.get(req.params.id);
        const png = await renderPng(d, store.palette, { variant: req.query.variant, view: req.query.view ?? 'flat', scale: Number(req.query.scale ?? 2) });
        return reply.type('image/png').send(embedDesign(png, d));
      } catch (e) {
        if (e instanceof OpError && e.code === 'no_design') return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );

  return app;
}
```

`src/server/index.ts`

```ts
import { buildApp } from './app';
import type { Vision } from './mcp';
import { DesignStore } from './store';

const store = new DesignStore({
  dataDir: process.env.BEADS_DATA_DIR ?? 'data',
  configDir: process.env.BEADS_CONFIG_DIR ?? 'config',
});
store.load();
const port = Number(process.env.PORT ?? 5174);
const app = buildApp(store, { vision: (process.env.BEADS_VISION as Vision) ?? 'auto' });
await app.listen({ port, host: '127.0.0.1' });
console.log(`🫘 Bead Studio: http://localhost:${port}  (MCP: http://localhost:${port}/mcp)`);
```

`README.md`

````markdown
# 🫘 豆豆工作室 Bead Studio

AI 協作的拼豆設計工具。

## 啟動

```bash
pnpm install
pnpm start          # http://localhost:5174
```

## 連接 Claude Code

```bash
claude mcp add --transport http beads http://localhost:5174/mcp
```

在這個資料夾裡啟動 Claude Code，就會自動載入 `.claude/skills/bead-design` 設計知識。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | 5174 | 伺服器埠 |
| `BEADS_VISION` | auto | `off`：render_preview 改回傳文字描述（給不能看圖的模型） |
| `BEADS_DATA_DIR` | data | 設計、色表、庫存 |
| `BEADS_CONFIG_DIR` | config | 檢查器門檻 `checks.json` |
````

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 手動冒煙測試**

```bash
pnpm start &
sleep 2
curl -s http://localhost:5174/health
kill %1
```

Expected: `{"ok":true}`，啟動訊息顯示網址

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts src/server/index.ts README.md tests/app.test.ts
git commit -m "feat(server): fastify app with MCP endpoint and PNG export"
```

---

### Task 18: 設計知識 Skill + 端到端驗收

**Files:**
- Create: `.claude/skills/bead-design/SKILL.md`、`.claude/skills/bead-design/knowledge/{color,shading,outline,structure,scale}.md`、`.claude/skills/bead-design/recipes/{eyes,cheeks,sparkle}.md`、`.claude/skills/bead-design/CHANGELOG.md`
- Test: `tests/skill.test.ts`

**Interfaces:**
- Consumes: MCP 工具名稱（Task 16）、`config/checks.json`（Task 3）
- Produces: Claude Code 可自動載入的 skill

- [ ] **Step 1: 寫失敗的測試** `tests/skill.test.ts`（確保 skill 引用的工具名稱與檔案都存在，避免之後改名時失聯）

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = '.claude/skills/bead-design';
const TOOLS = ['get_design', 'describe_design', 'render_preview', 'get_palette', 'run_checks', 'apply_ops',
  'create_variant', 'set_shape_lock', 'snapshot', 'set_board'];

describe('bead-design skill', () => {
  const skill = readFileSync(`${ROOT}/SKILL.md`, 'utf8');
  it('has frontmatter with name and description', () => {
    expect(skill).toMatch(/^---\nname: bead-design\ndescription: .+\n---/);
  });
  it('references the MCP tools it relies on', () => {
    for (const t of TOOLS) expect(skill).toContain(t);
  });
  it('links knowledge files that exist', () => {
    for (const f of ['color', 'shading', 'outline', 'structure', 'scale']) {
      expect(skill).toContain(`knowledge/${f}.md`);
      expect(existsSync(`${ROOT}/knowledge/${f}.md`)).toBe(true);
    }
    expect(existsSync(`${ROOT}/CHANGELOG.md`)).toBe(true);
  });
  it('recipes use paste-compatible rows', () => {
    for (const r of ['eyes', 'cheeks', 'sparkle']) {
      const md = readFileSync(`${ROOT}/recipes/${r}.md`, 'utf8');
      expect(md).toMatch(/"op": "paste"/);
    }
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm test tests/skill.test.ts`
Expected: FAIL（ENOENT）

- [ ] **Step 3: 寫 `SKILL.md`**

````markdown
---
name: bead-design
description: 用 Bead Studio MCP 設計拼豆圖案時使用：設計流程、省 token 的操作方式、配色與結構知識，以及如何把使用者的回饋寫回知識庫
---

# 拼豆設計

## 開始前
1. `get_design` 看面板（格數、留邊、豆子尺寸、鎖定狀態、目前版本與色彩範圍）。沒有作品就 `new_design`。
2. `get_palette` 取得可用顏色（依版本的色彩範圍）。只用清單裡的色號。
3. 依 `knowledge/scale.md` 決定細節程度。

## 設計流程
1. **大改前先 `snapshot`**。
2. **剪影**：用 `apply_ops` 的 `paste` 一次畫出主體輪廓與大色塊（rows 用字元畫圖），或用 `ellipse`/`polygon`。
   - 主體放在留邊範圍內，並大致置中。
3. **填色**：大面積用 `fill`／`replace_color`。
4. **描邊**：照 `knowledge/outline.md`，通常 `outline {target:"shape", side:"outer"}`。
5. **明暗**：照 `knowledge/shading.md`，用 `shade` 或 `gradient`，顏色挑選見 `knowledge/color.md`。
6. **細節**：眼睛、腮紅等可用 `recipes/` 的現成圖塊。
7. **檢查**：看 `apply_ops` 回傳的檢查結果或 `run_checks`，依 `knowledge/structure.md` 修正（掛孔補透明豆、浮豆、細線）。
8. **自我審查**：`render_preview`（能看圖時）或 `describe_design`（不能看圖時）。至少審一輪：對稱、比例、對比、可讀性。
9. **配色版本**：形狀確定後 `set_shape_lock {locked:true}`，再用 `create_variant` 產生「有的色」（owned）和「庫存版」（stock）版本，各自 `render_preview` 檢查，必要時只用換色類 op 微調。

## 省 token 原則
- 一次 `apply_ops` 送一整批相關指令，不要一顆一顆畫。
- 能用幾何 op（rect/ellipse/line/polygon/fill）就不要用 paste；paste 只用在不規則形狀。
- 讀圖用 `get_design`（RLE），不要反覆讀；改完看 `apply_ops` 回傳的摘要即可。
- 不要每一步都 `render_preview`，在流程第 8 步集中看。

## 錯誤處理
- `apply_ops` 失敗時整批不會套用，照錯誤訊息（含 op 編號）修正後重送整批。
- `color_not_allowed` 會建議最接近的可用色；`shape_locked` 代表要先解鎖或改用換色。

## 學習與更新知識
使用者說「記住」「以後都這樣」，或糾正的是通用規則（不只這一張圖）時：
1. 直接修改對應的 `knowledge/*.md`（新增、修改或刪除規則，避免重複與矛盾）。
2. 涉及數值門檻（留邊、掛孔相鄰數、對比 ΔE、細線長度）時，同步修改專案的 `config/checks.json`，並提醒使用者重新啟動伺服器讓檢查器生效。
3. 在 `CHANGELOG.md` 最上方加一筆：`- YYYY-MM-DD：規則內容（原因／使用者原話）`。
4. 在回覆中用一兩句告訴使用者改了什麼。
````

- [ ] **Step 4: 寫知識檔**

`knowledge/color.md`

```markdown
# 配色

- 一個作品主色控制在 3～6 色（不含描邊與透明），色數越少越清爽、越容易備料。
- 相鄰色塊的 ΔE 至少 10，否則邊界看不清（檢查器 low_contrast 會提醒）。
- 漸層：同色系挑 3～4 個明度遞增的顏色，用 `gradient`；面積小（< 6 格寬）時不要用 dither，會變雜點。
- 膚色、粉色系實物通常比螢幕更淡；白色與米白在實物上差異很小，不要靠兩者做區分。
- 「有的色」「庫存版」重新對色後，若主色被換到差很遠的顏色，優先改用同色系的其他顏色手動 `replace_color`。
```

`knowledge/shading.md`

```markdown
# 明暗

- 預設光源在左上（`light: "tl"`），整個作品保持同一光源方向。
- 亮部：比底色明度高一階的同色系顏色；暗部：低一階。不要用白色當亮部、黑色當暗部（太硬）。
- 30 格以下的小作品 `depth: 1` 就夠；40 格以上可用 `depth: 2`。
- 圓形物體（球、臉、果實）：先 `shade`，再在亮部中心點 1 顆更亮的高光。
- 描邊顏色不參與明暗處理：`shade` 的 target 用填色的色號，而不是 "shape"。
```

`knowledge/outline.md`

```markdown
# 描邊

- 卡通風格：外框用深色（深咖、炭黑），比純黑柔和。
- 一般用 `outline {target:"shape", side:"outer"}`（8 連通，轉角封閉）。
- 作品很小（< 20 格）時改用 `side: "inner"`，避免外框吃掉太多空間。
- 內部分隔線（例如五官、衣服摺線）用 `line`，顏色比外框淺一階。
- 描邊之後的外框是單顆寬，注意檢查器的「細線易斷」：外框若只靠一條單顆線連接主體，要加粗或補豆。
```

`knowledge/structure.md`

```markdown
# 結構與燙豆

- **掛孔**：掛勾穿過的是邊緣某顆豆子的中孔。那顆豆子至少要有 3 個相鄰豆（檢查器 hole），不足時在外側補透明豆（`get_palette` 中標示「透明」的色號），讓它被包住。
- **浮豆**：上下左右都沒有相鄰的單顆豆，燙完一定掉，要連到主體或刪掉。
- **細線**：單顆寬、長度 ≥ 4 的線容易斷。可以加粗成 2 顆寬、加支撐，或在背面多燙一點。
- **留邊**：主體不要碰到留邊範圍，方便從板子取下、也讓作品四周平整。
- **對角連接不算連接**：兩顆豆子只有斜角相鄰時，燙完幾乎不會黏在一起。
```

`knowledge/scale.md`

```markdown
# 尺寸與細節

| 主體大小 | 適合的細節 |
|---|---|
| < 15 格 | 只畫剪影＋1～2 個重點色；眼睛 1 顆 |
| 15～30 格 | 剪影＋描邊＋簡單明暗；眼睛 1～2 顆，可加 1 顆高光 |
| 30～50 格 | 可加漸層、2 階明暗、表情細節 |
| > 50 格 | 可做照片轉圖、較多色階 |

- 2.6mm 豆 8cm 板約 30 格，屬於「15～30 格」級別（扣掉留邊後主體約 26 格）。
- 文字：每個字至少 5×5 格，小作品避免放文字。
```

`recipes/eyes.md`

````markdown
# 眼睛

小眼（1 顆，適合 < 20 格）：直接 `rect {w:1,h:1}`。

大眼（2×2＋高光，適合 20～40 格）。把 x,y 換成左上角座標，k=深色，w=白色：

```json
{ "op": "paste", "x": 0, "y": 0, "rows": ["wk", "kk"], "legend": { "k": "<深色色號>", "w": "<白色色號>" } }
```
````

`recipes/cheeks.md`

````markdown
# 腮紅

放在眼睛下方外側、和眼睛距離 1 格。p=粉色系：

```json
{ "op": "paste", "x": 0, "y": 0, "rows": ["pp"], "legend": { "p": "<粉色色號>" } }
```
````

`recipes/sparkle.md`

````markdown
# 星光（十字閃光）

y=亮黃或白色，放在主體外側的空白處（注意不要變成浮豆，需與主體相連或做成獨立小件）：

```json
{ "op": "paste", "x": 0, "y": 0, "rows": [".y.", "yyy", ".y."], "legend": { "y": "<亮色色號>" } }
```
````

`CHANGELOG.md`

```markdown
# 設計知識變更紀錄

- 2026-11-11：建立初版知識（配色、明暗、描邊、結構、尺寸、基本圖塊）。
```

- [ ] **Step 5: 確認測試通過**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 6: 端到端驗收（手動，使用者參與）**

```bash
pnpm start
# 另一個終端機：
claude mcp add --transport http beads http://localhost:5174/mcp
```

在 `bead-studio/` 裡開 Claude Code，請 AI：「在 8×8cm、2.6mm 豆、留邊 2 格的板子上設計一隻蘑菇吊飾，掛孔在頂部中間，最後匯出施工圖到 ~/Desktop/mushroom.png」。確認：
- AI 使用了 bead-design skill 的流程（剪影 → 描邊 → 明暗 → 檢查 → 預覽）
- 匯出的 PNG 有色號與用量表
- 用 `import_image` 匯入該 PNG 能還原成新作品

- [ ] **Step 7: Commit**

```bash
git add .claude tests/skill.test.ts
git commit -m "feat(skill): bead-design skill with initial design knowledge"
```

---

## 規格對照（Plan 1 範圍）

| 規格章節 | 對應 Task |
|---|---|
| §3 架構、技術選型、啟動與連接 | 1、17 |
| §4 資料模型、新增／移除行為、改尺寸、換豆子尺寸 | 4、7 |
| §4 全域資料（palette、inventory、checks） | 2、3、15 |
| §4 復原與快照 | 15 |
| §6 匯出三種樣式＋全部版本、metadata、導入、圖片轉換、庫存分配 | 6、12、13、14、16 |
| §7 檢查器 | 10 |
| §8 MCP 工具與伺服器端限制 | 7、8、9、11、16 |
| §9 Skill | 18 |
| §10 錯誤處理（原子性、暫存檔改名、metadata 降級） | 7、14、15、16 |
| §11 測試（core、MCP 整合） | 每個 task；UI 冒煙測試在 Plan 2 |
| §5 網頁 UI、§12 顏色校正 UI | Plan 2 |
