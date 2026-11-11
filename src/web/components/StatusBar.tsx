import type { Board } from '../../core/model';

const cm = (mm: number) => Number((mm / 10).toFixed(1));

type Props = {
  board: Board | null; cols: number; rows: number; zoom: number; notice?: string | null;
  disabled: boolean; onZoom(factor: number): void; onBoardSettings(): void;
};

/** 舞台下方狀態列：尺寸（點了開啟面板設定）、留邊、提示（例如伺服器拒絕修改的原因）、縮放 */
export function StatusBar({ board, cols, rows, zoom, notice, disabled, onZoom, onBoardSettings }: Props) {
  return (
    <div className="statusbar num">
      {board ? (
        <>
          <button type="button" className="status-size" title="面板設定" disabled={disabled} onClick={onBoardSettings}>
            {`${cols} × ${rows} 格 · ${cm(board.widthMm)} × ${cm(board.heightMm)} cm · ${board.bead}mm 豆`}
          </button>
          <span>{`留邊 ${board.margin} 格`}</span>
        </>
      ) : <span className="muted">沒有開啟的作品</span>}
      <span className="status-notice" role="status" data-testid="status-notice" title={notice ?? undefined}>{notice ?? ''}</span>
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
