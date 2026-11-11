import { z } from 'zod';

const int = z.number().int();
const code = z.string().min(1);
export const RegionSchema = z.object({ x: int, y: int, w: int.positive(), h: int.positive() });
const Light = z.enum(['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']);

export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('paste'), x: int, y: int, rows: z.array(z.string()), legend: z.record(z.string(), code) }),
  z.object({ op: z.literal('rect'), x: int, y: int, w: int.positive(), h: int.positive(), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('ellipse'), x: int, y: int, w: int.positive(), h: int.positive(), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('line'), x1: int, y1: int, x2: int, y2: int, color: code }),
  z.object({ op: z.literal('polygon'), points: z.array(z.tuple([int, int])).min(3), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('fill'), x: int, y: int, color: code }),
  z.object({ op: z.literal('replace_color'), from: code, to: code, region: RegionSchema.optional() }),
  z.object({ op: z.literal('clear'), region: RegionSchema }),
  z.object({ op: z.literal('move'), region: RegionSchema, dx: int, dy: int }),
  z.object({ op: z.literal('mirror'), region: RegionSchema, axis: z.enum(['h', 'v']) }),
  z.object({ op: z.literal('rotate'), region: RegionSchema, turns: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ op: z.literal('outline'), target: code, color: code, side: z.enum(['outer', 'inner']), connect: z.union([z.literal(4), z.literal(8)]).optional() }),
  z.object({
    op: z.literal('gradient'), target: code, region: RegionSchema.optional(), colors: z.array(code).min(2),
    direction: z.union([z.enum(['h', 'v', 'radial']), z.number()]), dither: z.boolean().optional(),
  }),
  z.object({ op: z.literal('shade'), target: code, light: Light, highlight: code, shadow: code, depth: int.positive().optional() }),
  z.object({ op: z.literal('set_hole'), x: int, y: int, remove: z.boolean().optional() }),
]);

export type Op = z.infer<typeof OpSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Light = z.infer<typeof Light>;
