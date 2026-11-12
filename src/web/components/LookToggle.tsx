// 顯示方式：燙前／燙後、有／無釘板。放在編輯區上方（放大的實體預覽裡也有一份），兩邊共用同一份設定
import type { BoardLook } from '../lib/boardLook';

type Props = { look: BoardLook; onLook(patch: Partial<BoardLook>): void; className?: string };

export function LookToggle({ look, onLook, className }: Props) {
  const seg = (label: string, options: [string, boolean][], value: boolean, set: (v: boolean) => void) => (
    <div className="seg seg-2" role="group" aria-label={label}>
      {options.map(([text, v]) => (
        <button key={text} type="button" className="seg-btn" aria-pressed={value === v} onClick={() => set(v)}>{text}</button>
      ))}
    </div>
  );
  return (
    <div className={`look-bar${className ? ` ${className}` : ''}`} role="toolbar" aria-label="顯示方式">
      {seg('豆子', [['燙前', false], ['燙後', true]], look.ironed, (ironed) => onLook({ ironed }))}
      {seg('釘板', [['有釘板', true], ['無釘板', false]], look.board, (board) => onLook({ board }))}
    </div>
  );
}
