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
| `BEADS_ALLOWED_HOSTS` | （空） | 額外允許的 Host（`host:port`，逗號分隔）；預設只接受 `localhost:PORT` 與 `127.0.0.1:PORT`，其他 Host／Origin 一律 403 |
