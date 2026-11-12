# 單一設計（移除配色版本與形狀鎖定）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作品只有一組 `cells`；移除配色版本、色彩範圍、形狀鎖定與 `mask`，「只用有的顏色／數量」改由 AI 依檢查器結果自行把關。

**Architecture:** 先改資料模型（`DesignCore.cells`），讓 core → server → web 一路跟著改到編譯通過、測試全綠（Task 1，機械式遷移）；再移除網頁上的版本／鎖定介面與相關 e2e（Task 2）；最後更新 skill、README（Task 3）。

**Tech Stack:** TypeScript ESM、zod、vitest、Fastify、MCP SDK、React 19、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-12-single-design-design.md`

## Global Constraints

- 不相容舊格式：舊作品檔不修改、不刪除；`parseDesign` 讀不懂就回傳 null，store 照現有行為略過並 `console.warn`。
- 不要刪除或改寫 `./data`、`./config`、`~/BeadStudio` 裡的任何檔案（測試一律用 tmpdir）。
- 不要放寬 Host/Origin 檢查。
- 工具不再依色彩範圍擋顏色：任何色表上的顏色都能用；缺料由檢查器（`stock`）提醒。
- 自動對色（`import_image`）永遠不選透明豆（沿用現有 `!e.transparent` 過濾）。
- Commit 訊息結尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 使用者介面文字用繁體中文。

## Review Focus

1. 載入舊格式（含 `variants`）的作品檔：略過、檔案內容不變、伺服器正常啟動。→ Task 1 store 測試。
2. 匯入含舊 metadata 的 PNG：當一般圖片轉換，不丟錯。→ Task 1 pngmeta/importBuffer 測試。
3. 用沒有庫存的顏色畫：`apply_ops` 成功，回傳的檢查列出「沒有庫存」。→ Task 1 mcp 測試。
4. 畫筆途中 AI 修改：樂觀預覽仍重新套用（原本靠 `variant`，改成不需要）。→ Task 1 editorState 測試、Task 2 e2e 既有的 mid-stroke 測試。
5. 面板設定換豆子尺寸（保持實體尺寸）不再有鎖定錯誤，照常重新取樣。→ Task 1 board 測試。

---

### Task 1: 資料模型改成單一 `cells`（core + server + web 編譯通過）

**Files:**
- Modify: `src/core/model.ts`, `src/core/designSchema.ts`, `src/core/ops.ts`, `src/core/work.ts`, `src/core/board.ts`, `src/core/textCodec.ts`, `src/core/describe.ts`, `src/core/checks.ts`, `src/core/importImage.ts`, `src/core/palette.ts`, `src/core/render/draw.ts`
- Delete: `src/core/variants.ts`, `src/core/allocate.ts`, `tests/variants.test.ts`, `tests/allocate.test.ts`（若 `matchCodes`／`allocate` 已無其他使用者）
- Modify: `src/server/store.ts`, `src/server/mcp.ts`, `src/server/importBuffer.ts`, `src/server/render.ts`, `src/server/app.ts`
- Modify (web 只做編譯所需的最小改動): `src/web/lib/{clientCore,editorState,boardRender,api}.ts`, `src/web/components/{AppShell,Editor,ChecksPanel,Preview3D,DeductDialog,ExportMenu,ImportOverlay}.tsx`
- Test: `tests/fixtures.ts`, `tests/{model,designSchema,ops,board,textCodec,describe,checks,render,store,mcp,importImage,importBuffer,pngmeta,toolClient,api,ws}.test.ts`, `tests/web/*.test.ts`, `e2e/fixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/core/model.ts
  export type DesignCore = {
    id: string; name: string; version: number; board: Board; cols: number; rows: number;
    cells: (string | null)[]; markers: Marker[];
  };
  export function createDesign(a: { id: string; name: string; board: Board }): Design; // cells 全 null
  // 刪除：Variant、getVariant、maskFromCells、activeVariant、shapeLocked、mask
  // src/core/ops.ts
  export type Summary = { total: number; counts: Record<string, number>; delta: Record<string, number>; clipped: number };
  export function applyOps<D extends DesignCore>(design: D, rawOps: unknown[], ctx: OpCtx): { design: D; summary: Summary };
  // src/core/checks.ts
  export function runChecks(d: DesignCore, ctx: {...}): Issue[];
  // src/core/textCodec.ts
  export function encodeDesignText(d: DesignCore, region?: Region): string;
  // src/core/describe.ts
  export function describeDesign(d: DesignCore, palette: Palette): string;
  // src/core/render/draw.ts
  export function drawIso(ctx: C2D, d: DesignCore, p: Palette, o: IsoOpts): void; // 讀 d.cells
  // src/server/render.ts
  export async function renderPng(d: Design, p: Palette, opts: { view?: View; scale?: number }): Promise<Buffer>;
  // src/server/store.ts
  deductInventory(design: Design): DeductionPlan;
  // src/server/importBuffer.ts — 移除 variant 選項
  importImageBuffer(store, buf, { designId?, removeBg?, dither?, colors?, crop?, exclude? })
  // src/web/lib/editorState.ts
  export type Pending = { baseVersion: number; design: Design; ops?: unknown[]; commitVersion?: number };
  // src/web/lib/clientCore.ts
  export function previewOps(design: Design, ops: unknown[], ctx: OpCtx): Design | Error;
  // src/web/lib/api.ts
  uploadImport(file, o: { removeBg?: boolean; dither?: boolean })
  exportUrl(designId, o: { view?: View; scale?: number })
  ```

- [ ] **Step 1: 改寫測試 fixture 與模型測試（先讓它們失敗）**

`tests/fixtures.ts` 的 `paint` 改成：
```ts
export function paint(d: Design, pts: [number, number, string][]): Design {
  const n = cloneDesign(d);
  for (const [x, y, c] of pts) n.cells[y * n.cols + x] = c;
  return n;
}
```
`tests/model.test.ts`、`tests/designSchema.test.ts`：把版本／mask／shapeLocked 的斷言改成 `cells`。在 `tests/designSchema.test.ts` 新增：
```ts
it('rejects the old multi-variant format', () => {
  const old = { id: 'd-1', name: 'x', version: 0, board: { widthMm: 10, heightMm: 10, bead: 5, margin: 0 }, cols: 2, rows: 2,
    mask: '0000', variants: [{ id: 'v1', name: '理想版', paletteMode: 'all', cells: [null, null, null, null] }],
    activeVariant: 'v1', shapeLocked: false, markers: [], snapshots: [] };
  expect(parseDesign(old)).toBeNull();
});
it('rejects cells with the wrong length', () => {
  const d = { id: 'd-1', name: 'x', version: 0, board: { widthMm: 10, heightMm: 10, bead: 5, margin: 0 }, cols: 2, rows: 2, cells: [null], markers: [], snapshots: [] };
  expect(parseDesign(d)).toBeNull();
});
```
Run: `pnpm vitest run tests/model.test.ts tests/designSchema.test.ts` — Expected: FAIL（型別／欄位不符）。

- [ ] **Step 2: 改 `model.ts` 與 `designSchema.ts`**

`model.ts`：照 Interfaces 改 `DesignCore`；`createDesign` 回傳 `{ id, name, version: 0, board, cols, rows, cells: Array(cols*rows).fill(null), markers: [], snapshots: [] }`；刪除 `Variant`、`getVariant`、`maskFromCells`；`bbox(d, cells)` 保留。

`designSchema.ts`：`coreShape` 改成
```ts
const coreShape = {
  id: z.string(), name: z.string(), version: z.number().int().min(0), board: BoardSchema,
  cols: z.number().int().min(1).max(2048), rows: z.number().int().min(1).max(2048),
  cells: z.array(z.string().min(1).nullable()), markers: z.array(MarkerSchema).default([]),
};
```
`checkConsistency` 只檢查 `cells.length === cols*rows`。物件用 `.strict()`，讓帶 `variants`／`mask` 的舊格式無法通過（DesignCoreSchema 與 DesignSchema 都要 strict；DesignSchema 多 `snapshots`）。

Run: `pnpm vitest run tests/model.test.ts tests/designSchema.test.ts` — Expected: PASS。

- [ ] **Step 3: core ops／work／board／codec／describe／checks**

- `work.ts`：刪除 `Work.allowed`；`checkColor` 只留 `unknown_color` 檢查。`effects.ts` 若有用到 `w.allowed` 一併拿掉。
- `ops.ts`：刪除 `assertStock`、`syncOtherVariants`、形狀鎖檢查、`allowedCodes`／`stockCapacity`／`matchCodes` import。`applyOps(design, rawOps, ctx)`：`w.cells = [...next.cells]`，跑完 `next.cells = w.cells; next.markers = w.markers`；`Summary` 去掉 `variant`。`mirror` 那行註解改成「既有豆子直接寫入」。
- `board.ts`：刪除兩個 `shape_locked` 分支；裁切計數改用 `d.cells[i] !== null`；重新取樣只處理 `next.cells`；刪除 `mask` 計算。
- `textCodec.ts`：`encodeDesignText(d, region?)`，標頭改成 `` `${d.cols}x${d.rows} margin=${d.board.margin} bead=${d.board.bead}` ``，讀 `d.cells`。
- `describe.ts`：`describeDesign(d, palette)`，第一行去掉「版本…」與「形狀已鎖定」，讀 `d.cells`。
- `checks.ts`：`runChecks(d, ctx)`，讀 `d.cells`。
- `importImage.ts`：刪除 `capacity` 選項與 `allocate` 分支。
- `palette.ts`：刪除 `PaletteMode`、`allowedCodes`、`stockCapacity`（確認沒有其他使用者後）。
- `render/draw.ts`：`drawIso(ctx, d, p, o)` 與 `drawFlat` 等讀 `d.cells`（不再收 `Variant`）。
- 刪除 `src/core/variants.ts`、`src/core/allocate.ts` 與其測試。

更新 `tests/{ops,board,textCodec,describe,checks,effects,importImage,render}.test.ts`：移除 variant 參數與版本／鎖定案例（`shape_locked`、`color_not_allowed`、`stock_exceeded`、同步其他版本），新增：
```ts
// tests/ops.test.ts
it('accepts any palette color regardless of inventory', () => {
  const { design } = applyOps(smallDesign(), [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }], { palette, inventory: {} });
  expect(design.cells[0]).toBe('A1');
});
// tests/board.test.ts
it('resamples when the bead size changes and keep is size', () => {
  const d = paint(smallDesign(10, 10), [[0, 0, 'A1']]);
  const { design } = setBoard(d, { bead: 2.6 }, { keep: 'size' });
  expect(design.cells.filter(Boolean).length).toBeGreaterThan(0);
});
```
Run: `pnpm vitest run tests/ops.test.ts tests/board.test.ts tests/textCodec.test.ts tests/describe.test.ts tests/checks.test.ts tests/importImage.test.ts` — Expected: PASS。

- [ ] **Step 4: server**

- `store.ts`：`deductInventory(design)` 用 `design.cells`；其他 `getVariant` 用法改 `d.cells`。
- `importBuffer.ts`：移除 `variant`；`allowed = store.palette.all()` 中非透明者（再依 `colors` 過濾，`colors` 不在色表 → `unknown_color`；刪除 `color_not_allowed` 分支）；`next.cells = cells`；刪除 `capacity`、`syncOtherVariants`、`maskFromCells`、`shape_locked` 檢查；檢查結果用 `runChecks(store.get(d.id), …)`。
- `render.ts`：`renderPng(d, p, { view, scale })` 只畫一個 panel；標題文字改成作品名稱 `d.name`。
- `mcp.ts`：
  - 刪除 `Mode`、`variant` schema、`create_variant`、`set_variant_mode`、`select_variant`、`set_shape_lock`。
  - 所有工具移除 `variant` 參數；`checksText(id)`；`summaryText` 第一行改成 `` `OK 共 ${s.total} 顆（…）` ``。
  - `get_palette`：無參數，description `'列出所有顏色：每行「色號 名稱 hex 庫存N」（庫存0 代表沒有這個顏色）'`，列出 `store.palette.all()`。
  - `render_preview`／`export_png` description 去掉 `variant 填 "all"` 那句。
  - `deduct_inventory`：只收 `designId`；`deductionText(d, plan)` 去掉版本名稱。
- `app.ts`：export 路由與 `/api/import` 移除 `variant` query；404 判斷去掉 `no_variant`。

更新 `tests/{store,mcp,importBuffer,pngmeta,toolClient,api,ws,app}.test.ts`：移除版本工具案例，新增：
```ts
// tests/store.test.ts
it('skips old-format design files without touching them', () => {
  // 在 tmp dataDir/designs 寫入舊格式 JSON（含 variants），load 後 list() 不含它，檔案內容 byte-for-byte 不變
});
// tests/mcp.test.ts
it('draws with a color that is not in stock and reports the shortage', async () => {
  // new_design → apply_ops 用 inventory 裡沒有的色號 → ok，text 含「沒有庫存」
});
it('no longer exposes variant tools', async () => {
  // listTools 不含 create_variant / set_variant_mode / select_variant / set_shape_lock
});
// tests/pngmeta.test.ts 或 importBuffer.test.ts
it('treats old-format metadata as a plain image', async () => {
  // embedDesign 一份舊格式物件（直接寫 zTXt）→ importImageBuffer 回傳含「metadata 無效」提示並轉換成功
});
```
（以上三個測試需寫出完整程式碼；參考同檔案既有測試的 setup。）

Run: `pnpm vitest run tests/` 中 server 相關檔案 — Expected: PASS。

- [ ] **Step 5: web 編譯所需的最小改動**

- `editorState.ts`：`Pending` 去掉 `variant`。
- `clientCore.ts`：`previewOps(design, ops, ctx)`；`displayDesign` 呼叫 `previewOps(server, pending.ops, ctx)`。
- `boardRender.ts`：鏡像只翻 `d.cells`；讀格子用 `d.cells`。
- `api.ts`：`uploadImport`、`exportUrl` 去掉 `variant`。
- `Editor.tsx`：Gesture 型別去掉 `variant`；`send(base, ops)` 呼叫 `apply_ops` 不帶 `variant`；`preview(base, ops)`；`getVariant(x).cells` → `x.cells`；`bounce`／hover key 去掉 `activeVariant`。`isForbidden` 的形狀鎖判斷先保留介面但改成永遠回傳 `false`（Task 2 再整個刪掉）。
- `AppShell.tsx`：`variant` 改用 `shown`；用量標題 `用量`；清高亮的 effect 依賴去掉 `variantId`。
- `ChecksPanel.tsx`：`runChecks(deferred, {…})`。
- `Preview3D.tsx`：`bbox(d, d.cells)`、`drawIso(ctx, design, palette, …)`。
- `DeductDialog.tsx`：`planDeduction(design.cells, …)`；`deduct_inventory` 只帶 `designId`；文案「「{design.name}」用掉的豆子…」。
- `ExportMenu.tsx`、`ImportOverlay.tsx`：先改到能編譯（`getVariant` 移除、`variant` 參數移除）；介面調整留給 Task 2。
- `tests/web/*.test.ts`、`e2e/fixtures.ts`：`variants.find(...)` → `cells`；`editorState.test.ts` 的 pending 去掉 `variant`。

Run: `pnpm typecheck && pnpm vitest run` — Expected: 全部 PASS、型別無錯。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: a design is a single set of cells (drop variants, palette modes, shape lock, mask)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 網頁移除版本與鎖定介面

**Files:**
- Delete: `src/web/components/VariantTabs.tsx`（與 `app.css` 中 `.variant-*` 樣式）
- Modify: `src/web/components/{TopBar,ExportMenu,ImportOverlay,BoardDialog,Editor}.tsx`, `src/web/styles/app.css`
- Test: `tests/web/exportFileName.test.ts`, `tests/web/api.test.ts`, `tests/web/bounce.test.ts`（測試名稱）, `e2e/{topbar,editor,checks,connect-import}.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `ClientDesign`（`cells`，無版本／鎖定欄位）。
- Produces: `exportFileName(designName: string, styleLabel: string): string` → `` `${safe(designName)}-${safe(styleLabel)}.png` ``。

- [ ] **Step 1: 先改測試**

- `tests/web/exportFileName.test.ts`：`exportFileName('貓', '施工圖')` → `'貓-施工圖.png'`。
- `tests/web/api.test.ts`：`exportUrl('d-1', { view: 'pattern', scale: 2 })` → `'/api/designs/d-1/export.png?view=pattern&scale=2'`。
- e2e：
  - `topbar.spec.ts`：刪除「只換色」與「新增有的色版本」兩個測試；匯出測試改成斷言 `href` 含 `view=pattern` 且不含 `variant`，檔名不含版本名稱；新增 `await expect(page.getByRole('tab')).toHaveCount(0)`（沒有版本分頁）。
  - `editor.spec.ts`：刪除「a variant switch in the middle of a stroke …」。
  - `checks.spec.ts`：「switching design or variant clears the highlight」改成只測換作品。
  - `connect-import.spec.ts`：測試名稱去掉 variant；刪除 `shapeLocked` 斷言與鎖定卡片相關步驟。

Run: `pnpm vitest run tests/web` — Expected: FAIL（`exportFileName` 簽名）。

- [ ] **Step 2: 改元件**

- `TopBar.tsx`：移除 `VariantTabs` 與「可增減／只換色」seg 控制（含 import）。
- `ExportMenu.tsx`：移除 scope（目前版本／全部版本）選擇；`exportUrl(design.id, { view, scale: 2 })`；`exportFileName(design.name, style.file)`。
- `ImportOverlay.tsx`：移除 `shape_locked` 分支、`locked` 卡片、`set_shape_lock` 解鎖流程；「轉換到」那行改成「轉換到：目前作品（會覆蓋原內容）」。
- `BoardDialog.tsx`：移除 `{ kind: 'locked' }` 步驟與解鎖按鈕、`shape_locked` 錯誤處理。
- `Editor.tsx`：刪除 `isForbidden` 與 `blocked` 相關繪製（游標框固定用 `tokens.inkSoft`）。
- 刪除 `VariantTabs.tsx` 與 `app.css` 中只給它和鎖定 seg 用的樣式（用 grep 確認沒有其他使用者）。

Run: `pnpm typecheck && pnpm vitest run && pnpm build:web && pnpm test:e2e` — Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): remove variant tabs, shape lock and multi-variant export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Skill、知識庫、README

**Files:**
- Modify: `.claude/skills/bead-design/SKILL.md`, `.claude/skills/bead-design/knowledge/color.md`, `.claude/skills/bead-design/knowledge/structure.md`, `.claude/skills/bead-design/CHANGELOG.md`, `README.md`, `tests/skill.test.ts`

- [ ] **Step 1: 更新 skill 測試**

`tests/skill.test.ts` 的 `TOOLS` 改成 `['get_design', 'describe_design', 'render_preview', 'get_palette', 'run_checks', 'apply_ops', 'snapshot', 'set_board', 'import_image']`，並新增：
```ts
it('does not mention removed variant tools', () => {
  for (const t of ['create_variant', 'set_variant_mode', 'select_variant', 'set_shape_lock']) expect(skill).not.toContain(t);
});
```
Run: `pnpm vitest run tests/skill.test.ts` — Expected: FAIL。

- [ ] **Step 2: 改 SKILL.md**

- 「開始前」：第 2 點改成「`get_palette` 取得所有顏色與庫存數」；新增一點：
  > 設計前問使用者兩件事並記住答案：①只用有的顏色嗎？②只用有的數量嗎？（工具不會替你擋，靠你自己把關）
- 「設計流程」最後的「配色版本」步驟刪除，改成「**照庫存把關**」迴圈：
  > 1. 使用者要求只用有的顏色時，只挑 `get_palette` 中庫存 > 0 的色號；`import_image` 的 `colors` 填這些色號。
  > 2. 畫完看檢查結果：只用有的顏色時，「沒有庫存」代表用錯色；只用有的數量時，「庫存不足」代表超量。
  > 3. 用 `replace_color` 等 op 換成最接近的可用色（同色系優先，見 `knowledge/color.md`），再看一次檢查結果，直到沒有這兩類問題。使用者沒限制的面向，缺料提醒只告知、不必修。
  > 4. 使用者中途改主意，同樣用一般 op 改色。
- 「錯誤處理」刪除 `color_not_allowed`、`shape_locked` 兩條。
- 「做完作品」：`deduct_inventory` 說明去掉 `variant`。
- `knowledge/structure.md`：「自動配色（`create_variant`、`import_image`、版本同步）」改成「自動對色（`import_image`）」。
- `knowledge/color.md`：最後一條改成「換成有的顏色時，若主色會變到差很遠的顏色，優先挑同色系的其他顏色手動 `replace_color`。」
- `CHANGELOG.md` 最上方：`- 2026-11-12：移除配色版本與形狀鎖定；「只用有的顏色／數量」改為設計前詢問使用者，依檢查器結果自行修正（使用者：「AI 大概是：抓有的色->抓庫存->開始畫->抓檢查器結果->用錯色或超過數量->修改->直到檢查器無誤」）。`

- [ ] **Step 3: README**

網頁介面段落去掉版本／只換色的描述（若有）；新增一句「作品只有一組設計；缺少的顏色或數量會在檢查結果中提醒。」

Run: `pnpm vitest run` — Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(skill): design loop checks owned colors and stock via the checker; drop variant steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
