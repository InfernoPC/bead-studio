// 檢查器：即時跑 core 的 runChecks（含預覽中的筆畫）；點問題把格子標在畫布上，再點或按 Esc 取消
import { memo, useDeferredValue, useEffect, useMemo, useState, type Dispatch, type ReactNode } from 'react';
import { runChecks, type ChecksConfig, type Issue } from '../../core/checks';
import type { Design } from '../../core/model';
import { Palette, type Inventory, type PaletteColor } from '../../core/palette';
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

/** 選取用的穩定識別：同一類問題的數量會變，所以用種類加上能分辨「是哪一個」的內容（庫存看色號、掛孔看座標） */
export function issueKey(i: Issue): string {
  if (i.id === 'stock') return `stock:${i.message.match(/^(\S+)/)?.[1] ?? ''}`;
  if (i.id === 'hole') return `hole:${i.message.match(/\((\d+),(\d+)\)/)?.slice(1, 3).join(',') ?? ''}`;
  return i.id;
}

/** core 的座標是 0 起算；畫布尺規從 1 開始，面板跟尺規一致 */
function oneBased(message: string): string {
  return message.replace(/\((\d+),(\d+)\)/g, (_, x, y) => `(${+x + 1},${+y + 1})`);
}

/** 低對比：「A1↔A2 ΔE=3.2、…」→ 每組一行「A1 和 A2 的顏色太接近」；格式對不上就回 null，改顯示原文 */
function contrastPairs(message: string): [string, string][] | null {
  const body = message.split('：')[1];
  if (!body) return null;
  const pairs = body.split('、').map((p) => p.match(/^(\S+)↔(\S+) ΔE=/));
  if (!pairs.length || pairs.some((m) => !m)) return null;
  return pairs.map((m) => [m![1], m![2]]);
}

type Props = { issues: Issue[]; palette: PaletteColor[]; highlightCells: [number, number][] | null; dispatch: Dispatch<EditorAction> };

export const ChecksPanel = memo(function ChecksPanel({ issues, palette, highlightCells, dispatch }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const colors = useMemo(() => new Palette(palette), [palette]);
  const dot = (code: string) => <span className="checks-dot" style={{ background: colors.get(code)?.displayHex }} />;

  // 畫布上的標示被別處清掉（Esc、換作品、換版本）就同步取消選取
  useEffect(() => { if (!highlightCells) setActiveKey(null); }, [highlightCells]);
  // 設計改變後，被選的問題還在就更新它的格子；已經解決就取消
  useEffect(() => {
    if (!activeKey) return;
    const still = issues.find((i) => issueKey(i) === activeKey);
    if (!still) setActiveKey(null);
    dispatch({ type: 'highlightCells', cells: still ? still.cells : null });
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
  const active = highlightCells ? activeKey : null;

  const text = (issue: Issue): ReactNode => {
    if (issue.id === 'low_contrast') {
      const pairs = contrastPairs(issue.message);
      if (pairs) {
        return pairs.map(([a, b]) => (
          <span className="checks-line" key={a + b}>{dot(a)}{dot(b)}<span>{a} 和 {b} 的顏色太接近，邊界看不清</span></span>
        ));
      }
    }
    return oneBased(issue.message);
  };

  return (
    <>
      <ul className="checks-list">
        {issues.map((issue) => {
          const key = issueKey(issue);
          const on = active === key;
          return (
            <li key={key}>
              <button
                type="button" className={`checks-row${on ? ' is-active' : ''}`} aria-pressed={on} title={issue.message}
                onClick={() => {
                  setActiveKey(on ? null : key);
                  dispatch({ type: 'highlightCells', cells: on ? null : issue.cells });
                }}
              >
                <svg className="checks-icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 3.5l7 12.5H3z" /><path d="M10 8.5v3.2M10 13.8v.1" />
                </svg>
                <span className="checks-msg">{text(issue)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="panel-note checks-hint">點一列可在畫布上標出位置，再點一次或按 Esc 取消</p>
    </>
  );
});
