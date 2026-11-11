// 檢查器：即時跑 core 的 runChecks（含預覽中的筆畫）；點問題把格子標在畫布上，再點或按 Esc 取消
import { memo, useDeferredValue, useEffect, useMemo, useState, type Dispatch } from 'react';
import { runChecks, type ChecksConfig, type Issue } from '../../core/checks';
import type { Design } from '../../core/model';
import type { Inventory, PaletteColor } from '../../core/palette';
import type { EditorAction } from '../lib/editorState';
import { makeCtx } from '../lib/clientCore';

/** 筆畫預覽每一幀都會換設計：用 deferred 值讓檢查排在繪圖之後，結果同一份輸入只算一次 */
export function useIssues(design: Design | null, palette: PaletteColor[] | undefined, inventory: Inventory | undefined, config: ChecksConfig | undefined): Issue[] {
  const deferred = useDeferredValue(design);
  return useMemo(() => {
    if (!deferred || !palette || !inventory || !config) return [];
    const { palette: pal } = makeCtx({ palette, inventory });
    return runChecks(deferred, deferred.activeVariant, { palette: pal, inventory, config });
  }, [deferred, palette, inventory, config]);
}

type Props = { issues: Issue[]; highlightCells: [number, number][] | null; dispatch: Dispatch<EditorAction> };

export const ChecksPanel = memo(function ChecksPanel({ issues, highlightCells, dispatch }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = highlightCells ? activeId : null;

  // 畫布上的標示被別處清掉（Esc、換作品）就同步取消選取
  useEffect(() => { if (!highlightCells) setActiveId(null); }, [highlightCells]);
  // 設計改變後，被選的問題還在就更新它的格子；已經解決就取消
  useEffect(() => {
    if (!activeId) return;
    const still = issues.find((i) => i.id + i.message === activeId);
    if (!still) { setActiveId(null); dispatch({ type: 'highlightCells', cells: null }); }
    else dispatch({ type: 'highlightCells', cells: still.cells });
  }, [issues]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!highlightCells) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      dispatch({ type: 'highlightCells', cells: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [highlightCells, dispatch]);

  if (issues.length === 0) return <p className="panel-note checks-ok">沒有發現問題</p>;
  return (
    <ul className="checks-list">
      {issues.map((issue) => {
        const key = issue.id + issue.message;
        const on = active === key;
        return (
          <li key={key}>
            <button
              type="button" className={`checks-row${on ? ' is-active' : ''}`} aria-pressed={on}
              onClick={() => {
                setActiveId(on ? null : key);
                dispatch({ type: 'highlightCells', cells: on ? null : issue.cells });
              }}
            >
              <svg className="checks-icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3.5l7 12.5H3z" /><path d="M10 8.5v3.2M10 13.8v.1" />
              </svg>
              <span className="checks-msg">{issue.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
