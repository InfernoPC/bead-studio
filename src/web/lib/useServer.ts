import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getState } from './api';
import { reduceServer, type ClientState } from './serverState';

const INITIAL: ClientState = { conn: 'connecting', snapshot: null };

export function useServer(): { state: ClientState; refresh(): Promise<void> } {
  const [state, dispatch] = useReducer(reduceServer, INITIAL);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await getState();
      if (alive.current) dispatch({ type: 'snapshot', snapshot });
    } catch { /* 連線狀態由 WebSocket 決定 */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    const connect = () => {
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws = sock;
      sock.onopen = () => { delay = 1000; };
      sock.onmessage = (ev) => {
        let msg: { type?: string; design?: any };
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.type === 'hello') { dispatch({ type: 'conn', conn: 'online' }); void refresh(); }
        else if (msg.type === 'meta') void refresh();
        else if (msg.type === 'design' && msg.design) dispatch({ type: 'design', design: msg.design });
      };
      sock.onclose = () => {
        if (!alive.current || ws !== sock) return;
        dispatch({ type: 'conn', conn: 'offline' });
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };
    connect();

    return () => {
      alive.current = false;
      clearTimeout(timer);
      const sock = ws; ws = null;
      sock?.close();
    };
  }, [refresh]);

  return { state, refresh };
}
