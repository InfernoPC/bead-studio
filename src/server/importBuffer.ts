import { createCanvas, loadImage } from '@napi-rs/canvas';
import { formatIssues, runChecks } from '../core/checks';
import { OpError } from '../core/errors';
import { imageToCells } from '../core/importImage';
import { getVariant, maskFromCells } from '../core/model';
import { syncOtherVariants } from '../core/ops';
import { allowedCodes, stockCapacity } from '../core/palette';
import { readImageSize } from './imageSize';
import { extractDesign, hasDesignMeta } from './pngmeta';
import type { DesignStore } from './store';

/** 解碼前先擋掉的像素上限（約 7000×7000）：每個像素解碼後要 4 bytes */
export const MAX_IMAGE_PIXELS = 50_000_000;

export async function importImageBuffer(
  store: DesignStore,
  buf: Buffer,
  { designId: id, variant: v, removeBg = false, dither = false }: { designId?: string; variant?: string; removeBg?: boolean; dither?: boolean },
): Promise<string> {
  const known = (cells: (string | null)[]) => cells.every((c) => c === null || store.palette.has(c));
  const meta = extractDesign(buf);
  if (meta && meta.variants.every((x) => known(x.cells))) {
    meta.snapshots = meta.snapshots.filter((s) => s.design.variants.every((x) => known(x.cells)));
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
    if (cur.shapeLocked) throw new OpError('shape_locked', '形狀已鎖定，無法導入圖片（會改變豆子位置）');
    const target = getVariant(cur, v);
    const allowed = store.palette.entries(allowedCodes(store.palette, store.inventory, target.paletteMode)).filter((e) => !e.transparent);
    const cells = imageToCells(rgba, img.width, img.height, {
      cols: cur.cols, rows: cur.rows, margin: cur.board.margin, allowed, removeBg, dither,
      capacity: target.paletteMode === 'stock' ? stockCapacity(store.inventory) : undefined,
    });
    const next = structuredClone(cur);
    const tv = getVariant(next, target.id);
    tv.cells = cells;
    next.mask = maskFromCells(cells);
    for (const o of next.variants) if (o !== tv) o.cells = o.cells.map(() => null);
    syncOtherVariants(next, tv, store.ctx());
    return next;
  });
  const n = getVariant(d, v).cells.filter(Boolean).length;
  return `${notice}已轉換圖片到 ${d.name}：${n} 顆豆子\n檢查：\n${formatIssues(runChecks(store.get(d.id), v, { ...store.ctx(), config: store.checks }))}`;
}
