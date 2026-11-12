import { describe, it, expect } from 'vitest';
import { diffCells, waveDelays, bounceScale, shrinkScale, BounceTracker, BOUNCE_MS } from '../../src/web/lib/bounce';

describe('bounce', () => {
  it('diffs presence and color changes only', () => {
    expect(diffCells(['A1', null, 'B1', 'C1'], ['A1', 'A1', 'B2', 'C1'])).toEqual([1, 2]);
    expect(diffCells(['A1'], ['A1', null])).toEqual([]);
  });
  it('waves diagonally from the top-left changed cell', () => {
    const cols = 10;
    const d = waveDelays([0 * cols + 2, 0 * cols + 3, 1 * cols + 2, 4 * cols + 6], cols);
    expect(d.get(2)).toBe(0);
    expect(d.get(3)).toBe(22);
    expect(d.get(cols + 2)).toBe(22);
    expect(d.get(4 * cols + 6)).toBe((4 + 4) * 22);
  });
  it('compresses long waves to maxMs', () => {
    const cells = Array.from({ length: 100 }, (_, i) => i * 101); // 對角線 100×100
    const d = waveDelays(cells, 100, { maxMs: 900 });
    expect(Math.max(...d.values())).toBeLessThanOrEqual(900);
    expect(d.get(0)).toBe(0);
  });
  it('starts the earliest cell at 0 even when the bounding corner is empty', () => {
    // 反對角線：(9,0) 與 (0,9) 的 dx+dy 相同，都從 0 開始
    const d = waveDelays([9, 90], 10);
    expect(d.get(9)).toBe(0);
    expect(d.get(90)).toBe(0);
    expect(waveDelays([], 10).size).toBe(0);
  });
  it('bounce curve squashes, overshoots and settles', () => {
    expect(bounceScale(0)).toBeCloseTo(1, 2);
    const samples = Array.from({ length: 50 }, (_, i) => bounceScale(i / 49));
    expect(Math.min(...samples)).toBeLessThan(0.86);
    expect(Math.max(...samples)).toBeGreaterThan(1.08);
    expect(bounceScale(1)).toBe(1);
    expect(bounceScale(2)).toBe(1);
    expect(BOUNCE_MS).toBe(280);
  });
  it('shrink curve swells a little then disappears', () => {
    expect(shrinkScale(0)).toBe(1);
    expect(shrinkScale(0.2)).toBeGreaterThan(1);
    expect(shrinkScale(0.6)).toBeLessThan(1);
    expect(shrinkScale(1)).toBe(0);
    expect(shrinkScale(3)).toBe(0);
  });
});

describe('BounceTracker', () => {
  const snap = (cells: (string | null)[], key = 'd1:v1:4x1') => ({ key, cols: 4, cells });
  const E = [null, null, null, null];

  it('does not bounce on first load, design/size switch, or reduced motion', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    expect(b.active).toBe(false);
    b.update(snap(['A1', null, null, null], 'd2:v1:4x1'), 'server', 0, false);
    expect(b.active).toBe(false);
    b.update(snap(['A1', 'A1', null, null], 'd2:v1:4x1'), 'server', 0, true);
    expect(b.active).toBe(false);
  });

  it('bounces strokes immediately and remote changes as a wave', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    b.update(snap(['A1', null, null, null]), 'stroke', 100, false);
    expect(b.frame(100, ['A1', null, null, null]).get(0)).toEqual({ code: 'A1', scale: 1 });
    expect(b.frame(170, ['A1', null, null, null]).get(0)!.scale).toBeLessThan(0.9);
    const c = ['A1', null, 'B1', 'B1'];
    b.update(snap(c), 'server', 1000, false);
    // (3,0) 晚 22ms，波浪還沒到時維持舊的樣子（空格）
    expect(b.frame(1010, c).get(3)).toEqual({ code: null, scale: 1 });
    expect(b.frame(1010 + 22, c).get(3)!.code).toBe('B1');
    b.frame(2000, c);
    expect(b.active).toBe(false);
  });

  it('shrinks removed beads with their old color', () => {
    const b = new BounceTracker();
    b.update(snap(['A1', null, null, null]), 'server', 0, false);
    b.update(snap(E), 'server', 0, false);
    const f = b.frame(200, E).get(0)!;
    expect(f.code).toBe('A1');
    expect(f.scale).toBeLessThan(1);
  });

  it('does not bounce the server echo of its own stroke a second time', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    const painted = ['A1', 'A1', null, null];
    b.update(snap(painted), 'stroke', 0, false);
    b.frame(1000, painted);
    // 回聲：預覽 → 伺服器版本（相同內容）
    b.update(snap(painted), 'server', 1000, false);
    expect(b.active).toBe(false);
    // 回聲之後同一格的新遠端修改照常跳
    b.update(snap(['B1', 'A1', null, null]), 'server', 2000, false);
    expect(b.active).toBe(true);
  });

  it('mid-stroke remote update: AI cells wave, the stroke does not bounce again on rebase', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    b.update(snap(['A1', null, null, null]), 'stroke', 0, false);
    b.frame(1000, E);
    // AI 新版本進來，預覽暫時被拿掉（畫的格子回到空格）
    b.update(snap([null, null, null, 'C1']), 'server', 1000, false);
    const f = b.frame(1000, [null, null, null, 'C1']);
    expect([...f.keys()]).toEqual([3]);
    // 把這一筆移到新版本上重新預覽
    b.update(snap(['A1', null, null, 'C1']), 'stroke', 1001, false);
    expect(b.frame(1001, ['A1', null, null, 'C1']).has(0)).toBe(false);
    // 這一筆的回聲
    b.frame(2000, E);
    b.update(snap(['A1', null, null, 'C1']), 'server', 2000, false);
    expect(b.active).toBe(false);
  });

  it('a failed or cancelled stroke snaps back without bouncing, and stops counting as own later', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    b.update(snap(['A1', null, null, null]), 'stroke', 0, false);
    b.frame(1000, E);
    b.update(snap(E), 'server', 1000, false); // 預覽被清掉
    expect(b.active).toBe(false);
    b.settle(1000);
    b.update(snap(['B1', null, null, null]), 'server', 5000, false);
    expect(b.active).toBe(true);
  });

  it('in mirror view the wave starts at the top-left of the screen', () => {
    const b = new BounceTracker();
    b.update({ ...snap(E), mirror: true }, 'server', 0, false);
    const c = ['A1', null, null, 'A1'];
    b.update({ ...snap(c), mirror: true }, 'server', 0, false);
    // 資料第 3 欄在畫面最左邊：先跳
    expect(b.frame(10, c).get(3)!.code).toBe('A1');
    expect(b.frame(10, c).get(0)).toEqual({ code: null, scale: 1 });
  });

  it('local bulk ops (fill) wave', () => {
    const b = new BounceTracker();
    b.update(snap(E), 'server', 0, false);
    const c = ['A1', 'A1', 'A1', 'A1'];
    b.update(snap(c), 'local', 0, false);
    expect(b.frame(0, c).get(3)).toEqual({ code: null, scale: 1 });
  });
});
