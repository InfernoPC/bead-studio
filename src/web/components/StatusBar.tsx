import type { Board } from '../../core/model';

const cm = (mm: number) => Number((mm / 10).toFixed(1));

type Props = {
  board: Board | null; cols: number; rows: number; zoom: number;
  disabled: boolean; onZoom(factor: number): void;
};

/** 舞台下方狀態列：尺寸、留邊、縮放 */
export function StatusBar({ board, cols, rows, zoom, disabled, onZoom }: Props) {
  return (
    <div className="statusbar num">
      {board ? (
        <>
          <span>{`${cols} × ${rows} 格 · ${cm(board.widthMm)} × ${cm(board.heightMm)} cm · ${board.bead}mm 豆`}</span>
          <span>{`留邊 ${board.margin} 格`}</span>
        </>
      ) : <span className="muted">沒有開啟的作品</span>}
      <span className="zoom">
        <button type="button" className="icon-btn" aria-label="縮小" disabled={disabled || !board} onClick={() => onZoom(1 / 1.25)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
        </button>
        <span className="zoom-value" aria-label="縮放比例">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn" aria-label="放大" disabled={disabled || !board} onClick={() => onZoom(1.25)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
        </button>
      </span>
    </div>
  );
}
