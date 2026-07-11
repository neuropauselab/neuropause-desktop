/**
 * P3.0 Increment 2 — Zod → JSON Schema converter tests.
 * Primitives + constraints, object required/optional + strict, arrays/records/unions/
 * nullable, and the never-throw fallback for unknown / deeply-nested schemas.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from './zodToJsonSchema';

describe('zodToJsonSchema', () => {
  it('converts primitives with their constraints', () => {
    expect(zodToJsonSchema(z.string().min(2).max(8))).toEqual({ type: 'string', minLength: 2, maxLength: 8 });
    expect(zodToJsonSchema(z.number().int().min(1).max(10))).toEqual({ type: 'integer', minimum: 1, maximum: 10 });
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
    expect(zodToJsonSchema(z.enum(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(zodToJsonSchema(z.literal('x'))).toEqual({ const: 'x' });
  });

  it('marks required vs optional and honors strict objects', () => {
    const s = z.object({ a: z.string(), b: z.number().optional(), c: z.string().default('d') }).strict();
    const j = zodToJsonSchema(s);
    expect(j.type).toBe('object');
    expect(j.required).toEqual(['a']); // b optional, c has a default → not required
    expect(j.additionalProperties).toBe(false);
    expect((j.properties as Record<string, unknown>).b).toEqual({ type: 'number' });
  });

  it('passthrough objects allow additional properties', () => {
    const j = zodToJsonSchema(z.object({ a: z.string() }).passthrough());
    expect(j.additionalProperties).toBe(true);
  });

  it('handles arrays, records, unions and nullable', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({ type: 'array', items: { type: 'string' } });
    expect(zodToJsonSchema(z.record(z.string(), z.number()))).toEqual({ type: 'object', additionalProperties: { type: 'number' } });
    const u = zodToJsonSchema(z.union([z.string(), z.number()]));
    expect(u.anyOf).toHaveLength(2);
    expect(zodToJsonSchema(z.string().nullable())).toEqual({ type: ['string', 'null'] });
  });

  it('never throws on unknown, and converts nested objects', () => {
    expect(zodToJsonSchema(z.unknown())).toEqual({});
    const nested = z.object({ a: z.object({ b: z.object({ c: z.string() }) }) });
    const j = zodToJsonSchema(nested) as Record<string, { properties: { a: { properties: { b: { properties: { c: unknown } } } } } }>;
    expect(j.properties.a.properties.b.properties.c).toEqual({ type: 'string' });
  });
});
