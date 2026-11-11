// 用量面板：目前配色版本每個顏色用了幾顆、庫存夠不夠；點列選色，右鍵或長按只看這個顏色
import { memo, useEffect, useMemo, useRef, type Dispatch, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import type { Inventory, PaletteColor } from '../../core/palette';
import type { EditorAction } from '../lib/editorState';
import { usageRows } from '../lib/trayModel';
import { BeadDot, useBeadInk } from './BeadTray';

const LONG_PRESS_MS = 500;

type Props = {
  cells: (string | null)[]; palette: PaletteColor[]; inventory: Inventory;
  color: string | null; highlightCode: string | null; dispatch: Dispatch<EditorAction>;
  /** 面板底部的動作（Task 14：「做完了，扣庫存」） */
  footer?: ReactNode;
};

export function usageTotal(cells: (string | null)[]): number {
  return cells.reduce((n, c) => n + (c ? 1 : 0), 0);
}

export const UsagePanel = memo(function UsagePanel({ cells, palette, inventory, color, highlightCode, dispatch, footer }: Props) {
  const ink = useBeadInk();
  const rows = useMemo(() => usageRows(cells, inventory), [cells, inventory]);
  const byCode = useMemo(() => new Map(palette.map((p) => [p.code, p])), [palette]);

  // 長按計時器觸發時要讀到最新的高亮狀態
  const live = useRef(highlightCode);
  live.current = highlightCode;
  const toggleHighlight = (code: string) => dispatch({ type: 'highlightCode', code: live.current === code ? null : code });
  // 長按：計時到了就切換高亮，並吞掉放開時的 click（不要同時選色）
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const cancelPress = () => { if (press.current) clearTimeout(press.current.timer); };
  useEffect(() => cancelPress, []);

  // 事件委派到整個清單，由 data-code 找出是哪一列
  const codeOf = (t: EventTarget) => (t as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code;
  const onClick = (e: MouseEvent<HTMLUListElement>) => {
    const code = codeOf(e.target);
    if (!code) return;
    const longPressed = press.current?.fired && e.detail !== 0; // detail 0 = 鍵盤觸發
    press.current = null;
    if (!longPressed) dispatch({ type: 'pickColor', code });
  };
  const onContextMenu = (e: MouseEvent<HTMLUListElement>) => {
    const code = codeOf(e.target);
    if (!code) return;
    // 觸控長按時瀏覽器也可能送 contextmenu：同一次按壓只切換一次
    e.preventDefault();
    cancelPress();
    if (press.current?.fired) return;
    if (press.current) press.current.fired = true;
    toggleHighlight(code);
  };
  const onPointerDown = (e: PointerEvent<HTMLUListElement>) => {
    cancelPress();
    press.current = null; // 每次按下都重新開始，不沿用上一次沒收尾的長按
    const code = codeOf(e.target);
    if (!code || e.pointerType === 'mouse') return; // 滑鼠用右鍵
    const state = { fired: false, timer: setTimeout(() => { state.fired = true; toggleHighlight(code); }, LONG_PRESS_MS) };
    press.current = state;
  };

  if (rows.length === 0) return <p className="panel-note">這個版本還沒有豆子。選一個顏色開始畫吧。</p>;

  return (
    <div className="usage">
      <ul
        className="usage-list" aria-label="各顏色用量"
        onClick={onClick} onContextMenu={onContextMenu} onPointerDown={onPointerDown}
        onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress}
      >
        {rows.map((r) => {
          const p = byCode.get(r.code);
          const name = p?.name ?? '不在色票裡';
          const label = `${r.code} ${name}，用了 ${r.used} 顆，庫存 ${r.stock} 顆${r.short ? `，缺 ${r.short} 顆` : ''}`;
          const cls = ['usage-row', r.code === color && 'is-current', r.code === highlightCode && 'is-highlight'].filter(Boolean).join(' ');
          return (
            <li key={r.code}>
              <button type="button" className={cls} data-code={r.code} aria-label={label} aria-current={r.code === color || undefined}>
                {p
                  ? <BeadDot hex={p.calibratedHex ?? p.hex} transparent={!!p.transparent} size={18} ink={ink} />
                  : <span className="bead-unknown" aria-hidden="true" />}
                <span className="usage-code">{r.code}</span>
                <span className="usage-name">{name}</span>
                <span className="usage-count num">
                  {r.used} / <span className={r.short ? 'is-short' : undefined}>{r.stock}</span>
                </span>
                {r.short > 0 && <span className="usage-short num">缺 {r.short}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="usage-hint" aria-live="polite">
        {highlightCode
          ? <>正在只看 <b>{highlightCode}</b>。在同一列按右鍵或長按就恢復。</>
          : '在一列上按右鍵或長按，可以只看這個顏色。'}
      </p>
      {footer && <div className="usage-footer">{footer}</div>}
    </div>
  );
});
