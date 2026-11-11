import { z } from 'zod';

const coord = z.number().int().min(-2048).max(2048);
const size = z.number().int().min(1).max(2048);
const code = z.string().min(1);
export const RegionSchema = z.object({ x: coord, y: coord, w: size, h: size });
const Light = z.enum(['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']);

export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('paste'), x: coord, y: coord, rows: z.array(z.string().max(2048)).max(2048), legend: z.record(z.string(), code) }),
  z.object({ op: z.literal('rect'), x: coord, y: coord, w: size, h: size, color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('ellipse'), x: coord, y: coord, w: size, h: size, color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('line'), x1: coord, y1: coord, x2: coord, y2: coord, color: code }),
  z.object({ op: z.literal('polygon'), points: z.array(z.tuple([coord, coord])).min(3).max(256), color: code, fill: z.boolean().optional() }),
  z.object({ op: z.literal('fill'), x: coord, y: coord, color: code }),
  z.object({ op: z.literal('replace_color'), from: code, to: code, region: RegionSchema.optional() }),
  z.object({ op: z.literal('clear'), region: RegionSchema }),
  z.object({ op: z.literal('move'), region: RegionSchema, dx: coord, dy: coord }),
  z.object({ op: z.literal('mirror'), region: RegionSchema, axis: z.enum(['h', 'v']) }),
  z.object({ op: z.literal('rotate'), region: RegionSchema, turns: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ op: z.literal('outline'), target: code, color: code, side: z.enum(['outer', 'inner']), connect: z.union([z.literal(4), z.literal(8)]).optional() }),
  z.object({
    op: z.literal('gradient'), target: code, region: RegionSchema.optional(), colors: z.array(code).min(2).max(16),
    direction: z.union([z.enum(['h', 'v', 'radial']), z.number()]), dither: z.boolean().optional(),
  }),
  z.object({ op: z.literal('shade'), target: code, light: Light, highlight: code, shadow: code, depth: z.number().int().min(1).max(16).optional() }),
  z.object({ op: z.literal('set_hole'), x: coord, y: coord, remove: z.boolean().optional() }),
]);

export type Op = z.infer<typeof OpSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Light = z.infer<typeof Light>;
