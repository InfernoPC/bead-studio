import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserPath } from '../src/server/paths';

let root: string;
let files: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'beads-paths-'));
  files = join(root, 'BeadStudio');
  mkdirSync(files);
  writeFileSync(join(files, 'cat.png'), 'x');
});

describe('resolveUserPath', () => {
  it('returns absolute paths unchanged when unrestricted', () => {
    expect(resolveUserPath('/tmp/a.png', { homeDir: root })).toBe('/tmp/a.png');
  });
  it('expands ~ with the configured home dir', () => {
    expect(resolveUserPath('~/BeadStudio/cat.png', { homeDir: root })).toBe(join(files, 'cat.png'));
  });
  it('allows existing and new files inside filesDir', () => {
    const o = { homeDir: root, filesDir: files };
    expect(resolveUserPath(join(files, 'cat.png'), o)).toBe(join(files, 'cat.png'));
    expect(resolveUserPath('~/BeadStudio/new.png', o)).toBe(join(files, 'new.png'));
  });
  it('rejects paths outside filesDir, including .. and symlink escapes', () => {
    const o = { homeDir: root, filesDir: files };
    expect(() => resolveUserPath(join(root, 'x.png'), o)).toThrow(/只能使用/);
    expect(() => resolveUserPath(join(files, '..', 'x.png'), o)).toThrow(/只能使用/);
    symlinkSync(root, join(files, 'escape'));
    expect(() => resolveUserPath(join(files, 'escape', 'x.png'), o)).toThrow(/只能使用/);
  });
  it('rejects a missing parent directory with a clear error', () => {
    expect(() => resolveUserPath(join(files, 'nope', 'x.png'), { homeDir: root, filesDir: files })).toThrow(/資料夾不存在/);
  });
});
