import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ClientDesign as Design } from '../../core/model';
import { callTool, toolError, type DesignSummary, type HistoryDepth } from '../lib/api';
import { MOD } from '../lib/keyboard';
import type { ConnState } from '../lib/serverState';
import { PREF_LABEL, useThemePref, type ThemePref } from '../lib/theme';
import { ConnectAI } from './ConnectAI';
import { DesignMenu } from './DesignMenu';
import { ExportMenu } from './ExportMenu';
import type { Notice } from './ImportOverlay';
import { SnapshotMenu } from './SnapshotMenu';

/** 外觀按鈕的圖示：跟隨系統＝半邊亮半邊暗、亮＝太陽、暗＝月亮 */
const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  dark: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
};

type Props = {
  design: Design | null; designs: DesignSummary[]; history: HistoryDepth | null; editable: boolean;
  conn: ConnState; mcpUrl: string | null;
  /** 工具列以外的結果（例如導入圖片）：和伺服器拒絕的說明用同一個提示條 */
  notice: Notice | null; onCloseNotice(): void;
  onNewDesign(): void;
};

/** 上方工具列：作品選單｜配色版本分頁｜形狀鎖定、復原／重做、快照、匯出｜連接 AI、外觀。伺服器拒絕時在工具列下方顯示提示條 */
export function TopBar({ design, designs, history, editable, conn, mcpUrl, notice, onCloseNotice, onNewDesign }: Props) {
  const [themePref, cycleTheme] = useThemePref();
  const themeLabel = `外觀：${PREF_LABEL[themePref]}`;
  const [error, setError] = useState<string | null>(null);
  const designId = design?.id;
  useEffect(() => setError(null), [designId]);

  // 工具列上的修改都走這裡：失敗時顯示伺服器的說明，成功就清掉舊的提示
  // 新的動作開始時，舊的導入結果就收起來
  const act = useCallback(async (name: string, args: Record<string, unknown>) => {
    onCloseNotice();
    const res = await callTool(name, args);
    setError(res.ok ? null : toolError(res.text).message);
    return res;
  }, [onCloseNotice]);
  // 導入圖片有了新結果：蓋過舊的拒絕說明
  useEffect(() => { if (notice) setError(null); }, [notice]);
  const banner: Notice | null = error ? { text: error, tone: 'alert' } : notice;

  const off = !editable;
  // 沒有步驟可復原／重做：用 aria-disabled（按鈕還能保有焦點，按到最後一步時焦點不會掉出去）
  const noUndo = history?.undo === 0, noRedo = history?.redo === 0;
  return (
    <header className="topbar">
      <span className="brand"><span className="brand-bead" aria-hidden="true" />拼豆工作室</span>
      <DesignMenu
        name={design?.name ?? null} currentId={design?.id ?? null} designs={designs} disabled={off}
        act={act} onNewDesign={onNewDesign}
      />
      {design && (
        <>
          <span className="topbar-spacer" />
          <div className="topbar-group">
            <button
              type="button" className="icon-btn" aria-label="復原" title={`復原（${MOD}Z）`} disabled={off} aria-disabled={noUndo || undefined}
              onClick={() => { if (!noUndo) void act('undo', { designId: design.id }); }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 5 4 8.5 7.5 12" /><path d="M4.5 8.5h7a4 4 0 0 1 0 8H9" /></svg>
            </button>
            <button
              type="button" className="icon-btn" aria-label="重做" title={`重做（${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Shift+Z'}）`} disabled={off} aria-disabled={noRedo || undefined}
              onClick={() => { if (!noRedo) void act('redo', { designId: design.id }); }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 5 16 8.5 12.5 12" /><path d="M15.5 8.5h-7a4 4 0 0 0 0 8H11" /></svg>
            </button>
          </div>
          <SnapshotMenu design={design} disabled={off} act={act} />
          <ExportMenu design={design} disabled={off} />
        </>
      )}
      {!design && <span className="topbar-spacer" />}
      <ConnectAI conn={conn} mcpUrl={mcpUrl} />
      <button type="button" className="icon-btn theme-btn" aria-label={themeLabel} title={themeLabel} onClick={cycleTheme}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{THEME_ICON[themePref]}</svg>
      </button>
      {banner && (
        <div className={`topbar-alert${banner.tone === 'info' ? ' is-info' : ''}`} role={banner.tone === 'info' ? 'status' : 'alert'}>
          <span className="topbar-alert-text">{banner.text}</span>
          <button type="button" className="icon-btn" aria-label="關閉提示" onClick={() => (error ? setError(null) : onCloseNotice())}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
          </button>
        </div>
      )}
    </header>
  );
}
