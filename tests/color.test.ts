import { describe, it, expect } from 'vitest';
import { hexToLab, deltaE00, hexToRgb } from '../src/core/color';

describe('color', () => {
  it('parses hex', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });
  it('converts white and red to Lab (D65)', () => {
    const w = hexToLab('#FFFFFF');
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1])).toBeLessThan(0.05);
    expect(Math.abs(w[2])).toBeLessThan(0.05);
    const r = hexToLab('#FF0000');
    expect(r[0]).toBeCloseTo(53.24, 1);
    expect(r[1]).toBeCloseTo(80.09, 0);
    expect(r[2]).toBeCloseTo(67.2, 0);
  });
  it('matches Sharma CIEDE2000 reference pairs', () => {
    expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE00([50, -1.3802, -84.2814], [50, 0, -82.7485])).toBeCloseTo(1.0, 3);
    expect(deltaE00([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
  });
  it('is zero for identical colors', () => {
    expect(deltaE00([40, 10, -5], [40, 10, -5])).toBe(0);
  });
});
