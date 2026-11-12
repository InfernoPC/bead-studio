import { OpError } from './errors';
import { cloneDesign, gridSize, type Board, type Design } from './model';

export function setBoard(
  d: Design, patch: Partial<Board>, opts: { keep: 'cells' | 'size'; force?: boolean },
): { design: Design; cropped: number } {
  const next = cloneDesign(d);
  const nb: Board = { ...d.board, ...patch };
  const beadChanged = nb.bead !== d.board.bead;

  if (beadChanged && opts.keep === 'cells') {
    nb.widthMm = +(d.cols * nb.bead).toFixed(2);
    nb.heightMm = +(d.rows * nb.bead).toFixed(2);
    next.board = nb;
    return { design: next, cropped: 0 };
  }

  const { cols, rows } = gridSize(nb);
  let src: (x: number, y: number) => number | null;
  let moveMarker: (x: number, y: number) => [number, number];
  let cropped = 0;

  if (beadChanged) {
    src = (x, y) => Math.floor(((y + 0.5) * d.rows) / rows) * d.cols + Math.floor(((x + 0.5) * d.cols) / cols);
    moveMarker = (x, y) => [Math.floor(((x + 0.5) * cols) / d.cols), Math.floor(((y + 0.5) * rows) / d.rows)];
  } else {
    const dx = Math.floor((cols - d.cols) / 2), dy = Math.floor((rows - d.rows) / 2);
    src = (x, y) => {
      const ox = x - dx, oy = y - dy;
      return ox >= 0 && oy >= 0 && ox < d.cols && oy < d.rows ? oy * d.cols + ox : null;
    };
    moveMarker = (x, y) => [x + dx, y + dy];
    for (let i = 0; i < d.cells.length; i++) {
      if (d.cells[i] === null) continue;
      const nx = (i % d.cols) + dx, ny = Math.floor(i / d.cols) + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) cropped++;
    }
    if (cropped > 0 && !opts.force) {
      throw new OpError('would_crop', `新尺寸會裁掉 ${cropped} 顆豆子；確認要裁切請加上 force: true`);
    }
  }

  next.cells = Array.from({ length: cols * rows }, (_, i) => {
    const s = src(i % cols, Math.floor(i / cols));
    return s === null ? null : d.cells[s];
  });
  next.board = nb;
  next.cols = cols;
  next.rows = rows;
  next.markers = d.markers
    .map((m) => { const [x, y] = moveMarker(m.x, m.y); return { ...m, x, y }; })
    .filter((m) => m.x >= 0 && m.y >= 0 && m.x < cols && m.y < rows);
  return { design: next, cropped };
}
