// 亮暗模式：偏好（跟隨系統／亮／暗）存在 localStorage，實際主題寫在 <html data-theme>。
// index.html 的 inline script 在 React 載入前用同樣的規則先設好 data-theme（防閃爍），
// 兩邊的 key 與判斷要一致。
import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'bead-studio.theme';
const PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** 工具列按鈕的三段循環：跟隨系統 → 亮 → 暗 */
export function nextPref(pref: ThemePref): ThemePref {
  return PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length];
}

export const PREF_LABEL: Record<ThemePref, string> = { system: '跟隨系統', light: '亮', dark: '暗' };

/** 瀏覽器的 localStorage；隱私模式或被封鎖時連讀取屬性都可能丟錯 */
export function browserStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function loadPref(storage: StorageLike | null | undefined): ThemePref {
  try {
    const v = storage?.getItem(THEME_KEY);
    return PREFS.includes(v as ThemePref) ? (v as ThemePref) : 'system';
  } catch { return 'system'; }
}

export function savePref(pref: ThemePref, storage: StorageLike | null | undefined): void {
  try { storage?.setItem(THEME_KEY, pref); } catch { /* 存不了就只在這次瀏覽生效 */ }
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** 偏好與循環切換；「跟隨系統」時監聽系統亮暗變化即時套用 */
export function useThemePref(): [ThemePref, () => void] {
  const [pref, setPref] = useState<ThemePref>(() => loadPref(browserStorage()));
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(pref, mq.matches); };
    apply();
    if (pref !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
  const cycle = useCallback(() => setPref((p) => {
    const n = nextPref(p);
    savePref(n, browserStorage());
    return n;
  }), []);
  return [pref, cycle];
}

/** 目前實際套用的主題（看 <html data-theme>）；canvas 用它決定何時重讀 tokens 重畫 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setTheme(currentTheme());
    return () => obs.disconnect();
  }, []);
  return theme;
}
