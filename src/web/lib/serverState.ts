import type { ClientDesign as Design } from '../../core/model';
import type { HistoryDepth, StateSnapshot } from './api';

export type ConnState = 'connecting' | 'online' | 'offline';
export type ClientState = { conn: ConnState; snapshot: StateSnapshot | null };
export type ServerEvent =
  | { type: 'snapshot'; snapshot: StateSnapshot }
  | { type: 'design'; design: Design; history?: HistoryDepth }
  | { type: 'conn'; conn: ConnState };

// refresh() 可能晚於 WS 的 design 事件才回來：同一作品且版本較舊時保留較新的 current
function keepNewerCurrent(prev: StateSnapshot | null, next: StateSnapshot): StateSnapshot {
  const p = prev?.current;
  const n = next.current;
  if (!p || !n || p.id !== n.id || n.version >= p.version) return next;
  const entry = { id: p.id, name: p.name, version: p.version };
  // 步數跟著作品版本走：保留較新的 current 時，也保留它的步數
  return { ...next, current: p, history: prev!.history, designs: next.designs.map((x) => (x.id === p.id ? { ...x, ...entry } : x)) };
}

export function reduceServer(s: ClientState, e: ServerEvent): ClientState {
  switch (e.type) {
    case 'conn':
      return { ...s, conn: e.conn };
    case 'snapshot':
      return { ...s, snapshot: keepNewerCurrent(s.snapshot, e.snapshot) };
    case 'design': {
      const snap = s.snapshot;
      if (!snap) return s;
      const d = e.design;
      if (snap.current && d.id === snap.current.id && d.version < snap.current.version) return s;
      const entry = { id: d.id, name: d.name, version: d.version };
      if (snap.current && d.id === snap.current.id) {
        const designs = snap.designs.map((x) => (x.id === d.id ? { ...x, ...entry } : x));
        return { ...s, snapshot: { ...snap, designs, current: d, history: e.history ?? snap.history } };
      }
      // 非目前作品：只更新清單，哪個作品是目前的由 /api/state 決定
      const known = snap.designs.some((x) => x.id === d.id);
      const designs = known
        ? snap.designs.map((x) => (x.id === d.id ? { ...x, ...entry } : x))
        : [...snap.designs, { ...entry, current: false }];
      return { ...s, snapshot: { ...snap, designs } };
    }
  }
}
