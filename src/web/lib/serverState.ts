import type { Design } from '../../core/model';
import type { StateSnapshot } from './api';

export type ConnState = 'connecting' | 'online' | 'offline';
export type ClientState = { conn: ConnState; snapshot: StateSnapshot | null };
export type ServerEvent =
  | { type: 'snapshot'; snapshot: StateSnapshot }
  | { type: 'design'; design: Design }
  | { type: 'conn'; conn: ConnState };

export function reduceServer(s: ClientState, e: ServerEvent): ClientState {
  switch (e.type) {
    case 'conn':
      return { ...s, conn: e.conn };
    case 'snapshot':
      return { ...s, snapshot: e.snapshot };
    case 'design': {
      const snap = s.snapshot;
      if (!snap) return s;
      const d = e.design;
      if (snap.current && d.id === snap.current.id && d.version < snap.current.version) return s;
      const entry = { id: d.id, name: d.name, version: d.version };
      if (snap.current && d.id === snap.current.id) {
        const designs = snap.designs.map((x) => (x.id === d.id ? { ...x, ...entry } : x));
        return { ...s, snapshot: { ...snap, designs, current: d } };
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
