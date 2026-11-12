// 拖曳導入圖片：檔案拖進視窗時蓋上「放開以導入圖片」。
// PNG 直接上傳（伺服器判斷有沒有可還原的作品資料：有就還原成新作品，沒有就轉換到目前作品）；
// 其他圖片先問轉換選項。形狀鎖定時選項卡改成說明與「解鎖形狀」。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientDesign as Design } from '../../core/model';
import { toolError, uploadImport } from '../lib/api';
import { Dialog } from './Dialog';

export type Notice = { text: string; tone: 'info' | 'alert' };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function isPng(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return PNG_SIG.every((b, i) => head[i] === b);
  } catch {
    return file.type === 'image/png';
  }
}

/** 拖出視窗時等多久沒有後續拖曳事件才收起（HTML 規範的 dragover 間隔最長約 550ms） */
const LEAVE_GRACE_MS = 600;

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
/** 其他對話框開著時不接收拖曳（背後的畫面是 inert 的） */
const modalOpen = () => !!document.querySelector('dialog[open]');

type Props = {
  design: Design | null; editable: boolean;
  onNotice(n: Notice | null): void;
};

export function ImportOverlay({ design, editable, onNotice }: Props) {
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeBg, setRemoveBg] = useState(false);
  const [dither, setDither] = useState(false);

  // 事件處理器裡要讀最新的值，但監聽器只掛一次
  const latest = useRef({ design, editable });
  latest.current = { design, editable };

  // 轉換結果後面附的「檢查：」清單和右側檢查器重複，提示條只留前面的說明（含降級提示）
  const report = useCallback((res: { ok: boolean; text: string }) => {
    const text = res.ok ? res.text.split('\n檢查：')[0] : toolError(res.text).message;
    onNotice({ text, tone: res.ok ? 'info' : 'alert' });
  }, [onNotice]);

  const onFile = useCallback(async (file: File) => {
    const { design: d, editable: on } = latest.current;
    if (!on) return;
    const png = await isPng(file);
    if (!png && !file.type.startsWith('image/')) {
      onNotice({ text: '只能導入圖片檔，例如 PNG 或 JPG。', tone: 'alert' });
      return;
    }
    if (!png) {
      if (!d) { onNotice({ text: '先建立作品，圖片會轉換到作品的板子上。', tone: 'alert' }); return; }
      setPending(file);
      return;
    }
    onNotice({ text: '正在導入圖片…', tone: 'info' });
    const res = await uploadImport(file);
    const code = res.ok ? null : toolError(res.text).code;
    if (code === 'no_design') {
      onNotice({ text: '這張 PNG 不是拼豆工作室匯出的作品。先建立作品，圖片會轉換到作品的板子上。', tone: 'alert' });
      return;
    }
    report(res);
  }, [onNotice, report]);

  // 只理會帶檔案的拖曳（文字、頁面元素不算）；用計數器處理經過子元素時的 dragenter／dragleave 閃爍。
  // 計數器可能對不上（例如拖出視窗、瀏覽器漏送事件），所以另外有幾個收起的出口：
  // 離開視窗（dragleave 的 relatedTarget 是 null）、按 Esc、或指標在沒有拖曳時移動
  useEffect(() => {
    let depth = 0;
    let on = false;
    let leaveTimer = 0;
    const show = () => { clearTimeout(leaveTimer); on = true; setDragging(true); };
    const reset = () => { clearTimeout(leaveTimer); depth = 0; if (on) { on = false; setDragging(false); } };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || modalOpen()) return;
      e.preventDefault();
      depth++;
      show();
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // 不讓瀏覽器自己開啟檔案
      e.dataTransfer!.dropEffect = latest.current.editable && !modalOpen() ? 'copy' : 'none';
      clearTimeout(leaveTimer); // 還在頁面上拖曳
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e) || depth === 0) return;
      depth--;
      if (depth === 0) { reset(); return; }
      // relatedTarget 是 null：拖出視窗了。Safari 在子元素之間移動時也是 null，所以稍等一下，
      // 之後還有 dragenter／dragover 就表示仍在頁面上
      if (e.relatedTarget === null) {
        clearTimeout(leaveTimer);
        leaveTimer = window.setTimeout(reset, LEAVE_GRACE_MS);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      const file = e.dataTransfer!.files[0];
      if (file && !modalOpen()) void onFile(file);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') reset(); };
    // 拖曳期間瀏覽器不送 pointermove；收到就表示拖曳早就結束了
    const onPointerMove = () => { if (on) reset(); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      clearTimeout(leaveTimer);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [onFile]);

  // 離線或作品不見了：選項卡對不上，收起來
  const designId = design?.id;
  const close = useCallback(() => setPending(null), []);
  useEffect(() => { if (!editable) close(); }, [editable, close]);
  useEffect(() => close(), [designId, close]);

  const start = async () => {
    if (!pending || !design) return;
    setBusy(true);
    const res = await uploadImport(pending, { removeBg, dither });
    setBusy(false);
    close();
    report(res);
  };

  const off = busy || !editable;
  return (
    <>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className={`drop-target${editable ? '' : ' is-off'}`}>
            <svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
            {editable ? '放開以導入圖片' : '連不上伺服器，暫時不能導入圖片'}
          </div>
        </div>
      )}
      <Dialog open={!!pending && !!design} title="導入圖片" onClose={close} className="import-card">
        {pending && design && (
          <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
            <p className="import-file">{pending.name}</p>
            <p className="import-target">轉換到：目前作品<span className="muted">（{design.name}）</span></p>
            <div className="import-options">
              <label className="check">
                <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
                <span>去除背景<span className="field-hint">把圖片四周的底色當成空白，不放豆子</span></span>
              </label>
              <label className="check">
                <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} />
                <span>抖色<span className="field-hint">用相近的顏色交錯排列，模擬漸層</span></span>
              </label>
            </div>
            <p className="modal-note">會取代這個作品目前的豆子，之後可以復原。</p>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={close}>取消</button>
              <button type="submit" className="btn-primary" disabled={off}>{busy ? '轉換中…' : '開始轉換'}</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
