import { describe, it, expect } from 'vitest';
import { runChecks, DEFAULT_CHECKS, formatIssues } from '../src/core/checks';
import { smallDesign, paint, palette, invAll } from './fixtures';

const ctx = { palette, inventory: invAll, config: DEFAULT_CHECKS };
const ids = (d: any, c = ctx) => runChecks(d, c).map((i) => i.id);

describe('checks', () => {
  it('clean design has no issues', () => {
    const d = paint(smallDesign(), [[3, 3, 'A1'], [4, 3, 'A1'], [3, 4, 'A1'], [4, 4, 'A1']]);
    expect(runChecks(d, ctx)).toEqual([]);
    expect(formatIssues([])).toBe('✅ 沒有發現問題');
  });
  it('flags beads in the margin', () => {
    const d = paint(smallDesign(), [[0, 5, 'A1'], [1, 5, 'A1']]);
    const issue = runChecks(d, ctx).find((i) => i.id === 'margin')!;
    expect(issue.cells).toEqual([[0, 5]]);
  });
  it('flags floating beads', () => {
    expect(ids(paint(smallDesign(), [[5, 5, 'A1']]))).toContain('floating');
  });
  it('flags long thin chains but not short ones', () => {
    const line5: [number, number, string][] = [2, 3, 4, 5, 6].map((x) => [x, 4, 'A1']);
    const line3: [number, number, string][] = [2, 3, 4].map((x) => [x, 4, 'A1']);
    expect(ids(paint(smallDesign(), line5))).toContain('thin_chain');
    expect(ids(paint(smallDesign(), line3))).not.toContain('thin_chain');
  });
  it('flags a weak hanging hole', () => {
    const d = { ...paint(smallDesign(), [[4, 4, 'A1'], [4, 5, 'A1'], [5, 5, 'A1'], [5, 4, 'A1']]), markers: [{ type: 'hole' as const, x: 4, y: 4 }] };
    const issue = runChecks(d, ctx).find((i) => i.id === 'hole')!;
    expect(issue.message).toMatch(/透明豆/);
  });
  it('accepts a hole one bead in from the edge, and flags edge or too-deep holes', () => {
    const block: [number, number, string][] = [];
    for (let y = 2; y <= 7; y++) for (let x = 2; x <= 7; x++) block.push([x, y, 'A1']);
    const at = (x: number, y: number) => runChecks({ ...paint(smallDesign(), block), markers: [{ type: 'hole' as const, x, y }] }, ctx).find((i) => i.id === 'hole');
    expect(at(4, 3)).toBeUndefined(); // 往內一格
    expect(at(4, 2)!.message).toMatch(/往內移一格/); // 在最外圈
    expect(at(4, 4)!.message).toMatch(/隔了 2 顆/); // 太深
  });
  it('flags a hole marker without a bead', () => {
    const d = { ...smallDesign(), markers: [{ type: 'hole' as const, x: 4, y: 4 }] };
    expect(runChecks(d, ctx).find((i) => i.id === 'hole')!.message).toMatch(/沒有豆子/);
  });
  it('flags stock shortage', () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'A1']]);
    const c = { ...ctx, inventory: { A1: { owned: true, count: 1 } } };
    expect(runChecks(d, c).find((i) => i.id === 'stock')!.message).toMatch(/A1.*缺 1 顆/);
  });
  it('flags low-contrast neighbours', () => {
    const d = paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'A4']]);
    expect(runChecks(d, ctx).find((i) => i.id === 'low_contrast')!.message).toMatch(/A1↔A4/);
    expect(ids(paint(smallDesign(), [[4, 4, 'A1'], [5, 4, 'H1']]))).not.toContain('low_contrast');
  });
});
