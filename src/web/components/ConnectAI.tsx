// 「連接 AI」：教新手把 Claude Code 透過 MCP 接到這個伺服器。指令可複製；
// 瀏覽器不給剪貼簿（非安全來源、權限被拒）時改為選取指令文字，請使用者自己按複製。
import { useEffect, useRef, useState } from 'react';
import type { ConnState } from '../lib/serverState';
import { Popover, usePopover } from './Popover';

const MOD_C = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';

export function mcpCommand(mcpUrl: string) {
  return `claude mcp add --transport http beads ${mcpUrl}`;
}

type Copy = 'idle' | 'copied' | 'selected';

export function ConnectAI({ conn, mcpUrl }: { conn: ConnState; mcpUrl: string | null }) {
  const pop = usePopover();
  const code = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<Copy>('idle');
  const offline = conn === 'offline';
  const command = mcpUrl ? mcpCommand(mcpUrl) : null;

  // 「已複製」只維持 2 秒；關閉面板時一併重設
  useEffect(() => {
    if (copy !== 'copied') return;
    const t = setTimeout(() => setCopy('idle'), 2000);
    return () => clearTimeout(t);
  }, [copy]);
  useEffect(() => { if (!pop.open) setCopy('idle'); }, [pop.open]);

  const selectCommand = () => {
    const el = code.current, sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const onCopy = async () => {
    if (!command) return;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(command);
      setCopy('copied');
    } catch {
      selectCommand();
      setCopy('selected');
    }
  };

  return (
    <>
      <button
        ref={pop.trigger} type="button" className="btn-quiet topbar-btn connect-btn"
        aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}
        aria-describedby={offline ? 'connect-offline' : undefined}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8 12 12 8M7 9.5 5.2 11.3a2.6 2.6 0 0 0 3.5 3.5L10.5 13M13 10.5l1.8-1.8a2.6 2.6 0 0 0-3.5-3.5L9.5 7" />
        </svg>
        連接 AI
        {offline && <span className="connect-dot" aria-hidden="true" />}
      </button>
      {offline && <span id="connect-offline" hidden>伺服器沒有回應</span>}
      {pop.open && (
        <Popover kind="dialog" label="連接 AI" anchor={pop.trigger} align="end" onClose={pop.close} className="pop-form connect-pop">
          <h2 className="connect-title">讓 Claude Code 幫你設計</h2>
          <ol className="connect-steps">
            <li>
              在終端機執行這行指令（只需要一次）
              <div className="connect-cmd">
                <code ref={code} className="connect-code">{command ?? '正在取得伺服器網址…'}</code>
                <button type="button" className="btn-quiet connect-copy" disabled={!command} onClick={() => void onCopy()}>
                  {copy === 'copied' ? '已複製' : '複製指令'}
                </button>
              </div>
              {copy === 'selected' && (
                <p className="field-hint" role="status">{`瀏覽器不讓網頁直接複製，指令已經選取好，請按 ${MOD_C} 複製。`}</p>
              )}
            </li>
            <li>在 bead-studio 資料夾開啟 Claude Code，設計知識會自動載入</li>
            <li>跟 AI 說你想做什麼，例如：在 8 × 8 cm、2.6mm 豆的板子上設計一隻貓咪吊飾</li>
          </ol>
          <p className="field-hint connect-note">用 Docker 時：要匯入的圖片請先放進 ~/BeadStudio</p>
          <p className={`connect-status${offline ? ' is-off' : ''}`}>
            <span className="connect-status-dot" aria-hidden="true" />
            {offline ? '伺服器沒有回應' : '伺服器連線中'}
          </p>
        </Popover>
      )}
    </>
  );
}
