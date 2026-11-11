// 「做完了，扣庫存」的確認對話框：列出每色會扣多少，確認後呼叫 deduct_inventory（和 AI 用的是同一個工具）。
// 庫存不在作品的復原紀錄裡，所以先講清楚會扣什麼、之後去哪裡調整
import { useState } from 'react';
import { getVariant, type Design } from '../../core/model';
import { planDeduction, type Inventory, type PaletteColor } from '../../core/palette';
import { callTool, toolError } from '../lib/api';
import { BeadDot, useBeadInk } from './BeadTray';
import { Dialog } from './Dialog';
import type { Notice } from './ImportOverlay';

type Props = {
  open: boolean; design: Design; palette: PaletteColor[]; inventory: Inventory;
  onClose(): void; onDone(n: Notice): void;
};

export function DeductDialog({ open, onClose, ...rest }: Props) {
  return (
    <Dialog open={open} title="做完了，扣庫存" onClose={onClose} className="deduct-dialog">
      <DeductBody onClose={onClose} {...rest} />
    </Dialog>
  );
}

function DeductBody({ design, palette, inventory, onClose, onDone }: Omit<Props, 'open'>) {
  const ink = useBeadInk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const variant = getVariant(design);
  const plan = planDeduction(variant.cells, inventory);
  const byCode = new Map(palette.map((p) => [p.code, p]));

  const confirm = async () => {
    if (busy || plan.deducted.length === 0) return;
    setBusy(true);
    const res = await callTool('deduct_inventory', { designId: design.id, variant: variant.id });
    setBusy(false);
    if (!res.ok) { setError(toolError(res.text).message); return; }
    onDone({ text: res.text, tone: 'info' });
    onClose();
  };

  return (
    <>
      {plan.deducted.length > 0 ? (
        <>
          <p className="modal-text">「{design.name}」（{variant.name}）用掉的豆子會從庫存扣掉：</p>
          <ul className="deduct-list" aria-label="每色扣除量">
            {plan.deducted.map((r) => {
              const p = byCode.get(r.code);
              const out = r.after === 0;
              return (
                <li key={r.code} className="deduct-row">
                  {p && <BeadDot hex={p.calibratedHex ?? p.hex} transparent={!!p.transparent} size={18} ink={ink} />}
                  <span className="usage-code">{r.code}</span>
                  <span className="usage-name">{p?.name}</span>
                  <span className="deduct-amount num">扣 {r.before - r.after}</span>
                  <span className={`deduct-after num${out ? ' is-short' : ''}`}>
                    {r.before} → {r.after}{out ? '（用完）' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="modal-text">「{design.name}」（{variant.name}）沒有用到你登記擁有的顏色，沒有東西可以扣。</p>
      )}
      {plan.skipped.length > 0 && (
        <p className="modal-note">未擁有的色號不受影響：{plan.skipped.map((r) => r.code).join('、')}</p>
      )}
      <p className="modal-note">扣庫存不能用「復原」撤回；扣錯了可以到庫存頁調整。</p>
      {error && <p className="modal-alert" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>取消</button>
        <button type="button" className="btn-primary" disabled={busy || plan.deducted.length === 0} onClick={() => void confirm()}>
          {busy ? '正在扣除…' : '扣除庫存'}
        </button>
      </div>
    </>
  );
}
