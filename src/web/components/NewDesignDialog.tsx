// 建立新作品：名稱＋面板欄位（與面板設定共用），下方即時顯示換算出的格數
import { useId, useRef, useState } from 'react';
import { gridSize } from '../../core/model';
import { callTool, toolError } from '../lib/api';
import { BoardFields, parseBoard, type BoardForm } from './BoardDialog';
import { Dialog } from './Dialog';

const INITIAL: BoardForm = { widthMm: '80', heightMm: '80', bead: 2.6, margin: '2' };

export function NewDesignDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  // 內容只在開啟時掛上：每次開啟都是空白表單
  return (
    <Dialog open={open} title="建立新作品" onClose={onClose}>
      <NewDesignForm onClose={onClose} />
    </Dialog>
  );
}

function NewDesignForm({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('');
  const [form, setForm] = useState<BoardForm>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // 送出中只擋重複送出，不停用按鈕（焦點才不會掉出去）
  const id = useId();

  const board = parseBoard(form);
  const ok = board && name.trim() !== '';

  const create = async () => {
    if (!board || !ok) return;
    if (busy.current) return; busy.current = true;
    const res = await callTool('new_design', { name: name.trim(), ...board });
    busy.current = false;
    if (res.ok) onClose();
    else setError(toolError(res.text).message);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <label className="field" htmlFor={`${id}-name`}>
        <span className="field-label">名稱</span>
        <input
          id={`${id}-name`} type="text" className="field-input" placeholder="例如：蘑菇吊飾" autoComplete="off"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </label>
      <BoardFields form={form} onChange={(f) => { setForm(f); setError(null); }} grid={board ? gridSize(board) : null} />
      {error && <p className="modal-alert" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>取消</button>
        <button type="submit" className="btn-primary" disabled={!ok}>建立作品</button>
      </div>
    </form>
  );
}
