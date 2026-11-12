import { describe, it, expect } from 'vitest';
import { loadLook, saveLook, LOOK_KEY, DEFAULT_LOOK } from '../../src/web/lib/boardLook';

function memStorage(init: Record<string, string> = {}, throwing = false) {
  const m = new Map(Object.entries(init));
  const guard = () => { if (throwing) throw new Error('SecurityError'); };
  return {
    getItem: (k: string) => { guard(); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { guard(); m.set(k, v); },
    map: m,
  };
}

describe('boardLook', () => {
  it('defaults to 燙前 on a pegboard', () => {
    expect(DEFAULT_LOOK).toEqual({ ironed: false, board: true });
    expect(loadLook(memStorage())).toEqual(DEFAULT_LOOK);
    expect(loadLook(undefined)).toEqual(DEFAULT_LOOK);
  });
  it('round-trips a saved look', () => {
    const s = memStorage();
    saveLook({ ironed: true, board: false }, s);
    expect(JSON.parse(s.map.get(LOOK_KEY)!)).toEqual({ ironed: true, board: false });
    expect(loadLook(s)).toEqual({ ironed: true, board: false });
  });
  it('ignores broken or partial values field by field', () => {
    expect(loadLook(memStorage({ [LOOK_KEY]: 'not json' }))).toEqual(DEFAULT_LOOK);
    expect(loadLook(memStorage({ [LOOK_KEY]: '{"ironed":true,"board":"x"}' }))).toEqual({ ironed: true, board: true });
    expect(loadLook(memStorage({ [LOOK_KEY]: 'null' }))).toEqual(DEFAULT_LOOK);
  });
  it('survives a throwing storage', () => {
    const broken = memStorage({}, true);
    expect(loadLook(broken)).toEqual(DEFAULT_LOOK);
    expect(() => saveLook({ ironed: true, board: true }, broken)).not.toThrow();
  });
});
