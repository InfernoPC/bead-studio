/** 上方工具列：品牌與目前作品名稱；作品選單、版本、匯出等在 Task 12 加入 */
export function TopBar({ designName }: { designName: string | null }) {
  return (
    <header className="topbar">
      <span className="brand"><span className="brand-bead" aria-hidden="true" />拼豆工作室</span>
      {designName
        ? <h1 className="design-name" data-testid="design-name">{designName}</h1>
        : <span className="design-name muted">沒有開啟的作品</span>}
      <span className="topbar-spacer" />
    </header>
  );
}
