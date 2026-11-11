// 秤重換算：克數 ÷ 單顆重量 = 顆數。單顆重量（一般豆、透明豆各一個）存在這台瀏覽器的 localStorage
import { browserStorage } from './theme';

export type UnitWeights = { normal: number; clear: number };
export const DEFAULT_UNIT_WEIGHTS: UnitWeights = { normal: 0.06, clear: 0.06 };
export const UNIT_WEIGHT_KEY = 'bead-studio.unit-weights';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 換算成顆數（四捨五入）；克數不是 ≥ 0 的數字、或單顆重量不是正數時回傳 null */
export function gramsToCount(grams: number, unitWeight: number): number | null {
  if (!Number.isFinite(grams) || grams < 0) return null;
  if (!Number.isFinite(unitWeight) || unitWeight <= 0) return null;
  return Math.round(grams / unitWeight);
}

/** 使用者輸入的重量：只接受 ≥ 0 的一般小數（不接受負數、指數、單位） */
export function parseWeight(text: string): number | null {
  const t = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

const validUnit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

export function loadUnitWeights(storage: StorageLike | null | undefined = browserStorage()): UnitWeights {
  try {
    const raw = storage?.getItem(UNIT_WEIGHT_KEY);
    if (!raw) return DEFAULT_UNIT_WEIGHTS;
    const v = JSON.parse(raw) as Partial<UnitWeights>;
    return {
      normal: validUnit(v?.normal) ? v.normal : DEFAULT_UNIT_WEIGHTS.normal,
      clear: validUnit(v?.clear) ? v.clear : DEFAULT_UNIT_WEIGHTS.clear,
    };
  } catch { return DEFAULT_UNIT_WEIGHTS; }
}

export function saveUnitWeights(w: UnitWeights, storage: StorageLike | null | undefined = browserStorage()): void {
  try { storage?.setItem(UNIT_WEIGHT_KEY, JSON.stringify(w)); } catch { /* 存不了就只在這次瀏覽生效 */ }
}
