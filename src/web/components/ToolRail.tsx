import { useEffect, type ReactNode } from 'react';
import type { Tool } from '../lib/editorState';

type ToolDef = { tool: Tool; label: string; key: string; icon: ReactNode };

/** 依實體按鍵比對（e.code），中文輸入法下 e.key 會是 'Process' */
const codeOf = (key: string) => `Key${key}`;

// 20×20 線條圖示，顏色跟著文字（currentColor）
const TOOLS: ToolDef[] = [
  { tool: 'pen', label: '畫筆', key: 'B', icon: <path d="M4 16l1-4 8-8 3 3-8 8-4 1zM11 6l3 3" /> },
  { tool: 'eraser', label: '橡皮擦', key: 'E', icon: <path d="M8 16h8M3.5 11.5l7-7 5 5-6.5 6.5H7.5zM7 8l5 5" /> },
  { tool: 'fill', label: '油漆桶', key: 'G', icon: <><path d="M4 9l5-5 6 6-5 5z" /><path d="M16 12.5c0 1.2.6 2 1 2.7a1 1 0 01-2 0c.4-.7 1-1.5 1-2.7z" /></> },
  { tool: 'eyedropper', label: '吸管', key: 'I', icon: <path d="M10.5 5.5l4 4M12.5 7.5l-7 7L4 16M12.8 5.2l1.5-1.5a1.5 1.5 0 012.1 2.1l-1.5 1.5" /> },
  { tool: 'line', label: '直線', key: 'L', icon: <><path d="M5.5 14.5l9-9" /><circle cx="4.5" cy="15.5" r="1.5" /><circle cx="15.5" cy="4.5" r="1.5" /></> },
  { tool: 'replace', label: '全域換色', key: 'R', icon: <path d="M15 7.5A5.5 5.5 0 005 6M5 12.5A5.5 5.5 0 0015 14M5 3v3h3M15 17v-3h-3" /> },
  { tool: 'hole', label: '掛孔', key: 'H', icon: <><circle cx="10" cy="10" r="5.5" /><circle cx="10" cy="10" r="2" /></> },
];
const MIRROR_KEY = 'M';

type Props = {
  tool: Tool; mirror: boolean; disabled: boolean;
  onTool(tool: Tool): void; onToggleMirror(): void;
};

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

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
          key={d.tool} type="button" className="tool-btn" aria-label={d.label} title={`${d.label}（${d.key}）`}
          aria-keyshortcuts={d.key} aria-pressed={tool === d.tool} disabled={disabled} onClick={() => onTool(d.tool)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">{d.icon}</svg>
        </button>
      ))}
      <span className="rail-divider" aria-hidden="true" />
      <button
        type="button" className="tool-btn" aria-label="鏡像檢視" title={`鏡像檢視（${MIRROR_KEY}）`}
        aria-keyshortcuts={MIRROR_KEY} aria-pressed={mirror} disabled={disabled} onClick={onToggleMirror}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14" strokeDasharray="2 2" /><path d="M7.5 6L3 14h4.5zM12.5 6L17 14h-4.5z" /></svg>
      </button>
    </nav>
  );
}
