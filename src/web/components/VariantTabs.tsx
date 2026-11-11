// 配色版本分頁：每個版本一個分頁（名稱＋色彩範圍小字），點選切換；
// 右鍵或目前分頁旁的「⋯」改色彩範圍；「＋」開小表單建立新版本
import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Design } from '../../core/model';
import type { PaletteMode } from '../../core/palette';
import type { ToolResult } from '../lib/api';
import { Popover, usePopover } from './Popover';

export const MODE_LABEL: Record<PaletteMode, string> = { all: '理想', owned: '有的色', stock: '庫存' };
const MODE_HINT: Record<PaletteMode, string> = { all: '用所有色號', owned: '只用我有的顏色', stock: '照庫存數量分配' };
const MODES: PaletteMode[] = ['all', 'owned', 'stock'];

type Act = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
type Props = { design: Design; disabled: boolean; act: Act };

export function VariantTabs({ design, disabled, act }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // 改色彩範圍的選單：記住是哪個版本、從哪個元素開的（右鍵＝分頁本身，或「⋯」）
  const modeAnchor = useRef<HTMLElement | null>(null);
  const [modeFor, setModeFor] = useState<string | null>(null);
  const add = usePopover();
  const moreRef = useRef<HTMLButtonElement>(null);

  const openModeMenu = (variantId: string, anchor: HTMLElement) => { modeAnchor.current = anchor; setModeFor(variantId); };
  const closeModeMenu = (returnFocus: boolean) => {
    setModeFor(null);
    if (returnFocus) modeAnchor.current?.focus();
  };
  const modeVariant = design.variants.find((v) => v.id === modeFor);

  // 方向鍵在分頁間移動焦點；Enter／空白鍵才切換（切換會寫入伺服器，不跟著焦點自動切）
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = Array.from(listRef.current!.querySelectorAll<HTMLElement>('[role="tab"]'));
    const i = tabs.indexOf(e.currentTarget);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  };

  return (
    <div className="variants">
      <div ref={listRef} role="tablist" aria-label="配色版本" className="variant-tabs">
        {design.variants.map((v) => {
          const active = v.id === design.activeVariant;
          return (
            <button
              key={v.id} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
              className="variant-tab" disabled={disabled} title="右鍵可以改色彩範圍"
              onClick={() => { if (!active) void act('select_variant', { designId: design.id, variant: v.id }); }}
              onContextMenu={(e) => { e.preventDefault(); if (!disabled) openModeMenu(v.id, e.currentTarget); }}
              onKeyDown={onTabKey}
            >
              <span className="variant-name">{v.name}</span>
              <span className="variant-mode">{MODE_LABEL[v.paletteMode]}</span>
            </button>
          );
        })}
      </div>
      <button
        ref={moreRef} type="button" className="icon-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={!!modeFor}
        aria-label={`變更「${design.variants.find((v) => v.id === design.activeVariant)?.name ?? ''}」的色彩範圍`}
        title="變更色彩範圍"
        onClick={(e) => (modeFor ? closeModeMenu(false) : openModeMenu(design.activeVariant, e.currentTarget))}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r=".9" /><circle cx="10" cy="10" r=".9" /><circle cx="15" cy="10" r=".9" /></svg>
      </button>
      <button
        ref={add.trigger} type="button" className="icon-btn" disabled={disabled} aria-haspopup="dialog" aria-expanded={add.open}
        aria-label="新增配色版本" title="新增配色版本" onClick={add.toggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
      </button>

      {modeVariant && (
        <Popover key={modeVariant.id} kind="menu" label={`「${modeVariant.name}」的色彩範圍`} anchor={modeAnchor} onClose={closeModeMenu}>
          {MODES.map((m) => (
            <button
              key={m} type="button" role="menuitemradio" aria-checked={modeVariant.paletteMode === m} className="menu-item" tabIndex={-1}
              onClick={() => {
                closeModeMenu(true);
                if (m !== modeVariant.paletteMode) void act('set_variant_mode', { designId: design.id, variant: modeVariant.id, paletteMode: m });
              }}
            >
              <svg className="menu-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
              <span className="menu-item-text">{MODE_LABEL[m]}</span>
              <span className="menu-item-hint">{MODE_HINT[m]}</span>
            </button>
          ))}
        </Popover>
      )}
      {add.open && <NewVariantForm design={design} act={act} anchor={add.trigger} onClose={add.close} />}
    </div>
  );
}

function NewVariantForm({ design, act, anchor, onClose }: {
  design: Design; act: Act; anchor: RefObject<HTMLButtonElement | null>; onClose(returnFocus: boolean): void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PaletteMode>('owned');
  const busy = useRef(false); // 送出中只擋重複送出，不停用按鈕（焦點才不會掉出去）
  const modeId = useId();
  const fallback = `${MODE_LABEL[mode]}版`;

  const create = async () => {
    if (busy.current) return; busy.current = true;
    const res = await act('create_variant', { designId: design.id, name: name.trim() || fallback, paletteMode: mode });
    busy.current = false;
    if (!res.ok) return;
    onClose(true);
    // 建好就切過去看
    const id = /版本\s*(v\d+)/.exec(res.text)?.[1];
    if (id) void act('select_variant', { designId: design.id, variant: id });
  };

  return (
    <Popover kind="dialog" label="新增配色版本" anchor={anchor} align="end" onClose={onClose} className="pop-form">
      <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label className="field">
          <span className="field-label">名稱</span>
          <input type="text" className="field-input" autoComplete="off" placeholder={fallback} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label" id={modeId}>色彩範圍</span>
          <div className="seg" role="group" aria-labelledby={modeId}>
            {MODES.map((m) => (
              <button key={m} type="button" className="seg-btn" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <span className="field-hint">{MODE_HINT[mode]}，從目前的版本複製後自動換色。</span>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn-primary">建立版本</button>
        </div>
      </form>
    </Popover>
  );
}
