# 🫘 豆豆工作室 Bead Studio

AI 協作的拼豆（Perler／MARD）設計工具。在 Claude Code 裡請 AI 設計圖案，網頁上會即時看到 AI 畫的每一筆；你也可以在網頁上自己微調，AI 馬上讀得到。

![豆豆工作室網頁介面](docs/screenshot.png)

## 特色

- **AI 設計**：透過 MCP 提供 19 個工具，AI 可以建立作品、批次畫圖、匯入圖片、檢查結構與預覽成品。專案內附設計知識（`.claude/skills/bead-design`），涵蓋配色、描邊、明暗、掛孔與尺寸。
- **即時同步**：AI 的修改會即時出現在網頁上，不用重新整理，被改到的豆子會跳一下。網頁上的修改也走同一套工具。
- **網頁編輯器**：提供畫筆、橡皮擦、油漆桶、吸管、直線、圓形、全域換色、掛孔等工具，支援復原／重做、快照、鏡像檢視、亮暗模式，也能預覽 3D 成品。
- **庫存管理**：勾選擁有的顏色、填顆數（也能秤重換算）。用量面板會顯示每色需要多少、還缺多少；拼完作品後，按「做完了，扣庫存」會依用量扣掉庫存。
- **檢查器**：檢查留邊、浮豆、易斷的細線、掛孔位置、缺料，以及相鄰顏色太接近的地方。
- **圖片匯入**：適合卡通和線稿圖。支援去背（可指定多種背景色）、每格取主要顏色、加粗細線、清雜點、裁切與排除區塊。
- **匯出**：可匯出成品圖、施工圖、3D 預覽的 PNG。PNG 內含作品資料，拖回網頁就能還原。

## 快速開始

需要 Node.js ≥ 24 與 pnpm。

```bash
pnpm install
pnpm build:web
pnpm start          # http://localhost:5174
```

或用 Docker：

```bash
mkdir -p ~/BeadStudio        # 匯入／匯出圖片的交換資料夾
docker compose up -d --build # http://localhost:5174
docker compose logs -f       # 看 log
docker compose down          # 停止
```

- 埠只開在本機（`127.0.0.1:5174`）。
- `data/`、`config/` 掛進容器，作品與庫存都留在這個資料夾裡。AI 改了 `config/checks.json` 後，執行 `docker compose restart` 生效。
- `~/BeadStudio` 以相同的絕對路徑掛進容器。`import_image`／`export_png` 只能使用這個資料夾裡的檔案。
- 更新程式碼後，重新執行 `docker compose up -d --build`。
- 若把主機埠改成 5174 以外，記得在 `BEADS_ALLOWED_HOSTS` 加上 `localhost:新埠`。

## 連接 Claude Code

```bash
claude mcp add --transport http beads http://localhost:5174/mcp
```

在這個資料夾裡啟動 Claude Code，就會自動載入 `.claude/skills/bead-design` 的設計知識。網頁右上角的「連接 AI」也會顯示這行指令。

開始設計前，AI 會先問你兩件事：
1. 只用有的顏色嗎？
2. 只用有的數量嗎？

畫完後，它會依檢查器的缺料提醒自己修正，直到符合你的要求。

### MCP 工具

| 類別 | 工具 |
|---|---|
| 作品 | `list_designs`、`open_design`、`new_design`、`set_board` |
| 讀取與預覽 | `get_design`、`describe_design`、`render_preview`、`run_checks` |
| 修改 | `apply_ops`（一次送一整批指令，整批算一步復原）、`undo`、`redo`、`snapshot`、`restore_snapshot` |
| 顏色與庫存 | `get_palette`、`calibrate_color`、`set_inventory`、`deduct_inventory` |
| 圖片 | `import_image`、`export_png` |

`apply_ops` 的指令有：
- 繪製：`paste`（用字元畫圖）、`rect`、`ellipse`、`line`、`polygon`、`fill`
- 換色與清除：`replace_color`、`clear`
- 搬移變形：`move`、`mirror`、`rotate`
- 效果：`outline`、`gradient`、`shade`
- 掛孔：`set_hole`

### 匯入圖片的選項

| 選項 | 說明 |
|---|---|
| `removeBg` | 去掉從圖片外圍連進來的背景，被外框圍住的同色區塊（例如白色身體）會保留 |
| `bgColors`、`bgTolerance` | 另外指定背景色（例如白底外的淡藍天空），以及去背的色差容許值 |
| `colors` | 只用這些色號轉換 |
| `crop`、`exclude` | 只取原圖某一塊；把原圖上的區塊（例如文字）當背景略過 |
| `sampling: "dominant"` | 每格取最多像素對到的顏色，不會平均出灰邊 |
| `lineBoost` | 一格裡深色佔這個比例以上就整格用深色，細線不會斷（卡通建議 0.3） |
| `cleanup` | 把小於 N 顆、而且和周圍顏色相近的雜點併掉（建議 3） |
| `dither` | 抖色，用相近的顏色交錯排列來模擬漸層（適合照片） |

## 開發

```bash
pnpm dev        # 同時啟動伺服器與 Vite，開 http://localhost:5173
pnpm test       # 單元測試（vitest）
pnpm e2e        # 網頁測試（Playwright；先 pnpm build:web）
pnpm typecheck
```

技術：TypeScript、Fastify、MCP SDK（Streamable HTTP）、React、Vite、@napi-rs/canvas。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | 5174 | 伺服器埠 |
| `BEADS_VISION` | auto | `off`：render_preview 改回傳文字描述（給不能看圖的模型） |
| `BEADS_DATA_DIR` | data | 設計、色表、庫存 |
| `BEADS_CONFIG_DIR` | config | 檢查器門檻 `checks.json` |
| `BEADS_HOST` | 127.0.0.1 | 監聽位址；Docker 映像內為 `0.0.0.0` |
| `BEADS_FILES_DIR` | （不限制） | 設定後 `import_image`／`export_png` 只能使用此資料夾（絕對路徑） |
| `BEADS_HOME_DIR` | 系統家目錄 | 展開 `~` 用的家目錄（絕對路徑）；Docker 內設為主機的家目錄 |
| `BEADS_ALLOWED_HOSTS` | （空） | 額外允許的 Host（`host:port`，逗號分隔）；預設只接受 `localhost:PORT` 與 `127.0.0.1:PORT`，其他 Host／Origin 一律 403 |

## 使用者資料

以下資料都存在 `data/` 底下，不會被 commit：
- 作品：`data/designs/`
- 目前開啟的作品：`data/state.json`
- 庫存：`data/inventory.json`

只有色表 `data/palette.json` 納入版本控制，色號來源見 `data/PALETTE_SOURCES.md`。

## 授權

[MIT](LICENSE)
