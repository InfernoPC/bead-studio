import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import type { Design } from '../core/model';

const KEY = 'bead-studio';

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

function isDesign(x: any): x is Design {
  return x && typeof x.cols === 'number' && typeof x.rows === 'number' && typeof x.mask === 'string'
    && x.mask.length === x.cols * x.rows && Array.isArray(x.variants) && x.variants.length > 0
    && x.variants.every((v: any) => Array.isArray(v.cells) && v.cells.length === x.cols * x.rows);
}

export function extractDesign(png: Buffer): Design | null {
  try {
    for (const c of extract(png)) {
      if (c.name !== 'zTXt' || keywordOf(c.data) !== KEY) continue;
      const start = c.data.indexOf(0) + 2;
      const d = JSON.parse(zlib.inflateSync(c.data.subarray(start)).toString('utf8'));
      return isDesign(d) ? d : null;
    }
  } catch {
    return null;
  }
  return null;
}
