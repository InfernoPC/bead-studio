# 單一設計（移除配色版本）設計文件

日期：2026-11-12
取代：`2026-11-11-bead-studio-design.md` 中「配色版本」「形狀鎖定」相關的部分

## 動機

目前一個作品有多個配色版本（理想／有的色／庫存），網頁上可以切換版本的色彩範圍。問題：

- 切換模式是拿「目前的顏色」重新對色，來回切幾次後原本的顏色就回不來了（實際發生：白豆被庫存數量限制換成米白，再切回來也不會恢復）。
- 版本名稱（「理想版」）和實際模式（有的色）可以不一致，容易誤會。
- 匯出、復原紀錄、用量都要處理「哪個版本」，複雜但用處不大。

使用者的想法：**作品就是一組設計**，缺不缺料交給檢查器比對庫存。「只用有的顏色」「只用有的數量」是 **AI 設計時要問使用者的兩個問題**，不是作品的屬性。

## 決定

1. 作品只有一組 `cells`，沒有版本、沒有 `activeVariant`。
2. 移除形狀鎖定（`shapeLocked`、「只換色」）——它只是為了讓各版本形狀一致。
3. 移除 `mask` 欄位（可從 `cells` 推得）。
4. 不相容舊格式：舊的作品檔不修改、不刪除；新程式讀不懂就照現有行為略過並在 log 警告。舊 PNG metadata 也一樣，當成一般圖片轉換（現有的 fallback）。
5. 「只用有的顏色」「只用有的數量」不存在作品裡，只作為工具參數；AI 在對話中記住使用者的回答。

## 資料模型

```ts
type DesignCore = {
  id: string; name: string; version: number; board: Board; cols: number; rows: number;
  cells: (string | null)[]; markers: Marker[];
};
type Design = DesignCore & { snapshots: Snapshot[] };
```

- `designSchema` 跟著改：`cells.length === cols*rows`，不再檢查 mask／版本。
- PNG metadata 寫入新的格式（換一個 metadata 鍵或加 `format: 2`），讀到舊格式就當一般圖片。

## 兩個面向：只靠 AI 記憶

「只用有的顏色」「只用有的數量」**不做成任何工具參數、不存在作品裡**。AI 設計前問使用者，並在對話中記住答案，自己挑色、自己檢查：

- 挑色：`get_palette` 照舊列出每個色號的庫存數（`mode` 參數移除，永遠列全部），AI 只挑有庫存的。
- 匯入圖片：用現有的 `import_image colors`，填使用者有的色號。
- 數量：看 `apply_ops` 回傳的檢查結果（缺料提醒），超量就用 `replace_color` 等 op 換掉。
- 使用者改主意：AI 用一般的 op（`replace_color` 等）改色，跟其他修改一樣可復原。

工具不再依「色彩範圍」擋顏色：任何色表上的顏色都能用，缺料由檢查器提醒。

## 移除的工具與參數

- 工具：`create_variant`、`set_variant_mode`、`select_variant`、`set_shape_lock`。
- 參數：所有工具的 `variant`；`render_preview` 的 `variant: "all"`；`deduct_inventory` 的 `variant`；`get_palette` 的 `mode`。
- 色彩範圍檢查：`apply_ops` 的 `color_not_allowed`／`stock_exceeded`、`import_image` 依模式限色與照庫存分配（`allocate` 若無其他用途一併移除）。
- `get_design` 標頭去掉 `locked=` 與 `variant=`。
- `ops.ts` 的 `syncOtherVariants`、形狀鎖檢查；`variants.ts` 整個檔案。
- HTTP：`/api/designs/:id/export.png` 與 `/api/import` 的 `variant` query。

## 網頁

- 移除版本分頁（`VariantTabs`）、模式選單、「＋」新增版本。
- 移除頂部的「只換色」切換，以及匯入／面板設定裡「先解除鎖定」的提示流程；`Editor` 的形狀鎖擋筆邏輯一併移除。
- 匯出選單只匯出目前的設計（拿掉「全部版本」）；檔名去掉版本名稱。
- 用量面板標題改回「用量」；扣庫存對話框不再顯示版本名稱。
- 色票、庫存頁、檢查器（含缺料提醒）不變。

## Skill（bead-design）

- 「開始前」新增：設計前問使用者兩件事——①只用有的顏色嗎？②只用有的數量嗎？記住答案：挑色只挑有庫存的、`import_image` 的 `colors` 填有的色號、看檢查結果的缺料提醒調整用量；使用者改主意就用 `replace_color` 等 op 改色。
- 刪除「配色版本」步驟（`set_shape_lock`、`create_variant`）。
- `knowledge/color.md`：「有的色／庫存版重新對色」那條改寫成「換成有的顏色時，主色差太多就改用同色系手動換」。
- `deduct_inventory` 說明去掉 variant。
- README 更新工具與網頁說明。

## 測試

- 刪除／改寫版本相關測試（`variants.test.ts`、`ops`／`mcp`／`model`／`designSchema`／`board`／`render`／`textCodec` 中的版本案例、e2e topbar 的版本分頁）。
- 新增：
  - 不帶任何限制時，`apply_ops`／`import_image` 可以用沒有庫存的顏色，檢查結果列出缺料。
  - `get_palette` 列出全部色號與庫存數。
  - 載入舊格式檔案：略過且檔案內容不變。
  - e2e：沒有版本分頁、匯出單一設計、扣庫存流程照常。

## 不在範圍內

- 舊作品的轉換工具。
- `shade` 範圍限制、`resize_design`（另案）。
