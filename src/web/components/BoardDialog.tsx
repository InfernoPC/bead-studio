// 面板設定（點狀態列的尺寸文字開啟）：寬高 mm、豆子尺寸、留邊；欄位與「建立新作品」共用。
// 會裁掉豆子時先問；形狀鎖定時說明原因並提供「解鎖形狀」。
import { useEffect, useId, useRef, useState } from 'react';
import { gridSize, type BeadSize, type Board, type Design } from '../../core/model';
import { MAX_BOARD_MM } from '../../core/opSchema';
import { callTool, toolError } from '../lib/api';
import { Dialog } from './Dialog';

export type BoardForm = { widthMm: string; heightMm: string; bead: BeadSize; margin: string };

export const boardForm = (b: Board): BoardForm =>
  ({ widthMm: String(b.widthMm), heightMm: String(b.heightMm), bead: b.bead, margin: String(b.margin) });

/** 表單轉成數值；不合法的欄位回傳 null */
export function parseBoard(f: BoardForm): Board | null {
  const w = Number(f.widthMm), h = Number(f.heightMm), m = Number(f.margin);
  const mmOk = (x: number) => f.widthMm.trim() !== '' && Number.isFinite(x) && x > 0 && x <= MAX_BOARD_MM;
  if (!mmOk(w) || !mmOk(h) || f.margin.trim() === '' || !Number.isInteger(m) || m < 0) return null;
  return { widthMm: w, heightMm: h, bead: f.bead, margin: m };
}

type FieldsProps = {
  form: BoardForm; onChange(f: BoardForm): void;
  /** 換豆子尺寸、保持格數時，寬高由格數決定，欄位顯示換算後的值且不能改 */
  lockedMm?: { widthMm: number; heightMm: number } | null;
  grid: { cols: number; rows: number } | null;
};

export function BoardFields({ form, onChange, lockedMm, grid }: FieldsProps) {
  const id = useId();
  const set = (patch: Partial<BoardForm>) => onChange({ ...form, ...patch });
  const mm = (key: 'widthMm' | 'heightMm', label: string) => (
    <label className="field" htmlFor={`${id}-${key}`}>
      <span className="field-label">{label}</span>
      <input
        id={`${id}-${key}`} type="number" inputMode="decimal" min={1} max={MAX_BOARD_MM} step="any" className="field-input num"
        value={lockedMm ? String(lockedMm[key]) : form[key]} disabled={!!lockedMm}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="board-fields">
      <div className="field-row">
        {mm('widthMm', '寬（mm）')}
        <span className="field-times" aria-hidden="true">×</span>
        {mm('heightMm', '高（mm）')}
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label" id={`${id}-bead`}>豆子</span>
          <div className="seg seg-2" role="group" aria-labelledby={`${id}-bead`}>
            {([2.6, 5] as const).map((b) => (
              <button key={b} type="button" className="seg-btn" aria-pressed={form.bead === b} onClick={() => set({ bead: b })}>{b} mm</button>
            ))}
          </div>
        </div>
        <label className="field field-narrow" htmlFor={`${id}-margin`}>
          <span className="field-label">留邊格數</span>
          <input
            id={`${id}-margin`} type="number" inputMode="numeric" min={0} step={1} className="field-input num"
            value={form.margin} onChange={(e) => set({ margin: e.target.value })}
          />
        </label>
      </div>
      <p className="board-grid num" aria-live="polite">
        {grid ? `= ${grid.cols} × ${grid.rows} 格` : <span className="is-short">寬高要大於 0、不超過 {MAX_BOARD_MM} mm；留邊是 0 以上的整數。</span>}
      </p>
    </div>
  );
}

type Keep = 'cells' | 'size';
type Step = { kind: 'form' } | { kind: 'crop'; count: number } | { kind: 'locked'; reason: string } | { kind: 'error'; text: string };

type Props = { open: boolean; design: Design; onClose(): void };

export function BoardDialog({ open, design, onClose }: Props) {
  // 內容只在開啟時掛上：每次開啟都從目前的面板重新開始
  return (
    <Dialog open={open} title="面板設定" onClose={onClose}>
      <BoardSettings design={design} onClose={onClose} />
    </Dialog>
  );
}

function BoardSettings({ design, onClose }: Omit<Props, 'open'>) {
  const [form, setForm] = useState<BoardForm>(() => boardForm(design.board));
  const [keep, setKeep] = useState<Keep>('cells');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const busy = useRef(false); // 送出中只擋重複送出，不停用按鈕（焦點才不會掉出去）
  const keepId = useId();
  // 切換「確認裁切」與表單時，焦點放到新畫面上不會消失的按鈕
  const backRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const cropping = step.kind === 'crop';
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    (cropping ? backRef : submitRef).current?.focus();
  }, [cropping]);

  const beadChanged = form.bead !== design.board.bead;
  const keepCells = beadChanged && keep === 'cells';
  // 保持格數：寬高 = 原格數 × 新豆子尺寸（伺服器也是這樣換算）
  const lockedMm = keepCells
    ? { widthMm: +(design.cols * form.bead).toFixed(2), heightMm: +(design.rows * form.bead).toFixed(2) } : null;
  const board = parseBoard(lockedMm ? { ...form, widthMm: String(lockedMm.widthMm), heightMm: String(lockedMm.heightMm) } : form);
  const grid = board ? gridSize(board) : null;

  const apply = async (force: boolean) => {
    if (!board) return;
    if (busy.current) return; busy.current = true;
    const res = await callTool('set_board', { designId: design.id, ...board, keep, force });
    busy.current = false;
    if (res.ok) { onClose(); return; }
    const err = toolError(res.text);
    if (err.code === 'would_crop') {
      const n = /裁掉\s*(\d+)\s*顆/.exec(err.message)?.[1];
      setStep({ kind: 'crop', count: n ? Number(n) : 0 });
    } else if (err.code === 'shape_locked') setStep({ kind: 'locked', reason: err.message });
    else setStep({ kind: 'error', text: err.message });
  };

  const unlock = async () => {
    if (busy.current) return; busy.current = true;
    const res = await callTool('set_shape_lock', { designId: design.id, locked: false });
    busy.current = false;
    setStep(res.ok ? { kind: 'form' } : { kind: 'error', text: toolError(res.text).message });
  };

  const onFormChange = (f: BoardForm) => { setForm(f); if (step.kind !== 'form') setStep({ kind: 'form' }); };

  return step.kind === 'crop' ? (
    <>
      <p className="modal-text" role="alert">
        {step.count ? `新尺寸會裁掉 ${step.count} 顆豆子，仍要套用嗎？` : '新尺寸會裁掉一些豆子，仍要套用嗎？'}
      </p>
      <p className="modal-note">裁掉之後可以用復原找回來。</p>
      <div className="modal-actions">
        <button ref={backRef} type="button" className="btn-quiet" onClick={() => setStep({ kind: 'form' })}>返回修改</button>
        <button type="button" className="btn-primary is-danger" onClick={() => void apply(true)}>裁切並套用</button>
      </div>
    </>
  ) : (
    <form onSubmit={(e) => { e.preventDefault(); void apply(false); }}>
      <BoardFields form={form} onChange={onFormChange} lockedMm={lockedMm} grid={grid} />
      {beadChanged && (
        <fieldset className="keep-choice">
          <legend id={keepId}>換豆子尺寸時</legend>
          <label className="radio">
            <input type="radio" name={`${keepId}-keep`} checked={keep === 'cells'} onChange={() => setKeep('cells')} />
            保持格數（實體尺寸改變）
          </label>
          <label className="radio">
            <input type="radio" name={`${keepId}-keep`} checked={keep === 'size'} onChange={() => setKeep('size')} />
            保持實體尺寸（重新取樣）
          </label>
        </fieldset>
      )}
      {step.kind === 'locked' && (
        <div className="modal-alert" role="alert">
          <p>{step.reason}</p>
          <button type="button" className="btn-quiet" onClick={() => void unlock()}>解鎖形狀</button>
        </div>
      )}
      {step.kind === 'error' && <p className="modal-alert" role="alert">{step.text}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>取消</button>
        <button ref={submitRef} type="submit" className="btn-primary" disabled={!board}>套用設定</button>
      </div>
    </form>
      );
}
