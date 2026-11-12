import { createCanvas, loadImage } from '@napi-rs/canvas';
import { formatIssues, runChecks } from '../core/checks';
import { OpError } from '../core/errors';
import { imageToCells, type PixelRect } from '../core/importImage';
import { readImageSize } from './imageSize';
import { extractDesign, hasDesignMeta } from './pngmeta';
import type { DesignStore } from './store';

/** 解碼前先擋掉的像素上限（約 7000×7000）：每個像素解碼後要 4 bytes */
export const MAX_IMAGE_PIXELS = 50_000_000;

export async function importImageBuffer(
  store: DesignStore,
  buf: Buffer,
  { designId: id, removeBg = false, dither = false, colors, crop, exclude }: {
    designId?: string; removeBg?: boolean; dither?: boolean;
    /** 只用這些色號轉換（例如黑白線稿只給黑、白） */
    colors?: string[]; crop?: PixelRect; exclude?: PixelRect[];
  },
): Promise<string> {
  const known = (cells: (string | null)[]) => cells.every((c) => c === null || store.palette.has(c));
  const meta = extractDesign(buf);
  if (meta && known(meta.cells)) {
    meta.snapshots = meta.snapshots.filter((s) => known(s.design.cells));
    const d = store.importDesign(meta);
    return `已從 PNG metadata 還原作品 ${d.id}「${d.name}」`;
  }
  const notice = hasDesignMeta(buf) ? '⚠ PNG 內的 bead-studio metadata 無效或含有目前色表沒有的色號，已改用一般圖片轉換\n' : '';
  // 解碼前先看檔頭宣告的尺寸：小檔案也可能宣告極大的尺寸，解碼時吃光記憶體
  const size = readImageSize(buf);
  if (!size) throw new OpError('bad_image', '無法辨識的圖片格式，請改用 PNG、JPEG、GIF、WebP 或 BMP');
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new OpError('image_too_large', `圖片太大（${size.width}×${size.height}），請先縮小到 ${MAX_IMAGE_PIXELS / 1e6} 百萬像素以內（例如 7000×7000）再導入`);
  }
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const d = store.update(id, (cur) => {
    let allowed = store.palette.all().filter((e) => !e.transparent);
    if (colors) {
      const unknown = colors.filter((c) => !store.palette.has(c));
      if (unknown.length) throw new OpError('unknown_color', `色表沒有這些色號：${unknown.join(', ')}`);
      const clear = colors.filter((c) => store.palette.get(c)!.transparent);
      if (clear.length) throw new OpError('bad_colors', `自動對色不能用透明豆：${clear.join(', ')}`);
      allowed = allowed.filter((e) => colors.includes(e.code));
    }
    const cells = imageToCells(rgba, img.width, img.height, {
      cols: cur.cols, rows: cur.rows, margin: cur.board.margin, allowed, removeBg, dither, crop, exclude,
    });
    return { ...structuredClone(cur), cells };
  });
  const n = d.cells.filter(Boolean).length;
  return `${notice}已轉換圖片到 ${d.name}：${n} 顆豆子\n檢查：\n${formatIssues(runChecks(store.get(d.id), { ...store.ctx(), config: store.checks }))}`;
}
