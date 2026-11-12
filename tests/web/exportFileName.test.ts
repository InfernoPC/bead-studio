import { describe, it, expect } from 'vitest';
import { exportFileName } from '../../src/web/components/ExportMenu';

describe('exportFileName', () => {
  it('joins design and style', () => {
    expect(exportFileName('蘑菇吊飾', '施工圖')).toBe('蘑菇吊飾-施工圖.png');
  });
  it('replaces characters that file systems reject', () => {
    expect(exportFileName('a/b:c', 'z"<>|')).toBe('a_b_c-z____.png');
  });
  it('falls back to 作品 for empty parts', () => {
    expect(exportFileName('', '成品圖')).toBe('作品-成品圖.png');
  });
});
