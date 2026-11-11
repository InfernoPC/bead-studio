import { useServer } from './lib/useServer';

export function App() {
  const { state } = useServer();
  const name = state.snapshot?.current?.name;
  return (
    <main className="app">
      {state.conn === 'connecting' && <div role="status" className="conn-banner">正在連線…</div>}
      {state.conn === 'offline' && <div role="status" className="conn-banner offline">連不上伺服器，正在重試。編輯暫停中。</div>}
      {name && <h1 className="design-name" data-testid="design-name">{name}</h1>}
    </main>
  );
}
