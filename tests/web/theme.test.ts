import { describe, it, expect } from 'vitest';
import { resolveTheme, loadPref, savePref, nextPref, THEME_KEY, type ThemePref } from '../../src/web/lib/theme';

/** 簡單的記憶體 storage；throwing 時每個操作都丟錯（模擬隱私模式／被封鎖的 storage） */
function memStorage(init: Record<string, string> = {}, throwing = false) {
  const m = new Map(Object.entries(init));
  const guard = () => { if (throwing) throw new Error('SecurityError'); };
  return {
    getItem: (k: string) => { guard(); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { guard(); m.set(k, v); },
    map: m,
  };
}

describe('theme', () => {
  it('resolves each preference against the system setting', () => {
    const cases: [ThemePref, boolean, 'light' | 'dark'][] = [
      ['system', false, 'light'], ['system', true, 'dark'],
      ['light', false, 'light'], ['light', true, 'light'],
      ['dark', false, 'dark'], ['dark', true, 'dark'],
    ];
    for (const [pref, systemDark, want] of cases) expect(resolveTheme(pref, systemDark)).toBe(want);
  });

  it('loads a saved preference and falls back to system for missing or unknown values', () => {
    expect(loadPref(memStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(loadPref(memStorage({ [THEME_KEY]: 'light' }))).toBe('light');
    expect(loadPref(memStorage())).toBe('system');
    expect(loadPref(memStorage({ [THEME_KEY]: 'purple' }))).toBe('system');
  });

  it('returns system when localStorage throws, and saving does not throw', () => {
    const broken = memStorage({}, true);
    expect(loadPref(broken)).toBe('system');
    expect(() => savePref('dark', broken)).not.toThrow();
    expect(loadPref(undefined)).toBe('system');
  });

  it('saves the preference', () => {
    const s = memStorage();
    savePref('dark', s);
    expect(s.map.get(THEME_KEY)).toBe('dark');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextPref('system')).toBe('light');
    expect(nextPref('light')).toBe('dark');
    expect(nextPref('dark')).toBe('system');
  });
});
