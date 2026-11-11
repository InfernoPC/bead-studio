// 置中的 modal 對話框（<dialog> showModal）。和 3D 預覽的「放大」同一套規則：
// 按鍵不往外傳（工具列快捷鍵、⌘Z、檢查器的 Esc 都不反應），Esc 關閉，關閉後焦點明確回到開啟它的元素。
import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
};

export function Dialog({ open, title, onClose, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dlg.showModal();
    }
    // 不依賴瀏覽器還原焦點（Safari／macOS Firefox 點按鈕不會讓按鈕取得焦點）
    if (!open && dlg.open) { dlg.close(); opener.current?.focus(); }
  }, [open]);

  return (
    <dialog
      ref={ref} className={`modal${className ? ` ${className}` : ''}`} aria-labelledby={titleId}
      onClose={() => { if (open) { onClose(); opener.current?.focus(); } }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); onClose(); }
      }}
    >
      {open && (
        <div className="modal-body">
          <h2 id={titleId} className="modal-title">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
