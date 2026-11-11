import { z } from 'zod';
import type { Design } from './model';

// 驗證來自外部（PNG metadata、磁碟上的檔案）的 Design
const BoardSchema = z.object({
  widthMm: z.number().positive(), heightMm: z.number().positive(),
  bead: z.union([z.literal(2.6), z.literal(5)]), margin: z.number().int().min(0),
});
const VariantSchema = z.object({
  id: z.string().min(1), name: z.string(), paletteMode: z.enum(['all', 'owned', 'stock']),
  cells: z.array(z.string().min(1).nullable()),
});
const MarkerSchema = z.object({ type: z.literal('hole'), x: z.number().int(), y: z.number().int() });

const coreShape = {
  id: z.string(), name: z.string(), version: z.number().int().min(0), board: BoardSchema,
  cols: z.number().int().min(1).max(2048), rows: z.number().int().min(1).max(2048),
  mask: z.string().regex(/^[01]*$/), variants: z.array(VariantSchema).min(1),
  activeVariant: z.string(), shapeLocked: z.boolean(), markers: z.array(MarkerSchema).default([]),
};

function checkConsistency(d: z.infer<z.ZodObject<typeof coreShape>>, ctx: z.RefinementCtx) {
  const n = d.cols * d.rows;
  if (d.mask.length !== n) ctx.addIssue({ code: 'custom', path: ['mask'], message: `mask 長度應為 ${n}` });
  d.variants.forEach((v, k) => {
    if (v.cells.length !== n) ctx.addIssue({ code: 'custom', path: ['variants', k, 'cells'], message: `cells 長度應為 ${n}` });
    else if (v.cells.some((c, i) => (c === null ? '0' : '1') !== d.mask[i])) {
      ctx.addIssue({ code: 'custom', path: ['variants', k, 'cells'], message: 'cells 與 mask 不一致' });
    }
  });
  if (new Set(d.variants.map((v) => v.id)).size !== d.variants.length) ctx.addIssue({ code: 'custom', path: ['variants'], message: '版本 id 重複' });
  if (!d.variants.some((v) => v.id === d.activeVariant)) ctx.addIssue({ code: 'custom', path: ['activeVariant'], message: '找不到 activeVariant' });
}

export const DesignCoreSchema = z.object(coreShape).superRefine(checkConsistency);

const SnapshotSchema = z.object({ id: z.string(), name: z.string(), at: z.string(), design: DesignCoreSchema });

export const DesignSchema = z.object({
  ...coreShape,
  // 快照內的設計若無效就丟掉，不影響主設計
  snapshots: z.array(z.unknown()).default([]).transform((xs) => xs.flatMap((x) => {
    const r = SnapshotSchema.safeParse(x);
    return r.success ? [r.data] : [];
  })),
}).superRefine(checkConsistency);

/** 解析並補上預設值；無效時回傳 null */
export function parseDesign(x: unknown): Design | null {
  const r = DesignSchema.safeParse(x);
  return r.success ? r.data : null;
}
