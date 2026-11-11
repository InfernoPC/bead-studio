import { describe, it, expect } from 'vitest';
import { encodeDesignText, rle, unrle, legendFor } from '../src/core/textCodec';
import { smallDesign, paint } from './fixtures';
import { createDesign } from '../src/core/model';

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
      '6x3 margin=1 bead=5 locked=false variant=v1 理想版(all)',
      'bbox=(1,1)-(4,1)',
      'legend: a=A1 b=H2',
      'y1: 3ab',
    ].join('\n'));
  });
  it('handles empty designs', () => {
    expect(encodeDesignText(smallDesign())).toContain('bbox=none');
  });
});
