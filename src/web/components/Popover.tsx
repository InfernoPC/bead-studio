// 工具列的下拉選單／小表單：固定定位在觸發按鈕下方（不受工具列裁切），點外面或按 Esc 關閉。
// 按鍵不往外傳：輸入框裡的 ⌘Z、單鍵工具快捷鍵、檢查器的 Esc 取消標示都不會跟著反應。
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

const GAP = 6, EDGE = 8;
const FOCUSABLE = '[role^="menuitem"]:not([aria-disabled="true"]), input:not(:disabled), button:not(:disabled), a[href]';

type Props = {
  /** 選單（方向鍵移動）或小表單 */
  kind: 'menu' | 'dialog';
  label: string;
  anchor: RefObject<HTMLElement | null>;
  /** 對齊觸發按鈕的左緣或右緣 */
  align?: 'start' | 'end';
  /** 關閉時是否把焦點還給觸發按鈕：Esc 與選了項目時要，點外面時不要（焦點跟著使用者點的地方走） */
  onClose(returnFocus: boolean): void;
  className?: string;
  children: ReactNode;
};

export function Popover({ kind, label, anchor, align = 'start', onClose, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current!, a = anchor.current;
    if (!a) return;
    // 直接寫進 style（繪製前完成），下一行才能把焦點移進來
    const r = a.getBoundingClientRect(), w = el.offsetWidth;
    const want = align === 'end' ? r.right - w : r.left;
    el.style.top = `${r.bottom + GAP}px`;
    el.style.left = `${Math.max(EDGE, Math.min(want, window.innerWidth - w - EDGE))}px`;
    // 開啟時焦點移進來：選單到目前項目（沒有就第一項），表單到第一個欄位
    const first = el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [anchor, align]);

  useLayoutEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current(false);
    };
    const onResize = () => close.current(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('resize', onResize); };
  }, [anchor]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); close.current(true); return; }
    if (kind !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={ref} role={kind} aria-label={label} className={`popover${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
      // Tab 離開（焦點移到外面）就收起來
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !ref.current?.contains(to) && !anchor.current?.contains(to)) close.current(false);
      }}
    >
      {children}
    </div>
  );
}

/** 觸發按鈕＋開關狀態；關閉時視情況把焦點還給按鈕 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { open, setOpen, close, toggle, trigger };
}
