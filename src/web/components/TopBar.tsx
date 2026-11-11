import type { ReactNode } from 'react';
import { PREF_LABEL, useThemePref, type ThemePref } from '../lib/theme';

/** 外觀按鈕的圖示：跟隨系統＝半邊亮半邊暗、亮＝太陽、暗＝月亮 */
const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  dark: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
};

/** 上方工具列：品牌與目前作品名稱、右側的外觀切換；作品選單、版本、匯出等在 Task 12 加入 */
export function TopBar({ designName }: { designName: string | null }) {
  const [themePref, cycleTheme] = useThemePref();
  const themeLabel = `外觀：${PREF_LABEL[themePref]}`;
  return (
    <header className="topbar">
      <span className="brand"><span className="brand-bead" aria-hidden="true" />拼豆工作室</span>
      {designName
        ? <h1 className="design-name" data-testid="design-name">{designName}</h1>
        : <span className="design-name muted">沒有開啟的作品</span>}
      <span className="topbar-spacer" />
      <button type="button" className="icon-btn theme-btn" aria-label={themeLabel} title={themeLabel} onClick={cycleTheme}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{THEME_ICON[themePref]}</svg>
      </button>
    </header>
  );
}
