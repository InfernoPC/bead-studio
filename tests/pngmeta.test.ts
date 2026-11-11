import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import { embedDesign, extractDesign } from '../src/server/pngmeta';
import { renderPng } from '../src/server/render';
import { smallDesign, paint, palette } from './fixtures';

describe('png metadata', () => {
  it('round trips a design', async () => {
    const d = paint(smallDesign(), [[1, 1, 'A1']]);
    const png = embedDesign(await renderPng(d, palette, {}), d);
    expect(extractDesign(png)).toEqual(d);
  });
  it('replaces an existing bead-studio chunk instead of duplicating', async () => {
    const d = smallDesign();
    const once = embedDesign(await renderPng(d, palette, {}), d);
    const twice = embedDesign(once, { ...d, name: '新名字' });
    expect(extract(twice).filter((c: any) => c.name === 'zTXt')).toHaveLength(1);
    expect(extractDesign(twice)!.name).toBe('新名字');
  });
  it('returns null for a plain PNG and for non-PNG data', async () => {
    expect(extractDesign(await renderPng(smallDesign(), palette, {}))).toBeNull();
    expect(extractDesign(Buffer.from('hello'))).toBeNull();
  });
  it('returns null for corrupted zTXt', async () => {
    const chunks = extract(await renderPng(smallDesign(), palette, {}));
    const bad = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), Buffer.from('not zlib')]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: bad });
    expect(extractDesign(Buffer.from(encode(chunks)))).toBeNull();
  });
  it('returns null when JSON is not a design', async () => {
    const chunks = extract(await renderPng(smallDesign(), palette, {}));
    const body = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from('{"a":1}'))]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
    expect(extractDesign(Buffer.from(encode(chunks)))).toBeNull();
  });
  it('returns null for a zTXt that inflates past the size cap', async () => {
    const chunks = extract(await renderPng(smallDesign(), palette, {}));
    const padded = JSON.stringify(smallDesign()) + ' '.repeat(17 * 1024 * 1024);
    const body = Buffer.concat([Buffer.from('bead-studio', 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(padded))]);
    chunks.splice(chunks.length - 1, 0, { name: 'zTXt', data: body });
    expect(extractDesign(Buffer.from(encode(chunks)))).toBeNull();
  });
});
