import { describe, it, expect } from 'vitest';
import { exportFileName } from '../../src/web/components/ExportMenu';

describe('exportFileName', () => {
  it('joins design, variant and style', () => {
    expect(exportFileName('蘑菇吊飾', '理想版', '施工圖')).toBe('蘑菇吊飾-理想版-施工圖.png');
  });
  it('replaces characters that file systems reject', () => {
    expect(exportFileName('a/b:c', 'x*y?', 'z"<>|')).toBe('a_b_c-x_y_-z____.png');
  });
  it('falls back to 作品 for empty parts', () => {
    expect(exportFileName('', '  ', '成品圖')).toBe('作品-作品-成品圖.png');
  });
});
