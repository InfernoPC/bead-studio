import { useEffect, useReducer, useState } from 'react';
import { AppShell } from './components/AppShell';
import { InventoryPage } from './components/InventoryPage';
import { initialEditor, reduceEditor } from './lib/editorState';
import { useServer } from './lib/useServer';

type Route = 'editor' | 'inventory';
const routeOf = (hash: string): Route => (hash === '#/inventory' ? 'inventory' : 'editor');

/** hash 路由：#/inventory 是庫存頁，其他（含 #/）都是編輯頁 */
function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.hash));
  useEffect(() => {
    const on = () => setRoute(routeOf(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const { state } = useServer();
  // 編輯狀態（工具、顏色、縮放）放在這一層：去庫存頁再回來不會重設
  const [editor, dispatch] = useReducer(reduceEditor, initialEditor);
  const route = useRoute();
  return route === 'inventory'
    ? <InventoryPage conn={state.conn} snapshot={state.snapshot} />
    : <AppShell conn={state.conn} snapshot={state.snapshot} editor={editor} dispatch={dispatch} />;
}
