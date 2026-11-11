import type { ConnState } from '../lib/serverState';

/** 連線狀態提示；連上時不佔空間 */
export function OfflineBanner({ conn }: { conn: ConnState }) {
  if (conn === 'online') return null;
  const offline = conn === 'offline';
  return (
    <div role="status" className={offline ? 'conn-banner offline' : 'conn-banner'}>
      {offline ? '連不上伺服器，正在重試。編輯暫停中。' : '正在連線…'}
    </div>
  );
}
