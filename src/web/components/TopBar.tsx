import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Design } from '../../core/model';
import { callTool, toolError, type DesignSummary } from '../lib/api';
import { PREF_LABEL, useThemePref, type ThemePref } from '../lib/theme';
import { DesignMenu } from './DesignMenu';
import { ExportMenu } from './ExportMenu';
import { SnapshotMenu } from './SnapshotMenu';
import { VariantTabs } from './VariantTabs';

/** 外觀按鈕的圖示：跟隨系統＝半邊亮半邊暗、亮＝太陽、暗＝月亮 */
const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  dark: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
};

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

type Props = {
  design: Design | null; designs: DesignSummary[]; editable: boolean;
  onNewDesign(): void;
};

/** 上方工具列：作品選單｜配色版本分頁｜形狀鎖定、復原／重做、快照、匯出｜外觀。伺服器拒絕時在工具列下方顯示提示條 */
export function TopBar({ design, designs, editable, onNewDesign }: Props) {
  const [themePref, cycleTheme] = useThemePref();
  const themeLabel = `外觀：${PREF_LABEL[themePref]}`;
  const [error, setError] = useState<string | null>(null);
  const designId = design?.id;
  useEffect(() => setError(null), [designId]);

  // 工具列上的修改都走這裡：失敗時顯示伺服器的說明，成功就清掉舊的提示
  const act = useCallback(async (name: string, args: Record<string, unknown>) => {
    const res = await callTool(name, args);
    setError(res.ok ? null : toolError(res.text).message);
    return res;
  }, []);

  const off = !editable;
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
          <VariantTabs design={design} disabled={off} act={act} />
          <span className="topbar-spacer" />
          <div className="seg seg-2 shape-lock" role="group" aria-label="形狀" title="鎖定後只能換顏色，不會增減豆子">
            {([false, true] as const).map((locked) => (
              <button
                key={String(locked)} type="button" className="seg-btn" aria-pressed={design.shapeLocked === locked} disabled={off}
                onClick={() => { if (design.shapeLocked !== locked) void act('set_shape_lock', { designId: design.id, locked }); }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3.5" y="7.5" width="9" height="6" rx="1.5" />
                  <path d={locked ? 'M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7.5V5.5a2.5 2.5 0 0 1 4.8-1'} />
                </svg>
                {locked ? '只換色' : '可增減'}
              </button>
            ))}
          </div>
          <div className="topbar-group">
            <button
              type="button" className="icon-btn" aria-label="復原" title={`復原（${MOD}Z）`} disabled={off}
              onClick={() => void act('undo', { designId: design.id })}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 5 4 8.5 7.5 12" /><path d="M4.5 8.5h7a4 4 0 0 1 0 8H9" /></svg>
            </button>
            <button
              type="button" className="icon-btn" aria-label="重做" title={`重做（${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Shift+Z'}）`} disabled={off}
              onClick={() => void act('redo', { designId: design.id })}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 5 16 8.5 12.5 12" /><path d="M15.5 8.5h-7a4 4 0 0 0 0 8H11" /></svg>
            </button>
          </div>
          <SnapshotMenu design={design} disabled={off} act={act} />
          <ExportMenu design={design} disabled={off} />
        </>
      )}
      {!design && <span className="topbar-spacer" />}
      <button type="button" className="icon-btn theme-btn" aria-label={themeLabel} title={themeLabel} onClick={cycleTheme}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{THEME_ICON[themePref]}</svg>
      </button>
      {error && (
        <div className="topbar-alert" role="alert">
          <span className="topbar-alert-text">{error}</span>
          <button type="button" className="icon-btn" aria-label="關閉提示" onClick={() => setError(null)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
          </button>
        </div>
      )}
    </header>
  );
}
