---
name: bead-design
description: 用 Bead Studio MCP 設計拼豆圖案時使用：設計流程、省 token 的操作方式、配色與結構知識，以及如何把使用者的回饋寫回知識庫
---

# 拼豆設計

## 開始前
1. `get_design` 看面板（格數、留邊、豆子尺寸、鎖定狀態、目前版本與色彩範圍）。沒有作品就 `new_design`。
2. `get_palette` 取得可用顏色（依版本的色彩範圍）。只用清單裡的色號。
3. 依 `knowledge/scale.md` 決定細節程度。
4. 若要改板子尺寸、豆子尺寸或留邊，用 `set_board`（換豆子尺寸時 `keep` 決定保持格數或實體尺寸；會裁掉豆子時需 `force: true`，先問使用者）。

## 設計流程
1. **大改前先 `snapshot`**。
2. **剪影**：用 `apply_ops` 的 `paste` 一次畫出主體輪廓與大色塊（rows 用字元畫圖），或用 `ellipse`/`polygon`。
   - 主體放在留邊範圍內，並大致置中。
3. **填色**：大面積用 `fill`／`replace_color`。
4. **描邊**：照 `knowledge/outline.md`，通常 `outline {target:"shape", color:"<深色色號>", side:"outer"}`。
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

## 檔案路徑
- `import_image`／`export_png` 的路徑用絕對路徑或 `~/` 開頭。伺服器以 Docker 執行時只能使用 `~/BeadStudio` 裡的檔案（工具說明會寫出實際資料夾）；使用者給的圖片不在裡面時，請他先放進去。

## 錯誤處理
- `apply_ops` 失敗時整批不會套用，照錯誤訊息（含 op 編號）修正後重送整批。
- `color_not_allowed` 會建議最接近的可用色；`shape_locked` 代表要先解鎖或改用換色。

## 學習與更新知識
使用者說「記住」「以後都這樣」，或糾正的是通用規則（不只這一張圖）時：
1. 直接修改對應的 `knowledge/*.md`（新增、修改或刪除規則，避免重複與矛盾）。
2. 涉及數值門檻（留邊、掛孔相鄰數、對比 ΔE、細線長度）時，同步修改專案的 `config/checks.json`，並提醒使用者重新啟動伺服器讓檢查器生效。
3. 在 `CHANGELOG.md` 最上方加一筆：`- YYYY-MM-DD：規則內容（原因／使用者原話）`。
4. 在回覆中用一兩句告訴使用者改了什麼。
