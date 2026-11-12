// 匯出：選「成品圖／施工圖／3D 預覽」，下載伺服器渲染的 PNG（含可還原的作品資料）
import { useState } from 'react';
import type { ClientDesign as Design } from '../../core/model';
import { exportUrl, type View } from '../lib/api';
import { Popover, usePopover } from './Popover';

const STYLES: { view: View; label: string; file: string }[] = [
  { view: 'flat', label: '成品圖', file: '成品圖' },
  { view: 'pattern', label: '施工圖', file: '施工圖' },
  { view: '3d', label: '3D 預覽', file: '3D預覽' },
];

/** 檔名裡不能用的字元換成「_」 */
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '作品';

export function exportFileName(designName: string, styleLabel: string) {
  return `${safe(designName)}-${safe(styleLabel)}.png`;
}

export function ExportMenu({ design, disabled }: { design: Design; disabled: boolean }) {
  const pop = usePopover();
  const [view, setView] = useState<View>('flat');
  const style = STYLES.find((s) => s.view === view)!;
  const href = exportUrl(design.id, { view, scale: 2 });
  const file = exportFileName(design.name, style.file);

  const seg = <T extends string>(label: string, items: { key: T; label: string }[], value: T, set: (v: T) => void) => (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className={`seg seg-${items.length}`} role="group" aria-label={label}>
        {items.map((it) => (
          <button key={it.key} type="button" className="seg-btn" aria-pressed={value === it.key} onClick={() => set(it.key)}>{it.label}</button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={pop.trigger} type="button" className="btn-quiet topbar-btn" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4 15.5h12" /></svg>
        匯出
      </button>
      {pop.open && (
        <Popover kind="dialog" label="匯出圖片" anchor={pop.trigger} align="end" onClose={pop.close} className="pop-form export-pop">
          {seg('樣式', STYLES.map((s) => ({ key: s.view, label: s.label })), view, setView)}
          <p className="field-hint">{`檔名：${file}`}</p>
          <div className="modal-actions">
            <a className="btn-primary" href={href} download={file} onClick={() => pop.close(true)}>下載圖片</a>
          </div>
        </Popover>
      )}
    </>
  );
}
