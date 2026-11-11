import { useEffect, type ReactNode } from 'react';
import type { Tool } from '../lib/editorState';
import { ALT, isTyping } from '../lib/keyboard';

type ToolDef = { tool: Tool; label: string; key: string; hint: string; icon: ReactNode };

/** 依實體按鍵比對（e.code），中文輸入法下 e.key 會是 'Process' */
const codeOf = (key: string) => `Key${key}`;

// 20×20 線條圖示，顏色跟著文字（currentColor）
const TOOLS: ToolDef[] = [
  { tool: 'pen', hint: '點一下或拖曳，放上目前顏色的豆子', label: '畫筆', key: 'B', icon: <path d="M4 16l1-4 8-8 3 3-8 8-4 1zM11 6l3 3" /> },
  { tool: 'eraser', hint: '點一下或拖曳，拿掉豆子', label: '橡皮擦', key: 'E', icon: <path d="M8 16h8M3.5 11.5l7-7 5 5-6.5 6.5H7.5zM7 8l5 5" /> },
  { tool: 'fill', hint: '把相連的同色區域換成目前顏色', label: '油漆桶', key: 'G', icon: <><path d="M4 9l5-5 6 6-5 5z" /><path d="M16 12.5c0 1.2.6 2 1 2.7a1 1 0 01-2 0c.4-.7 1-1.5 1-2.7z" /></> },
  { tool: 'eyedropper', hint: '點一顆豆子，改用它的顏色', label: '吸管', key: 'I', icon: <path d="M10.5 5.5l4 4M12.5 7.5l-7 7L4 16M12.8 5.2l1.5-1.5a1.5 1.5 0 012.1 2.1l-1.5 1.5" /> },
  { tool: 'line', hint: '按住拖曳，畫一條直線', label: '直線', key: 'L', icon: <><path d="M5.5 14.5l9-9" /><circle cx="4.5" cy="15.5" r="1.5" /><circle cx="15.5" cy="4.5" r="1.5" /></> },
  { tool: 'ellipse', hint: `按住拖曳畫圓；按住 Shift 畫正圓，按住 ${ALT} 畫實心`, label: '圓形', key: 'O', icon: <ellipse cx="10" cy="10" rx="6.5" ry="5.5" /> },
  { tool: 'replace', hint: '點一顆豆子，把整張圖的這個顏色換成目前顏色', label: '全域換色', key: 'R', icon: <path d="M15 7.5A5.5 5.5 0 005 6M5 12.5A5.5 5.5 0 0015 14M5 3v3h3M15 17v-3h-3" /> },
  { tool: 'hole', hint: '點一下設定吊飾的掛孔，再點一次取消', label: '掛孔', key: 'H', icon: <><circle cx="10" cy="10" r="5.5" /><circle cx="10" cy="10" r="2" /></> },
];
const MIRROR_KEY = 'M';
const MIRROR_HINT = '左右翻轉檢視；燙的時候作品是背面朝上';

type Props = {
  tool: Tool; mirror: boolean; disabled: boolean;
  onTool(tool: Tool): void; onToggleMirror(): void;
};

/** 左側工具列；單鍵快捷鍵（不含修飾鍵、不在輸入框中、未停用時）切換工具 */
export function ToolRail({ tool, mirror, disabled, onTool, onToggleMirror }: Props) {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.code === codeOf(MIRROR_KEY)) { e.preventDefault(); onToggleMirror(); return; }
      const def = TOOLS.find((d) => e.code === codeOf(d.key));
      if (def) { e.preventDefault(); onTool(def.tool); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, onTool, onToggleMirror]);

  return (
    <nav className="rail" aria-label="繪圖工具">
      {TOOLS.map((d) => (
        <button
          key={d.tool} type="button" className="tool-btn" aria-label={d.label} aria-describedby={`tool-hint-${d.tool}`}
          aria-keyshortcuts={d.key} aria-pressed={tool === d.tool} disabled={disabled} onClick={() => onTool(d.tool)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">{d.icon}</svg>
          <ToolHint id={`tool-hint-${d.tool}`} label={d.label} shortcut={d.key} hint={d.hint} />
        </button>
      ))}
      <span className="rail-divider" aria-hidden="true" />
      <button
        type="button" className="tool-btn" aria-label="鏡像檢視" aria-describedby="tool-hint-mirror"
        aria-keyshortcuts={MIRROR_KEY} aria-pressed={mirror} disabled={disabled} onClick={onToggleMirror}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14" strokeDasharray="2 2" /><path d="M7.5 6L3 14h4.5zM12.5 6L17 14h-4.5z" /></svg>
        <ToolHint id="tool-hint-mirror" label="鏡像檢視" shortcut={MIRROR_KEY} hint={MIRROR_HINT} />
      </button>
    </nav>
  );
}

/** 滑鼠移到工具上（或鍵盤聚焦）時，在右側顯示名稱、快捷鍵與一句用法 */
function ToolHint({ id, label, shortcut, hint }: { id: string; label: string; shortcut: string; hint: string }) {
  return (
    <span className="tool-hint" role="tooltip" id={id}>
      <span className="tool-hint-head">
        <span className="tool-hint-name" aria-hidden="true">{label}</span>
        <kbd className="tool-hint-key" aria-hidden="true">{shortcut}</kbd>
      </span>
      <span className="tool-hint-text">{hint}</span>
    </span>
  );
}
