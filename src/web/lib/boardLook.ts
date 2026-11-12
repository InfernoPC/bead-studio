// 豆子外觀：燙前／燙後、有／無釘板。編輯區與實體預覽共用同一份，存在 localStorage（只是這台瀏覽器的偏好）
import { useCallback, useState } from 'react';
import { browserStorage } from './theme';

export type BoardLook = { ironed: boolean; board: boolean };
export const LOOK_KEY = 'bead-studio.look';
export const DEFAULT_LOOK: BoardLook = { ironed: false, board: true };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadLook(storage: StorageLike | null | undefined): BoardLook {
  try {
    const v = JSON.parse(storage?.getItem(LOOK_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return DEFAULT_LOOK;
    return {
      ironed: typeof v.ironed === 'boolean' ? v.ironed : DEFAULT_LOOK.ironed,
      board: typeof v.board === 'boolean' ? v.board : DEFAULT_LOOK.board,
    };
  } catch { return DEFAULT_LOOK; }
}

export function saveLook(look: BoardLook, storage: StorageLike | null | undefined): void {
  try { storage?.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* 存不了就只在這次瀏覽生效 */ }
}

export function useBoardLook(): [BoardLook, (patch: Partial<BoardLook>) => void] {
  const [look, setLook] = useState<BoardLook>(() => loadLook(browserStorage()));
  const update = useCallback((patch: Partial<BoardLook>) => {
    setLook((l) => {
      const n = { ...l, ...patch };
      saveLook(n, browserStorage());
      return n;
    });
  }, []);
  return [look, update];
}
