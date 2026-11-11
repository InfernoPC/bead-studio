# 豆豆工作室（Bead Studio）設計規格

日期：2026-11-11
狀態：待使用者審閱

## 1. 目標

個人使用的拼豆設計工具。99% 的設計由 AI（Claude Code，透過 MCP）完成，使用者在網頁上微調，最後照圖拼出實體作品。

**成功標準**
- AI 能在少量 token 下完成設計：讀圖用壓縮文字，改圖用高階批次指令，不逐點操作
- 使用者能在網頁上直覺地微調，即時看到每色用量、庫存是否足夠、設計問題
- 產出的設計一定拼得出來（「只用庫存量」模式）
- 匯出的 PNG 可再拖回 App 完整還原
- 設計知識以 skill 形式累積，AI 可依使用者回饋自行修改

## 2. 已確認的決策

| 項目 | 決策 |
|---|---|
| AI 客戶端 | Claude Code（本機 CLI） |
| 架構 | 單一 Node/TypeScript 伺服器：網頁 UI + WebSocket 同步 + MCP（Streamable HTTP，`/mcp`） |
| 狀態歸屬 | 伺服器是唯一事實來源；瀏覽器與 AI 都透過同一套 ops 修改 |
| 面板 | 以實體尺寸（mm）＋豆子尺寸（2.6 / 5mm）設定，自動換算格數；隨時可改 |
| 留邊 | 可設定 N 格；違反時只警告不阻擋 |
| 色彩範圍 | 三段：全部 MARD／只用有的色號／只用庫存量 |
| 形狀鎖定 | 🔓 可增減豆子／🔒 只能換色（伺服器強制） |
| 配色版本 | 同一設計檔內多個版本，共用形狀 mask |
| 匯出 | 可選「目前顯示的版本」或「全部版本」 |
| UI 風格 | A 奶油手作（暖奶油底、柔和陰影、圓角） |
| 豆子渲染 | B 霧面圓柱（柔和漸層＋中孔） |
| 編輯／預覽 | 編輯區純平面；3D 只用於實體預覽（可縮放、旋轉、隱藏釘板、燙後效果） |
| 看圖替代 | `describe_design` 結構化文字；`render_preview` 支援 `vision: auto/on/off` |
| Skill 更新 | AI 直接修改，事後告知；git 可回退 |

## 3. 架構

```
┌──────────── Browser (React) ────────────┐
│ 平面編輯器 │ 色票/用量/檢查器 │ 3D 預覽   │
└──────────────▲───────────┬──────────────┘
         WS 推送狀態    WS 送出 ops
┌──────────────┴───────────▼──────────────┐
│        Node 伺服器（Fastify）             │
│  ┌─────────── core（純 TS）───────────┐  │
│  │ model · ops · constraints · color  │  │
│  │ checks · codec(RLE/PNG) · import   │  │
│  │ describe · render(平面/3D)          │  │
│  └────────────────────────────────────┘  │
│  DesignStore（JSON 檔＋undo 歷史）        │
│  MCP server（/mcp, Streamable HTTP）      │
└──────────────▲──────────────────────────┘
               │ MCP
          Claude Code ── .claude/skills/bead-design/
```

- `core/` 為純 TypeScript、無 I/O，前後端共用。瀏覽器與 AI 的每個修改都轉成 op 交給伺服器的 core 執行，結果一致。
- 伺服器依序套用 ops，每次變更後版本號 +1，並透過 WebSocket 廣播給所有已開啟的頁面。
- 「目前作品」由伺服器記錄（瀏覽器開哪個，AI 預設就操作哪個）。

### 技術選型
- Node 22、TypeScript、pnpm
- 前端：Vite + React，Canvas 2D 繪圖（平面與 3D 預覽皆為自寫投影，參考已確認的 mockup）
- 後端：Fastify + `ws`
- MCP：`@modelcontextprotocol/sdk`，Streamable HTTP transport
- 伺服器端渲染：`@napi-rs/canvas`（預編譯，無需本機編譯環境），與前端共用繪圖程式碼
- PNG metadata：`pngjs` 讀寫 `zTXt` chunk
- 測試：Vitest（core／伺服器）、Playwright（UI 冒煙測試）

### 目錄結構
```
bead-studio/
├─ src/core/        純邏輯（共用）
├─ src/server/      Fastify、WS、MCP、DesignStore
├─ src/web/         React UI
├─ data/            designs/*.json、palette.json、inventory.json（使用者資料）
├─ config/checks.json
└─ .claude/skills/bead-design/
```

啟動：`pnpm start`（預設 `http://localhost:5174`）。
連接 Claude Code：`claude mcp add --transport http beads http://localhost:5174/mcp`

## 4. 資料模型

### 設計檔 `data/designs/<id>.json`
```ts
type Design = {
  id: string; name: string; version: number;
  board: { widthMm: number; heightMm: number; bead: 2.6 | 5; margin: number };
  // 格數由 board 推得：floor(widthMm / bead)，存一份方便讀取
  cols: number; rows: number;
  mask: string;            // 長度 cols*rows，'1' 有豆 / '0' 空，所有版本共用
  variants: Variant[];
  activeVariant: string;
  shapeLocked: boolean;
  markers: { type: 'hole'; x: number; y: number }[];
  snapshots: { id: string; name: string; at: string; design: Omit<Design,'snapshots'> }[];
};
type Variant = {
  id: string; name: string;
  paletteMode: 'all' | 'owned' | 'stock';
  cells: (string | null)[]; // 每格色號（例 "A07"），mask 為 0 的格子為 null
};
```

**行為規則**
- 新增豆子：mask 設 1；目前版本填所選顏色；其他版本依各自色彩範圍自動配最接近的顏色（CIEDE2000）。
- 移除豆子：mask 設 0，所有版本清空該格。
- 改面板尺寸：設計保持置中；若會裁掉豆子，先警告並需確認（UI 確認框；MCP 需帶 `force: true`）。
- 切換豆子尺寸：二選一——保持格數（實體尺寸改變）或保持實體尺寸（最近鄰重新取樣成新格數）。

### 全域資料
- `data/palette.json`：`{ code, name, series, hex, calibratedHex?, transparent? }[]`。顯示時優先使用 `calibratedHex`。
- `data/inventory.json`：`{ [code]: { owned: boolean; count: number } }`。
- `config/checks.json`：檢查器門檻（見 §7）。

### 復原與快照
- 每個設計在伺服器記憶體保留最近 200 步 undo/redo。一次 `apply_ops` 呼叫或一次 UI 筆畫算一步。
- 快照會寫進設計檔，伺服器重啟後仍在。

## 5. 網頁 UI（依 layout-v4 mockup）

- **上方工具列**：作品選單、配色版本分頁（＋新增）、🔓/🔒 切換、復原／重做、快照、匯出
- **左側工具**：畫筆、橡皮擦、油漆桶、吸管、直線、框選／移動、全域換色、掛孔標記、鏡像檢視（背面，只改變顯示）
- **中央平面編輯區**：霧面豆渲染、座標尺、每 5 格輔助線、留邊虛線、掛孔紅圈、超出留邊的豆子加紅框；滾輪縮放、空白鍵＋拖曳平移；狀態列顯示格數、實體尺寸、豆子尺寸、縮放比例
- **右側面板**
  - 色票：目前顏色、篩選（全部 MARD／我有的／有庫存）、搜尋（色號或名稱）、色票格子（沒有的顏色變淡並加斜線）、最近用過 8 色、「⚙ 管理庫存」入口
  - 用量：目前版本實際用到的顏色，依數量排序，顯示「用量 / 庫存」，不足以紅字標示；點選即選色
  - 檢查器：即時更新，點項目會在畫布暗化其他區域並以黃圈標出問題格
  - 3D 實體預覽：釘板顯示開關、燙後效果開關、傾斜滑桿、拖曳旋轉、滾輪縮放、可放大成全螢幕；顯示實體尺寸
- **庫存管理頁**：所有 MARD 色依系列排列，勾選是否擁有、填顆數、校正顏色（調色盤或輸入 hex）
- **單色高亮**：在用量清單長按（或右鍵）某色，只顯示該色的位置，方便拼的時候找

## 6. 匯出與導入

- **匯出 PNG**，三種樣式可選：
  - 成品圖（霧面豆渲染）
  - 施工圖（每格標色號縮寫＋座標尺＋底部用量表）
  - 3D 預覽圖
- 範圍：目前版本，或全部版本並排在同一張圖。
- 每張 PNG 都把完整的 Design JSON 壓縮寫入 `zTXt`（keyword: `bead-studio`）。
- **拖曳導入**：PNG 含 `bead-studio` metadata → 還原為新設計；否則進入圖片轉換流程。
- **圖片轉換**（core 共用，UI 和 MCP `import_image` 都用這套）：
  1. 依面板可用區域（扣掉留邊）等比例縮放
  2. 可選去背：依角落顏色或 alpha 判斷
  3. 依色彩範圍以 CIEDE2000 對色，可選 Floyd–Steinberg 抖色
  4. 「只用庫存量」模式下，套用庫存分配（見下方）

**庫存分配演算法**：先依最近色指派；對超出庫存的顏色，把色差代價最小的格子依序改指派到下一個最接近、仍有庫存的顏色，直到全部滿足。若總庫存不足，回報無法達成及缺少的顆數。

## 7. 檢查器（core/checks）

| 檢查 | 規則 | 門檻（`config/checks.json`） |
|---|---|---|
| 超出留邊 | 豆子位於外圈 margin 格內 | 使用 board.margin |
| 孤立浮豆 | 四鄰皆空 | — |
| 細線易斷 | 只靠單一相鄰豆連接的長鏈 | `thinChainMin`: 4 |
| 掛孔補強 | 掛孔四鄰中有豆的數量不足（太靠邊），或離外側太深（掛環穿不過） | `holeMinNeighbors`: 4、`holeMaxInset`: 1 |
| 庫存不足 | 用量 > 庫存 | — |
| 對比過低 | 相鄰不同色的 ΔE00 過小 | `minAdjacentDeltaE`: 10 |

每個問題附帶格子座標清單，給 UI 標示，也給 AI 修正用。

## 8. MCP 工具

所有工具預設作用於「目前作品」；可帶 `designId` 指定其他作品。

### 讀取
- `get_design({variant?, region?})`：只回傳 bbox 內容，每列 RLE 壓縮，加上單字元色號對照表。例：
  ```
  30x30 margin=2 bead=2.6 locked=false variant=理想版(all)
  bbox=(8,7)-(20,18)  legend: a=A07 b=H02 c=H07 d=B03
  y7: 4.5c4.
  y8: 2.2c2a1b2a2c2.
  ```
- `render_preview({view:'flat'|'3d'|'ironed', variant?|'all', scale?})`：回傳 PNG 圖片。`vision=off` 時改回傳 `describe_design` 內容。
- `describe_design({variant?})`：尺寸與位置、左右／上下對稱度（附不對稱的格子）、每色的顆數／連通塊數／範圍／位置描述、外框是否封閉、相鄰低對比色對、縮圖（2×2 合 1 的文字縮圖）。
- `get_palette({mode})`：每色一行 `A07 西瓜紅 #E8434F 庫存200`。
- `run_checks({variant?})`

### 修改
- `apply_ops({ops, variant?})`：整串一次套用（原子性，算一個 undo 步驟）。回傳每色用量變化＋檢查器警告摘要，不回傳整張格子。

| op | 參數 |
|---|---|
| `paste` | `x, y, rows: string[], legend: {char: code}`（`.` 為不動、`_` 為清除） |
| `rect` / `ellipse` | `x, y, w, h, color, fill?: boolean` |
| `line` | `x1, y1, x2, y2, color` |
| `polygon` | `points, color, fill?` |
| `fill` | `x, y, color`（四連通油漆桶） |
| `replace_color` | `from, to, region?` |
| `clear` | `region` |
| `move` / `mirror` / `rotate` | `region, dx/dy` ／ `axis` ／ `turns` |
| `outline` | `target: 'shape'\|code, color, side: 'outer'\|'inner'` |
| `gradient` | `region\|target, colors[], direction: 'h'\|'v'\|'radial'\|angle, dither?` |
| `shade` | `target: code, light: 'tl'\|'t'\|…, highlight: code, shadow: code, depth?` |
| `set_hole` | `x, y` |
| `set_board` | `widthMm?, heightMm?, bead?, margin?, keep: 'cells'\|'size', force?` |

### 配色版本與圖片
- `create_variant({name, paletteMode, from})`
- `set_variant_mode({variant, paletteMode})`：切換後重新對色。
- `import_image({path, removeBg?, dither?, variant?})`
- `set_shape_lock({locked})`

### 作品管理
`list_designs`、`open_design`、`new_design({name, board})`、`snapshot({name})`、`restore_snapshot`、`undo`、`redo`

### 伺服器端的限制
- 形狀鎖定時：任何會改變 mask 的 op 讓整串 ops 被拒絕，錯誤訊息列出是哪條 op、影響哪些格子。
- 色彩範圍外的顏色：拒絕，並回傳最接近的可用色建議。
- 留邊：不阻擋，只在摘要中警告。

## 9. Skill：`.claude/skills/bead-design/`

```
SKILL.md          設計流程與規則
knowledge/color.md      漸層、配色、對比、MARD 實際色感
knowledge/shading.md    光源、亮暗部、色階
knowledge/outline.md    描邊時機、粗細、顏色
knowledge/structure.md  掛孔補透明豆、浮豆、細線、燙豆
knowledge/scale.md      不同格數的細節程度
recipes/*.md            可直接 paste 的小圖塊（眼睛、腮紅、星星…）
CHANGELOG.md            學到的規則：日期、內容、原因
```

**SKILL.md 設計流程**：讀取面板、庫存與色彩範圍 → 依 scale.md 定細節程度 → 剪影（paste）→ 填色 → 描邊 → 明暗處理 → `run_checks` 並修正 → `render_preview` 或 `describe_design` 自我檢查，再修一輪 → 鎖定形狀 → 產生其他配色版本。

**知識更新規則**：使用者說「記住」「以後都這樣」，或糾正的內容屬於通用規則時，AI 直接修改對應的知識檔，在 CHANGELOG.md 加一筆紀錄，並在回覆中說明改了什麼。若規則涉及數值門檻，同步修改 `config/checks.json`。

第一版預先寫入：漸層、亮暗部、掛孔補透明豆、浮豆與細線、30 格級別的細節建議。

## 10. 錯誤處理

- 所有 ops 先完整驗證，任一條失敗就整串不套用；錯誤訊息具體到 op 的索引與原因，方便 AI 一次修正。
- 設計檔寫入採「先寫暫存檔再改名」，避免寫到一半損毀。
- 導入的 PNG metadata 解析失敗時，降級為一般圖片轉換，並提示使用者。
- WebSocket 斷線時，UI 顯示「離線」並停用編輯；重連後抓取最新狀態。

## 11. 測試

- **core 單元測試（Vitest）**：每個 op、形狀鎖定與色彩範圍限制、RLE 編解碼、CIEDE2000、庫存分配、各項檢查、describe 輸出、PNG metadata 往返、面板尺寸變更與重新取樣
- **伺服器整合測試**：用 MCP client 呼叫每個工具；驗證 WS 廣播；undo/redo
- **UI 冒煙測試（Playwright）**：畫一筆會更新用量與 3D 預覽；匯出後再導入，結果一致

## 12. MARD 色表

網路上的 MARD hex 版本不一。第一版從公開來源整理出一份 `palette.json`（含系列與名稱），並在 UI 提供校正功能。實作時會列出資料來源；有疑慮的顏色標記為「未校正」。

## 13. 不在第一版範圍

- 大圖自動分成多塊板子（目前以小型作品、單塊板為主；之後可加）
- 遠端／多人使用、帳號
- 手機版 UI
- 列印排版（施工圖 PNG 可直接列印）
