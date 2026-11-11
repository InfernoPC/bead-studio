// 庫存與校色頁（#/inventory）：依系列分段的分格豆盒，每格登記「我有」、顆數（可秤重換算）、校正顯示色。
// 勾選與顆數延遲 600ms 合併成一次 set_inventory；校色即時送 calibrate_color。
// 回到編輯頁、頁面隱藏或關閉時，還沒送出的修改立刻送出
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Inventory, PaletteColor } from '../../core/palette';
import { callTool, toolError, type StateSnapshot } from '../lib/api';
import type { ConnState } from '../lib/serverState';
import { compareCodes, traySlots, type TraySlot } from '../lib/trayModel';
import { gramsToCount, loadUnitWeights, parseWeight, saveUnitWeights, type UnitWeights } from '../lib/weight';
import { BeadDot, Pile, PILE_H, PILE_W, useBeadInk, type BeadInk } from './BeadTray';
import { OfflineBanner } from './OfflineBanner';
import { Popover } from './Popover';

const BATCH_MS = 600;
type Patch = { owned?: boolean; count?: number };
type Item = { code: string } & Patch;

/* ---------- 勾選與顆數：本機先顯示，延遲合併送出 ---------- */

/** 回傳「伺服器的庫存＋還沒被伺服器反映的本機修改」，以及修改／立即送出的函式 */
function useInventoryEdits(inventory: Inventory, onError: (msg: string | null) => void) {
  // 還沒被伺服器反映的修改（未送出＋已送出、等 meta 重新整理）
  const [overlay, setOverlay] = useState<Record<string, Patch>>({});
  const queue = useRef<Record<string, Patch>>({}); // 還沒送出的
  const awaiting = useRef<Record<string, Patch>>({}); // 已送出成功、等伺服器狀態更新的
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [inflight, setInflight] = useState(0);
  const [queued, setQueued] = useState(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const flush = useCallback((keepalive = false) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const sent = queue.current;
    const items: Item[] = Object.entries(sent).map(([code, p]) => ({ code, ...p }));
    if (items.length === 0) return;
    queue.current = {};
    setQueued(false);
    setInflight((n) => n + 1);
    void callTool('set_inventory', { items }, { keepalive }).then((res) => {
      setInflight((n) => n - 1);
      if (res.ok) {
        errorRef.current(null);
        Object.assign(awaiting.current, sent);
        return;
      }
      errorRef.current(`庫存沒有存到：${toolError(res.text).message}`);
      // 沒存到的修改恢復成伺服器上的值（之後又改過的保留）
      setOverlay((o) => {
        const n = { ...o };
        for (const code of Object.keys(sent)) if (!(code in queue.current)) delete n[code];
        return n;
      });
    });
  }, []);

  // 伺服器的庫存更新了：已送出的修改都已反映（或被更新的值蓋過），從 overlay 拿掉；之後又改過的保留
  useEffect(() => {
    const done = awaiting.current;
    awaiting.current = {};
    if (Object.keys(done).length === 0) return;
    setOverlay((o) => {
      const n = { ...o };
      for (const code of Object.keys(done)) if (!(code in queue.current)) delete n[code];
      return n;
    });
  }, [inventory]);

  const edit = useCallback((items: Item[]) => {
    setOverlay((o) => {
      const n = { ...o };
      for (const { code, ...p } of items) n[code] = { ...n[code], ...p };
      return n;
    });
    for (const { code, ...p } of items) queue.current[code] = { ...queue.current[code], ...p };
    setQueued(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), BATCH_MS);
  }, [flush]);

  // 離開庫存頁（回編輯頁）、頁面切走或關閉：馬上送出
  useEffect(() => {
    const onHide = () => flush(true);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(true); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(true);
    };
  }, [flush]);

  const merged = useMemo(() => {
    if (Object.keys(overlay).length === 0) return inventory;
    const inv: Inventory = { ...inventory };
    for (const [code, p] of Object.entries(overlay)) {
      const prev = inv[code] ?? { owned: false, count: 0 };
      inv[code] = { owned: p.owned ?? prev.owned, count: p.count ?? prev.count };
    }
    return inv;
  }, [inventory, overlay]);

  return { inventory: merged, edit, saving: inflight > 0 || queued };
}

/* ---------- 校色：即時送出；拖動色盤時同一色號只留一個請求在路上，結束後補送最新的值 ---------- */

function useCalibration(palette: PaletteColor[], onError: (msg: string | null) => void) {
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const lanes = useRef(new Map<string, { next?: string | null }>());
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const send = useCallback((code: string, hex: string | null) => {
    const lane = lanes.current.get(code);
    if (lane) { lane.next = hex; return; }
    const me: { next?: string | null } = {};
    lanes.current.set(code, me);
    void callTool('calibrate_color', { code, hex }).then((res) => {
      lanes.current.delete(code);
      if (!res.ok) errorRef.current(`校色沒有存到：${toolError(res.text).message}`);
      else errorRef.current(null);
      if (me.next !== undefined) send(code, me.next);
      else if (!res.ok) setDrafts((d) => { const n = { ...d }; delete n[code]; return n; });
    });
  }, []);

  const calibrate = useCallback((code: string, hex: string | null) => {
    setDrafts((d) => ({ ...d, [code]: hex === null ? null : hex.toUpperCase() }));
    send(code, hex);
  }, [send]);

  // 伺服器的色票已經是這個值、而且沒有請求在路上：草稿功成身退
  useEffect(() => {
    setDrafts((d) => {
      const byCode = new Map(palette.map((p) => [p.code, p]));
      let changed = false;
      const n = { ...d };
      for (const [code, hex] of Object.entries(d)) {
        if (lanes.current.has(code)) continue;
        if ((byCode.get(code)?.calibratedHex?.toUpperCase() ?? null) === hex) { delete n[code]; changed = true; }
      }
      return changed ? n : d;
    });
  }, [palette]);

  const shown = useMemo((): PaletteColor[] => {
    if (Object.keys(drafts).length === 0) return palette;
    return palette.map((p) => {
      if (!(p.code in drafts)) return p;
      const hex = drafts[p.code];
      const { calibratedHex: _c, ...rest } = p;
      return hex === null ? rest : { ...rest, calibratedHex: hex };
    });
  }, [palette, drafts]);

  return { palette: shown, calibrate };
}

/* ---------- 頁面 ---------- */

type Props = { conn: ConnState; snapshot: StateSnapshot | null };

export function InventoryPage({ conn, snapshot }: Props) {
  const editable = conn === 'online';
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div className="inv-page">
      <header className="inv-head">
        <div className="inv-head-row">
          <a className="inv-back" href="#/">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4.5 6.5 10l5.5 5.5" /></svg>
            返回編輯
          </a>
          <h1 ref={headingRef} tabIndex={-1} className="inv-title">庫存與校色</h1>
        </div>
        {error && (
          <div className="topbar-alert" role="alert">
            <span className="topbar-alert-text">{error}</span>
            <button type="button" className="icon-btn" aria-label="關閉提示" onClick={() => setError(null)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
            </button>
          </div>
        )}
      </header>
      <OfflineBanner conn={conn} />
      {snapshot
        ? <InventoryBody palette={snapshot.palette} inventory={snapshot.inventory} editable={editable} onError={setError} />
        : <p className="panel-note inv-loading">正在載入色票…</p>}
    </div>
  );
}

function InventoryBody({ palette: serverPalette, inventory: serverInv, editable, onError }: {
  palette: PaletteColor[]; inventory: Inventory; editable: boolean; onError(msg: string | null): void;
}) {
  const ink = useBeadInk();
  const { inventory, edit, saving } = useInventoryEdits(serverInv, onError);
  const { palette, calibrate } = useCalibration(serverPalette, onError);
  const [query, setQuery] = useState('');
  const [units, setUnits] = useState<UnitWeights>(() => loadUnitWeights());

  const original = useMemo(() => new Map(serverPalette.map((p) => [p.code, p.hex])), [serverPalette]);
  const calibrated = useMemo(() => new Map(palette.map((p) => [p.code, p.calibratedHex ?? null])), [palette]);
  const seriesOf = useMemo(() => new Map(palette.map((p) => [p.code, p.series])), [palette]);
  const sections = useMemo(() => {
    const groups = new Map<string, TraySlot[]>();
    // 先依系列分組，組內依色號排序（不照搜尋的「色號符合優先」，每段才整齊）
    for (const s of traySlots(palette, inventory, 'all', query)) {
      const k = seriesOf.get(s.code) ?? '';
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups].sort(([a], [b]) => compareCodes(a, b)).map(([series, slots]) => ({
      series, slots: slots.sort((a, b) => compareCodes(a.code, b.code)),
    }));
  }, [palette, inventory, query, seriesOf]);
  const seriesCodes = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of palette) m.set(p.series, [...(m.get(p.series) ?? []), p.code]);
    return m;
  }, [palette]);

  const totals = useMemo(() => {
    let colors = 0, beads = 0;
    for (const s of Object.values(inventory)) if (s.owned) { colors++; beads += s.count; }
    return { colors, beads };
  }, [inventory]);

  // 秤重：同時只開一個，錨點是被按的那顆「秤重」按鈕
  const [weighing, setWeighing] = useState<TraySlot | null>(null);
  const weighAnchor = useRef<HTMLElement | null>(null);
  const openWeigh = useCallback((slot: TraySlot, el: HTMLElement) => {
    weighAnchor.current = el;
    setWeighing((w) => (w?.code === slot.code ? null : slot));
  }, []);
  const closeWeigh = useCallback((returnFocus: boolean) => {
    setWeighing(null);
    if (returnFocus) weighAnchor.current?.focus();
  }, []);
  useEffect(() => { if (!editable) setWeighing(null); }, [editable]);

  const setOwned = useCallback((code: string, owned: boolean) => edit([{ code, owned }]), [edit]);
  const setCount = useCallback((code: string, count: number) => edit([{ code, count, ...(count > 0 ? { owned: true } : {}) }]), [edit]);

  return (
    <>
      <div className="inv-tools">
        <label className="tray-search inv-search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5l4 4" /></svg>
          <input
            type="search" value={query} placeholder="搜尋色號或顏色，例如 A07、紅" aria-label="搜尋色號或顏色"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { setQuery(''); e.stopPropagation(); } }}
          />
        </label>
        <UnitWeightFields units={units} disabled={!editable} onChange={(w) => { setUnits(w); saveUnitWeights(w); }} />
      </div>

      <fieldset className="inv-sections" disabled={!editable}>
        <legend className="sr-only">各系列的庫存</legend>
        {sections.length === 0 && <p className="tray-empty">找不到「{query.trim()}」。</p>}
        {sections.map(({ series, slots }) => {
          // 全部勾選／取消：整個系列（不只搜尋到的）
          const codes = seriesCodes.get(series) ?? [];
          const ownedCodes = codes.filter((c) => inventory[c]?.owned);
          const allOwned = ownedCodes.length === codes.length, noneOwned = ownedCodes.length === 0;
          return (
            <section key={series} className="inv-section" aria-labelledby={`inv-series-${series}`}>
              <div className="inv-section-head">
                <h2 id={`inv-series-${series}`} className="inv-series">{series} 系列</h2>
                <span className="inv-series-meta num">
                  {slots.length < codes.length ? `搜尋到 ${slots.length}／${codes.length} 色` : `${codes.length} 色`}，擁有 {ownedCodes.length} 色
                </span>
                <span className="topbar-spacer" />
                <button type="button" className="btn-quiet inv-bulk" aria-disabled={allOwned || undefined}
                  onClick={() => { if (!allOwned) edit(codes.filter((c) => !inventory[c]?.owned).map((code) => ({ code, owned: true }))); }}>
                  全部勾選此系列
                </button>
                <button type="button" className="btn-quiet inv-bulk" aria-disabled={noneOwned || undefined}
                  onClick={() => { if (!noneOwned) edit(ownedCodes.map((code) => ({ code, owned: false }))); }}>
                  全部取消
                </button>
              </div>
              <div className="tray inv-tray">
                <ul className="inv-grid">
                  {slots.map((s) => (
                    <InvSlot
                      key={s.code} slot={s} original={original.get(s.code) ?? s.hex} calibrated={calibrated.get(s.code) ?? null}
                      ink={ink} weighOpen={weighing?.code === s.code}
                      onOwned={setOwned} onCount={setCount} onCalibrate={calibrate} onWeigh={openWeigh}
                    />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </fieldset>

      <footer className="inv-foot">
        <span className="num">擁有 {totals.colors} 色，共 {totals.beads} 顆</span>
        <span className="muted" aria-live="polite">{!editable ? '離線中，暫時不能修改' : saving ? '正在儲存…' : '修改會自動儲存'}</span>
      </footer>

      {weighing && (
        <WeighPopover
          slot={weighing} anchor={weighAnchor} unit={weighing.transparent ? units.clear : units.normal}
          onFill={(n) => { setCount(weighing.code, n); closeWeigh(true); }} onClose={closeWeigh}
        />
      )}
    </>
  );
}

/* ---------- 單顆重量 ---------- */

function UnitWeightFields({ units, disabled, onChange }: { units: UnitWeights; disabled: boolean; onChange(w: UnitWeights): void }) {
  const id = useId();
  const [text, setText] = useState({ normal: String(units.normal), clear: String(units.clear) });
  const bad = (k: keyof UnitWeights) => { const v = parseWeight(text[k]); return v === null || v <= 0; };
  const set = (k: keyof UnitWeights, value: string) => {
    setText((t) => ({ ...t, [k]: value }));
    const v = parseWeight(value);
    if (v !== null && v > 0) onChange({ ...units, [k]: v });
  };
  const anyBad = bad('normal') || bad('clear');
  return (
    <div className="inv-units" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="inv-units-label">單顆重量</span>
      {(['normal', 'clear'] as const).map((k) => (
        <label key={k} className="inv-unit">
          <span>{k === 'normal' ? '一般豆' : '透明豆'}</span>
          <input
            type="text" inputMode="decimal" className="field-input inv-unit-input num" value={text[k]} disabled={disabled}
            aria-invalid={bad(k) || undefined} aria-describedby={`${id}-hint`}
            onChange={(e) => set(k, e.target.value)}
            onBlur={() => { if (bad(k)) setText((t) => ({ ...t, [k]: String(units[k]) })); }}
          />
          <span className="muted">g</span>
        </label>
      ))}
      <span id={`${id}-hint`} className={`field-hint${anyBad ? ' is-alert' : ''}`}>
        {anyBad ? '單顆重量要是大於 0 的數字，換算時先沿用上一個值。' : '數 100 顆秤重，除以 100。'}
      </span>
    </div>
  );
}

/* ---------- 一格 ---------- */

type SlotProps = {
  slot: TraySlot; original: string; calibrated: string | null; ink: BeadInk; weighOpen: boolean;
  onOwned(code: string, owned: boolean): void; onCount(code: string, n: number): void;
  onCalibrate(code: string, hex: string | null): void; onWeigh(slot: TraySlot, el: HTMLElement): void;
};

const InvSlot = memo(function InvSlot({ slot: s, original, calibrated, ink, weighOpen, onOwned, onCount, onCalibrate, onWeigh }: SlotProps) {
  const id = useId();
  // 正在輸入的文字：輸入中不讓伺服器的重新整理蓋掉；離開欄位後改回顯示實際庫存
  const [typing, setTyping] = useState<string | null>(null);
  const shownCount = typing ?? String(s.count);
  const invalid = typing !== null && typing.trim() !== '' && !/^\d+$/.test(typing.trim());
  const swatch = { '--swatch': s.hex } as CSSProperties;

  return (
    <li className={`inv-slot${s.owned ? '' : ' is-missing'}`} style={swatch} data-code={s.code} aria-label={`${s.code} ${s.name}`}>
      <div className="inv-slot-top">
        {s.level > 0 ? <Pile slot={s} ink={ink} /> : <span className="tray-pile-empty" style={{ width: PILE_W, height: PILE_H }} aria-hidden="true" />}
        <div className="inv-slot-name">
          <span className="inv-code">{s.code}</span>
          <span className="inv-name">{s.name}{s.transparent ? '（透明）' : ''}</span>
        </div>
      </div>
      <span className={`tray-swatch inv-swatch${s.transparent ? ' is-clear' : ''}`} aria-hidden="true" />

      <div className="inv-row">
        <label className="inv-owned">
          <input type="checkbox" checked={s.owned} onChange={(e) => onOwned(s.code, e.target.checked)} aria-label={`${s.code} 我有`} />
          <span aria-hidden="true">我有</span>
        </label>
        <input
          id={`${id}-count`} type="text" inputMode="numeric" className="field-input inv-count num" value={shownCount}
          aria-label={`${s.code} 顆數`} aria-invalid={invalid || undefined}
          onFocus={() => setTyping(String(s.count))}
          onChange={(e) => {
            const t = e.target.value;
            setTyping(t);
            if (/^\d+$/.test(t.trim())) onCount(s.code, Math.min(Number(t.trim()), 1_000_000));
          }}
          onBlur={() => setTyping(null)}
        />
        <span className="inv-unit-word" aria-hidden="true">顆</span>
        <button
          type="button" className="btn-quiet inv-weigh" aria-haspopup="dialog" aria-expanded={weighOpen}
          aria-label={`${s.code} 秤重換算`} onClick={(e) => onWeigh(s, e.currentTarget)}
        >秤重</button>
      </div>

      <div className="inv-row inv-calib">
        <span className="inv-calib-beads" title={calibrated ? `原色 ${original}，校正為 ${calibrated}` : `原色 ${original}，未校正`}>
          <BeadDot hex={original} transparent={s.transparent} size={20} ink={ink} />
          {calibrated
            ? <BeadDot hex={calibrated} size={20} ink={ink} />
            : <span className="inv-calib-none" aria-hidden="true" />}
        </span>
        <label className="inv-color">
          <input
            type="color" value={(calibrated ?? original).toLowerCase()} aria-label={`${s.code} 校正顯示色`}
            onChange={(e) => onCalibrate(s.code, e.target.value)}
          />
          <span>校色</span>
        </label>
        {calibrated && (
          <button type="button" className="link-btn inv-clear" aria-label={`清除 ${s.code} 的校正`} onClick={() => onCalibrate(s.code, null)}>
            清除校正
          </button>
        )}
      </div>
    </li>
  );
});

/* ---------- 秤重 ---------- */

function WeighPopover({ slot, anchor, unit, onFill, onClose }: {
  slot: TraySlot; anchor: RefObject<HTMLElement | null>; unit: number; onFill(n: number): void; onClose(returnFocus: boolean): void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const grams = parseWeight(text);
  const count = grams === null ? null : gramsToCount(grams, unit);
  const invalid = text.trim() !== '' && count === null;

  // 頁面捲動時錨點會移走：直接收起來
  useEffect(() => {
    const onScroll = () => onClose(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onClose]);

  return (
    <Popover kind="dialog" label={`${slot.code} 秤重換算`} anchor={anchor} align="end" onClose={onClose} className="pop-form inv-weigh-pop">
      <form onSubmit={(e) => { e.preventDefault(); if (count !== null) onFill(count); }}>
        <label className="field" htmlFor={`${id}-g`}>
          <span className="field-label">{slot.code} 秤出來的重量</span>
          <span className="inv-weigh-input">
            <input
              id={`${id}-g`} type="text" inputMode="decimal" className="field-input num" placeholder="例如 6" autoComplete="off"
              value={text} aria-invalid={invalid || undefined} aria-describedby={`${id}-r`}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="muted">g</span>
          </span>
        </label>
        <p id={`${id}-r`} className={`field-hint num${invalid ? ' is-alert' : ''}`} aria-live="polite">
          {invalid ? '請輸入 0 以上的數字。' : count !== null ? `約 ${count} 顆（單顆 ${unit} g）` : `單顆 ${unit} g，${slot.transparent ? '透明豆' : '一般豆'}`}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => onClose(true)}>取消</button>
          <button type="submit" className="btn-primary" disabled={count === null}>{count !== null ? `填入 ${count} 顆` : '填入顆數'}</button>
        </div>
      </form>
    </Popover>
  );
}
