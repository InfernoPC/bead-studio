export type BeadSize = 2.6 | 5;
export type Board = { widthMm: number; heightMm: number; bead: BeadSize; margin: number };
export type Marker = { type: 'hole'; x: number; y: number };
export type DesignCore = {
  id: string; name: string; version: number; board: Board; cols: number; rows: number;
  cells: (string | null)[]; markers: Marker[];
};
export type Snapshot = { id: string; name: string; at: string; design: DesignCore };
export type Design = DesignCore & { snapshots: Snapshot[] };
/** 快照的清單資訊（不含快照的內容）；還原時用 id */
export type SnapshotInfo = Omit<Snapshot, 'design'>;
/** 送給瀏覽器的作品（WebSocket 推送與 /api/state）：快照只帶清單資訊，不必每次修改都傳一份份完整的舊作品 */
export type ClientDesign = DesignCore & { snapshots: SnapshotInfo[] };

export function toClientDesign(d: Design): ClientDesign {
  return { ...d, snapshots: d.snapshots.map(({ id, name, at }) => ({ id, name, at })) };
}

export function gridSize(b: Board) {
  return {
    cols: Math.max(1, Math.floor(b.widthMm / b.bead + 1e-6)),
    rows: Math.max(1, Math.floor(b.heightMm / b.bead + 1e-6)),
  };
}

export function createDesign(a: { id: string; name: string; board: Board }): Design {
  const { cols, rows } = gridSize(a.board);
  return {
    id: a.id, name: a.name, version: 0, board: { ...a.board }, cols, rows,
    cells: Array(cols * rows).fill(null), markers: [], snapshots: [],
  };
}

export const cloneDesign = <D extends DesignCore>(d: D): D => structuredClone(d);

export function coreOf(d: Design): DesignCore {
  const { snapshots: _s, ...core } = d;
  return structuredClone(core);
}

export function countCodes(cells: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cells) if (c) out[c] = (out[c] ?? 0) + 1;
  return out;
}

export function bbox(d: DesignCore, cells: (string | null)[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  cells.forEach((c, i) => {
    if (c === null) return;
    const x = i % d.cols, y = Math.floor(i / d.cols);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
