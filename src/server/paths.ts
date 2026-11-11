import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { OpError } from '../core/errors';

export type PathOpts = {
  /** 限制 import_image／export_png 只能使用這個資料夾（Docker 掛載的交換資料夾） */
  filesDir?: string;
  /** 展開 "~" 用的家目錄；Docker 裡要設成主機的家目錄，路徑才會與主機一致 */
  homeDir?: string;
};

/** 把使用者（AI）給的路徑轉成絕對路徑；設定 filesDir 時，拒絕資料夾外的路徑（含 .. 與符號連結逃逸） */
export function resolveUserPath(p: string, o: PathOpts = {}): string {
  const home = o.homeDir ?? homedir();
  const expanded = p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p;
  const abs = resolve(expanded);
  if (!o.filesDir) return abs;

  const parent = dirname(abs);
  if (!existsSync(parent)) throw new OpError('bad_path', `資料夾不存在：${parent}`);
  const real = existsSync(abs) ? realpathSync(abs) : join(realpathSync(parent), basename(abs));
  const root = realpathSync(o.filesDir);
  if (real !== root && !real.startsWith(root + sep)) {
    throw new OpError('bad_path', `只能使用 ${o.filesDir} 裡的檔案：${p}`);
  }
  return abs;
}
