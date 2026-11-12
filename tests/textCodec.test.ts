import { describe, it, expect } from 'vitest';
import { encodeDesignText, rle, unrle, legendFor } from '../src/core/textCodec';
import { smallDesign, paint } from './fixtures';
import { createDesign } from '../src/core/model';
import { OpError } from '../src/core/errors';

describe('text codec', () => {
  it('rle round trips', () => {
    expect(rle('aaab..')).toBe('3ab2.');
    expect(unrle('3ab2.')).toBe('aaab..');
    expect(unrle(rle('abcabc'))).toBe('abcabc');
  });
  it('assigns legend chars by frequency', () => {
    const m = legendFor(['H2', 'A1', 'A1', null]);
    expect(m.get('A1')).toBe('a');
    expect(m.get('H2')).toBe('b');
  });
  it('encodes only the bbox with a header', () => {
    const d0 = createDesign({ id: 't', name: 't', board: { widthMm: 30, heightMm: 15, bead: 5, margin: 1 } });
    const d = paint(d0, [[1, 1, 'A1'], [2, 1, 'A1'], [3, 1, 'A1'], [4, 1, 'H2']]);
    expect(encodeDesignText(d)).toBe([
      '6x3 margin=1 bead=5',
      'bbox=(1,1)-(4,1)',
      'legend: a=A1 b=H2',
      'y1: 3ab',
    ].join('\n'));
  });
  it('handles empty designs', () => {
    expect(encodeDesignText(smallDesign())).toContain('bbox=none');
  });
  it('gives 80 distinct colors unique legend chars that are never digits, "." or "_"', () => {
    const cells = Array.from({ length: 80 }, (_, i) => `X${i}`);
    const chars = [...legendFor(cells).values()];
    expect(new Set(chars).size).toBe(80);
    for (const ch of chars) expect(ch).not.toMatch(/[0-9._]/);
  });
  it('refuses to encode more colors than legend chars instead of emitting ambiguous output', () => {
    const d = createDesign({ id: 't', name: 't', board: { widthMm: 100, heightMm: 100, bead: 5, margin: 0 } });
    d.cells = d.cells.map((_, i) => (i < 200 ? `X${i}` : null));
    try {
      encodeDesignText(d);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(OpError);
      expect((e as OpError).code).toBe('too_many_colors');
    }
  });
  it('encodes only the requested region intersected with the bbox', () => {
    const d0 = createDesign({ id: 't', name: 't', board: { widthMm: 30, heightMm: 15, bead: 5, margin: 1 } });
    const d = paint(d0, [[1, 1, 'A1'], [2, 1, 'A1'], [3, 1, 'H2'], [4, 1, 'H2'], [1, 2, 'A1']]);
    expect(encodeDesignText(d, { x: 3, y: 0, w: 10, h: 2 })).toBe([
      '6x3 margin=1 bead=5',
      'bbox=(3,1)-(4,1)',
      'legend: a=H2',
      'y1: 2a',
    ].join('\n'));
    expect(encodeDesignText(d, { x: 5, y: 0, w: 1, h: 3 })).toContain('bbox=none');
  });
  it('unrle rejects rows that expand past the limit', () => {
    expect(() => unrle('99999999a', 2048)).toThrow(OpError);
  });
});
