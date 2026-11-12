import { z } from 'zod';
import type { Design } from './model';

// 驗證來自外部（PNG metadata、磁碟上的檔案）的 Design
const BoardSchema = z.object({
  widthMm: z.number().positive(), heightMm: z.number().positive(),
  bead: z.union([z.literal(2.6), z.literal(5)]), margin: z.number().int().min(0),
});
const MarkerSchema = z.object({ type: z.literal('hole'), x: z.number().int(), y: z.number().int() });

const coreShape = {
  id: z.string(), name: z.string(), version: z.number().int().min(0), board: BoardSchema,
  cols: z.number().int().min(1).max(2048), rows: z.number().int().min(1).max(2048),
  cells: z.array(z.string().min(1).nullable()), markers: z.array(MarkerSchema).default([]),
};

function checkConsistency(d: z.infer<z.ZodObject<typeof coreShape>>, ctx: z.RefinementCtx) {
  const n = d.cols * d.rows;
  if (d.cells.length !== n) ctx.addIssue({ code: 'custom', path: ['cells'], message: `cells 長度應為 ${n}` });
}

// strict：帶 variants／mask 等舊欄位的舊格式一律不收
export const DesignCoreSchema = z.object(coreShape).strict().superRefine(checkConsistency);

const SnapshotSchema = z.object({ id: z.string(), name: z.string(), at: z.string(), design: DesignCoreSchema });

export const DesignSchema = z.object({
  ...coreShape,
  // 快照內的設計若無效就丟掉，不影響主設計
  snapshots: z.array(z.unknown()).default([]).transform((xs) => xs.flatMap((x) => {
    const r = SnapshotSchema.safeParse(x);
    return r.success ? [r.data] : [];
  })),
}).strict().superRefine(checkConsistency);

/** 解析並補上預設值；無效時回傳 null */
export function parseDesign(x: unknown): Design | null {
  const r = DesignSchema.safeParse(x);
  return r.success ? r.data : null;
}
