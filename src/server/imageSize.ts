// 只讀圖片檔頭的寬高，不解碼。用來在解碼之前擋掉「檔案很小、宣告的尺寸很大」的圖片（解壓縮炸彈）：
// @napi-rs/canvas 的 loadImage 會一次解碼整張圖，宣告 12000×12000 的 0.5MB PNG 就要吃掉約 1GB 記憶體。

export type ImageSize = { width: number; height: number };

const ascii = (b: Buffer, at: number, s: string) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;

/** 認得的格式（PNG、JPEG、GIF、WebP、BMP、AVIF／HEIF）回傳檔頭宣告的寬高；認不得或檔頭殘缺回傳 null */
export function readImageSize(b: Buffer): ImageSize | null {
  try {
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && ascii(b, 12, 'IHDR')) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (ascii(b, 0, 'GIF8') && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (ascii(b, 0, 'BM') && b.length >= 26) return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpSize(b);
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
    if (ascii(b, 4, 'ftyp')) return heifSize(b);
  } catch { /* 檔頭殘缺：讀超過結尾 */ }
  return null;
}

function webpSize(b: Buffer): ImageSize | null {
  if (ascii(b, 12, 'VP8 ')) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (ascii(b, 12, 'VP8L')) {
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    if (b3 === undefined) return null;
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (ascii(b, 12, 'VP8X')) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** 依序跳過各段，讀第一個 SOF（Start Of Frame）段的尺寸 */
function jpegSize(b: Buffer): ImageSize | null {
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // 填充位元組
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // 沒有長度的標記
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    if (m === 0xd9 || m === 0xda) return null; // 結束或開始掃描資料，卻還沒有 SOF
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** AVIF／HEIF：取所有 ispe（影像空間尺寸）中最大的一個 */
function heifSize(b: Buffer): ImageSize | null {
  let best: ImageSize | null = null;
  for (let i = b.indexOf('ispe', 0, 'latin1'); i >= 0; i = b.indexOf('ispe', i + 4, 'latin1')) {
    if (i + 16 > b.length) break;
    const s = { width: b.readUInt32BE(i + 8), height: b.readUInt32BE(i + 12) };
    if (!best || s.width * s.height > best.width * best.height) best = s;
  }
  return best;
}
