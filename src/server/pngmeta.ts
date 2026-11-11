import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import { parseDesign } from '../core/designSchema';
import type { Design } from '../core/model';

const KEY = 'bead-studio';
const MAX_META_BYTES = 16 * 1024 * 1024;

const keywordOf = (data: Uint8Array) => Buffer.from(data.subarray(0, data.indexOf(0))).toString('latin1');

export function embedDesign(png: Buffer, d: Design): Buffer {
  const chunks = extract(png).filter((c) => !(c.name === 'zTXt' && keywordOf(c.data) === KEY));
  const body = Buffer.concat([
    Buffer.from(KEY, 'latin1'), Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(JSON.stringify(d), 'utf8')),
  ]);
  chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
  return Buffer.from(encode(chunks));
}

function metaChunk(png: Buffer): Uint8Array | null {
  for (const c of extract(png)) if (c.name === 'zTXt' && keywordOf(c.data) === KEY) return c.data;
  return null;
}

/** PNG 是否帶有 bead-studio metadata（不論內容是否有效） */
export function hasDesignMeta(png: Buffer): boolean {
  try { return metaChunk(png) !== null; } catch { return false; }
}

/** 讀出並驗證 metadata 中的設計（缺少的 markers/snapshots 補預設值）；沒有或無效時回傳 null */
export function extractDesign(png: Buffer): Design | null {
  try {
    const data = metaChunk(png);
    if (!data) return null;
    const start = data.indexOf(0) + 2;
    return parseDesign(JSON.parse(zlib.inflateSync(data.subarray(start), { maxOutputLength: MAX_META_BYTES }).toString('utf8')));
  } catch {
    return null;
  }
}
