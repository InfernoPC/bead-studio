// 快照：上方「儲存快照」（名稱預設「快照 HH:mm」），下方列出已存的快照，點選後確認再還原
import { useRef, useState, type RefObject } from 'react';
import type { ClientDesign as Design, SnapshotInfo as Snapshot } from '../../core/model';
import type { ToolResult } from '../lib/api';
import { Dialog } from './Dialog';
import { Popover, usePopover } from './Popover';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const defaultSnapshotName = (now = new Date()) => `快照 ${hhmm(now)}`;

/** 今天的只顯示時間，其他日子加上月／日 */
function when(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === now.toDateString() ? hhmm(d) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
}

type Props = { design: Design; disabled: boolean; act(name: string, args: Record<string, unknown>): Promise<ToolResult> };

export function SnapshotMenu({ design, disabled, act }: Props) {
  const pop = usePopover();
  const [confirm, setConfirm] = useState<Snapshot | null>(null);
  return (
    <>
      <button
        ref={pop.trigger} type="button" className="btn-quiet topbar-btn" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6" width="14" height="10" rx="2.5" /><circle cx="10" cy="11" r="2.6" /><path d="M7.5 6 8.6 4h2.8l1.1 2" /></svg>
        快照
      </button>
      {pop.open && (
        <SnapshotPanel
          design={design} act={act} anchor={pop.trigger} onClose={pop.close}
          onPick={(s) => { pop.close(true); setConfirm(s); }}
        />
      )}
      <Dialog open={!!confirm} title="還原快照" onClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <p className="modal-text">還原到「{confirm.name}」？</p>
            <p className="modal-note">目前的內容不會消失，還原之後可以用復原找回來。</p>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setConfirm(null)}>取消</button>
              <button
                type="button" className="btn-primary"
                onClick={() => { const s = confirm; setConfirm(null); void act('restore_snapshot', { designId: design.id, snapshotId: s.id }); }}
              >還原快照</button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

type PanelProps = Pick<Props, 'design' | 'act'> & {
  anchor: RefObject<HTMLButtonElement | null>; onClose(returnFocus: boolean): void; onPick(s: Snapshot): void;
};

function SnapshotPanel({ design, act, anchor, onClose, onPick }: PanelProps) {
  const [name, setName] = useState(() => defaultSnapshotName());
  const busy = useRef(false); // 送出中只擋重複送出，不停用按鈕（焦點才不會掉出去）
  const save = async () => {
    if (busy.current) return; busy.current = true;
    const res = await act('snapshot', { designId: design.id, name: name.trim() || defaultSnapshotName() });
    busy.current = false;
    if (res.ok) setName(defaultSnapshotName());
  };
  const list = [...design.snapshots].reverse(); // 新的在上面
  return (
    <Popover kind="dialog" label="快照" anchor={anchor} align="end" onClose={onClose} className="pop-form snapshot-pop">
      <form className="snapshot-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input
          type="text" className="field-input" aria-label="快照名稱" autoComplete="off"
          value={name} onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary">儲存快照</button>
      </form>
      <p className="field-hint">大改之前先存一個，之後可以隨時回來。</p>
      {list.length > 0 ? (
        <ul className="snapshot-list" aria-label="已存的快照">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="menu-item" onClick={() => onPick(s)}>
                <span className="menu-item-text">{s.name}</span>
                <span className="menu-item-hint num">{when(s.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="panel-note snapshot-empty">還沒有快照。</p>}
    </Popover>
  );
}
